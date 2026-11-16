export type MaterialId =
  | "grass"
  | "soil"
  | "stone"
  | "wood"
  | "sand"
  | "brick"
  | "glass"
  | "leaf";
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Block extends Vec3 {
  material: MaterialId;
}

/** Horizontal chunk edge, in blocks. Chunks are 16 × 20 × 16 columns. */
export const CHUNK_SIZE = 16;
/** Vertical world limit. Chunks span the full world height. */
export const WORLD_HEIGHT = 20;
/**
 * A deliberately very large safety rail (not a gameplay map edge). Terrain is
 * streamed in chunks and has no practical boundary; this only keeps
 * coordinates finite and JSON keys bounded.
 */
export const WORLD_XZ_LIMIT = 1_000_000;

export interface ChunkEdit {
  /** Cells whose final material differs from the generated baseline. */
  set: Record<string, MaterialId>;
  /** Baseline cells that have been removed. */
  removed: Record<string, true>;
}

/**
 * Old fixed-size worlds keep their original map authoritative. Procedural
 * terrain is suppressed inside these horizontal bounds, so migration never
 * invents blocks under the old cottage and never clips a building that sat on
 * the old edge. Their blocks live in `edits` like any later modification.
 */
export interface LegacyBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The on-disk world format. Only sparse edits are stored, never every loaded
 * chunk, so building and saving do not wait for terrain streaming and memory
 * stays flat however far the player walks.
 */
export interface WorldDocument {
  version: 2;
  name: string;
  seed: number;
  edits: Record<string, ChunkEdit>;
  legacy?: LegacyBounds;
  inventory: Record<MaterialId, number>;
  player: Vec3;
  revision: number;
}

/** The old fixed-size format, kept so existing saves can be migrated. */
export interface LegacyWorldDocument {
  version: 1;
  name: string;
  blocks: Record<string, Block>;
  inventory: Record<MaterialId, number>;
  player: Vec3;
  revision: number;
}

export interface Region {
  a: Vec3;
  b: Vec3;
}
export type Tool = "place" | "remove" | "select";
export interface Workspace {
  doc: WorldDocument;
  material: MaterialId;
  tool: Tool;
  region: Region | null;
  anchor: Vec3 | null;
  message: string;
  dirty: boolean;
  mode: "build" | "walk";
  savedAt: string | null;
  /** Reactive mirror of the streamer's loaded chunk count. */
  loadedChunks: number;
}
export const key = (p: Vec3) => `${p.x},${p.y},${p.z}`;
export const parseKey = (k: string) => {
  const [x, y, z] = k.split(",").map(Number);
  return { x, y, z };
};
export const chunkCoord = (v: number) => Math.floor(v / CHUNK_SIZE);
export const chunkKey = (cx: number, cz: number) => `${cx},${cz}`;
export const chunkKeyAt = (p: Vec3) =>
  chunkKey(chunkCoord(p.x), chunkCoord(p.z));
export const chunkKeyOfBlock = (k: string) =>
  chunkKeyAt(parseKey(k));
export const parseChunkKey = (k: string) => {
  const [cx, cz] = k.split(",").map(Number);
  return { cx, cz };
};
/** The old v1 map area, inclusive on both ends. */
export const LEGACY_BOUNDS: LegacyBounds = {
  minX: -16,
  maxX: 15,
  minZ: -16,
  maxZ: 15,
};

export const insideLegacy = (p: Vec3, b: LegacyBounds = LEGACY_BOUNDS) =>
  p.x >= b.minX &&
  p.x <= b.maxX &&
  p.z >= b.minZ &&
  p.z <= b.maxZ &&
  p.y >= 0 &&
  p.y < WORLD_HEIGHT;

/** Horizontal reach is effectively unbounded; height remains a real bound. */
export const inside = (p: Vec3) =>
  Number.isInteger(p.x) &&
  Number.isInteger(p.y) &&
  Number.isInteger(p.z) &&
  Math.abs(p.x) <= WORLD_XZ_LIMIT &&
  Math.abs(p.z) <= WORLD_XZ_LIMIT &&
  p.y >= 0 &&
  p.y < WORLD_HEIGHT;
