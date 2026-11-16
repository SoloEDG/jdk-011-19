import type { ChunkEdit, MaterialId, WorldDocument } from "../../../shared/document";
import type { WorldSummary } from "../../../shared/commands";
import {
  chunkCoord,
  chunkKey,
  chunkKeyAt,
  inside,
  key,
  parseKey,
  type Vec3,
} from "../../../shared/document";
import { generateChunkCells, generatedBlockAt } from "./terrain";

/** A resident chunk and the sparse state that produced it. */
export interface LoadedChunk {
  cx: number;
  cz: number;
  /** Solid cells of this chunk, keyed with the global cell key. */
  cells: Map<string, MaterialId>;
  /** Baseline cells that were removed, kept for diagnostics. */
  cleared: Set<string>;
}

interface DocState {
  loaded: Map<string, LoadedChunk>;
  /** Chunks whose resident mesh no longer matches their cells. */
  dirty: Set<string>;
}

const states = new WeakMap<WorldDocument, DocState>();
export function docState(doc: WorldDocument): DocState {
  let state = states.get(doc);
  if (!state) states.set(doc, (state = { loaded: new Map(), dirty: new Set() }));
  return state;
}

export const loadedChunks = (doc: WorldDocument) => docState(doc).loaded;
export const hasLoaded = (doc: WorldDocument, ck: string) =>
  docState(doc).loaded.has(ck);
export const loadedKeys = (doc: WorldDocument) => [
  ...docState(doc).loaded.keys(),
];

/** The pure generated baseline for a cell, ignoring sparse edits. */
export const baselineAt = (doc: WorldDocument, p: Vec3) =>
  generatedBlockAt(doc.seed, p.x, p.y, p.z, doc.legacy);

export const emptyEdit = (): ChunkEdit => ({ set: {}, removed: {} });

function editFor(doc: WorldDocument, ck: string) {
  return (doc.edits[ck] ||= emptyEdit());
}

function pruneEdit(doc: WorldDocument, ck: string) {
  const edit = doc.edits[ck];
  if (!edit) return;
  if (!Object.keys(edit.set).length && !Object.keys(edit.removed).length)
    delete doc.edits[ck];
}

/**
 * Write one cell into the sparse document and, when its chunk is resident,
 * into that chunk's grid as well. The sparse document is authoritative, so an
 * edit racing with an unload can never be lost: the next load rebuilds the
 * cell from `edits`.
 */
export function applyOverride(
  doc: WorldDocument,
  p: Vec3,
  material: MaterialId | null,
) {
  if (!inside(p)) return false;
  const k = key(p);
  const ck = chunkKeyAt(p);
  const base = baselineAt(doc, p);

  if (material === null) {
    if (base === undefined) {
      // Removing air is a no-op, but still drop a stale override.
      const edit = doc.edits[ck];
      if (!edit?.set[k]) return false;
      delete edit.set[k];
      delete edit.removed[k];
      pruneEdit(doc, ck);
    } else {
      const edit = editFor(doc, ck);
      edit.removed[k] = true;
      delete edit.set[k];
    }
  } else if (base === material) {
    const edit = doc.edits[ck];
    if (edit) {
      delete edit.set[k];
      delete edit.removed[k];
      pruneEdit(doc, ck);
    }
  } else {
    const edit = editFor(doc, ck);
    edit.set[k] = material;
    delete edit.removed[k];
  }

  const chunk = docState(doc).loaded.get(ck);
  if (chunk) {
    if (material === null) chunk.cells.delete(k);
    else chunk.cells.set(k, material);
    if (base !== undefined && material === null) chunk.cleared.add(k);
    else chunk.cleared.delete(k);
  }
  docState(doc).dirty.add(ck);
  return true;
}

/**
 * Material at a cell, whether or not its chunk is currently resident. The
 * unloaded answer uses the same deterministic baseline plus sparse edits that
 * chunk builds use, so physics and selection never treat an unloaded area as
 * air.
 */
export function materialAt(
  doc: WorldDocument,
  p: Vec3,
): MaterialId | undefined {
  const ck = chunkKeyAt(p);
  const k = key(p);
  const chunk = docState(doc).loaded.get(ck);
  if (chunk) return chunk.cells.get(k);
  const edit = doc.edits[ck];
  if (edit) {
    if (edit.removed[k]) return undefined;
    const set = edit.set[k];
    if (set) return set;
  }
  return baselineAt(doc, p);
}

export const solidAt = (doc: WorldDocument, p: Vec3) => !!materialAt(doc, p);
export const at = (doc: WorldDocument, p: Vec3) => materialAt(doc, p);

/** Build a chunk from the baseline plus its sparse overrides. */
export function buildChunk(
  doc: WorldDocument,
  cx: number,
  cz: number,
): LoadedChunk {
  const cells = generateChunkCells(doc.seed, doc.legacy, cx, cz);
  const cleared = new Set<string>();
  const edit = doc.edits[chunkKey(cx, cz)];
  if (edit) {
    for (const [k, material] of Object.entries(edit.set)) cells.set(k, material);
    for (const k of Object.keys(edit.removed)) {
      cells.delete(k);
      cleared.add(k);
    }
  }
  return { cx, cz, cells, cleared };
}

export function setLoaded(doc: WorldDocument, chunk: LoadedChunk) {
  const state = docState(doc);
  const ck = chunkKey(chunk.cx, chunk.cz);
  state.loaded.set(ck, chunk);
  // A chunk that just finished building already reflects every edit that
  // landed before it was constructed, so it needs no rebuild.
  state.dirty.delete(ck);
}

export function dropLoaded(doc: WorldDocument, ck: string) {
  const state = docState(doc);
  state.loaded.delete(ck);
  state.dirty.delete(ck);
}

/** Chunks whose resident mesh must be rebuilt, then forget them. */
export function takeDirtyChunks(doc: WorldDocument) {
  const state = docState(doc);
  const dirty = [...state.dirty].filter((ck) => state.loaded.has(ck));
  state.dirty.clear();
  return dirty;
}

/**
 * Stats for the authored world (player and migrated blocks), not for the
 * endless generated terrain. Counting `edits` directly makes the numbers
 * identical whether chunks are loaded or not, and cheap to compute.
 */
export function summarize(doc: WorldDocument): WorldSummary {
  let total = 0;
  let highest = 0;
  const materials = new Set<string>();
  for (const edit of Object.values(doc.edits))
    for (const [k, material] of Object.entries(edit.set)) {
      if (edit.removed[k]) continue;
      total++;
      highest = Math.max(highest, parseKey(k).y + 1);
      materials.add(material);
    }
  return { total, highest, materials: materials.size };
}

export function overlapsPlayer(p: Vec3, player: Vec3) {
  return (
    Math.abs(p.x + 0.5 - player.x) < 0.78 &&
    Math.abs(p.z + 0.5 - player.z) < 0.78 &&
    p.y < player.y + 1.7 &&
    p.y + 1 > player.y
  );
}

/** Cells of a chunk, grouped by material, for instanced meshes. */
export function chunkByMaterial(chunk: LoadedChunk) {
  const groups = new Map<MaterialId, Vec3[]>();
  for (const [k, material] of chunk.cells) {
    let list = groups.get(material);
    if (!list) groups.set(material, (list = []));
    list.push(parseKey(k));
  }
  return groups;
}

export { chunkCoord };
