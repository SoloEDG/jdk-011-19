import type {
  ChunkEdit,
  LegacyWorldDocument,
  MaterialId,
  WorldDocument,
} from "../../../shared/document";
import {
  CHUNK_SIZE,
  WORLD_XZ_LIMIT,
  chunkKeyAt,
  inside,
  key,
  parseKey,
} from "../../../shared/document";
import { materials } from "../../../shared/materials";
import { legacyBoundsFor } from "../../world/lib/terrain";

const MAX_FILE = 64_000_000;
const MAX_EDITS = 4_000_000;
const MAX_CHUNKS = 1_000_000;

const isMaterial = (m: unknown): m is MaterialId =>
  typeof m === "string" && materials.some((entry) => entry.id === m);

const validInventory = (inv: unknown): inv is Record<MaterialId, number> => {
  if (!inv || typeof inv !== "object") return false;
  const record = inv as Record<string, unknown>;
  return materials.every(
    (m) =>
      Number.isInteger(record[m.id]) &&
      (record[m.id] as number) >= 0 &&
      (record[m.id] as number) <= Number.MAX_SAFE_INTEGER,
  );
};

const validPlayer = (p: unknown): p is { x: number; y: number; z: number } =>
  !!p &&
  typeof p === "object" &&
  ["x", "y", "z"].every((axis) =>
    Number.isFinite((p as Record<string, unknown>)[axis]),
  );

/**
 * Migrate the old fixed-size document. Inventory is copied untouched, and
 * every old block is kept at its original coordinates as a sparse override.
 * The old rectangle becomes `legacy` bounds so generated terrain is flat
 * there: nothing is added under the cottage and nothing that sat on the old
 * edge gets clipped. After migration, walking away, returning, or reopening
 * the save yields exactly the same blocks and collision.
 */
export function migrateV1(old: LegacyWorldDocument): WorldDocument {
  const edits: Record<string, ChunkEdit> = {};
  for (const [k, block] of Object.entries(old.blocks)) {
    const record = (edits[chunkKeyAt(block)] ||= { set: {}, removed: {} });
    record.set[k] = block.material;
  }
  const doc: WorldDocument = {
    version: 2,
    name: old.name,
    seed: 20261116,
    edits,
    legacy: legacyBoundsFor(old.blocks),
    inventory: { ...old.inventory },
    player: { ...old.player },
    revision: old.revision,
  };
  return doc;
}

export function encode(doc: WorldDocument) {
  return JSON.stringify(doc);
}

/** Validate sparse edits and bound them by coordinates and count. */
function decodeV2(d: Record<string, unknown>): WorldDocument {
  if (typeof d.name !== "string") throw Error("世界名称无效");
  if (!Number.isInteger(d.seed) || !Number.isSafeInteger(d.seed))
    throw Error("世界种子无效");
  if (!validInventory(d.inventory)) throw Error("物品栏数据无效");
  if (!validPlayer(d.player)) throw Error("角色坐标无效");
  if (!Number.isInteger(d.revision) || (d.revision as number) < 0)
    throw Error("世界版本无效");
  if (!d.edits || typeof d.edits !== "object") throw Error("世界区块数据无效");

  let legacy = undefined as WorldDocument["legacy"];
  if (d.legacy !== undefined) {
    const l = d.legacy as Record<string, number>;
    if (
      !l ||
      !["minX", "maxX", "minZ", "maxZ"].every((k) => Number.isInteger(l[k])) ||
      l.minX > l.maxX ||
      l.minZ > l.maxZ
    )
      throw Error("世界旧边界数据无效");
    legacy = { minX: l.minX, maxX: l.maxX, minZ: l.minZ, maxZ: l.maxZ };
  }

  const entries = Object.entries(d.edits as Record<string, unknown>);
  if (entries.length > MAX_CHUNKS) throw Error("区块数量超出限制");
  let cells = 0;
  const edits: Record<string, ChunkEdit> = {};
  for (const [ck, raw] of entries) {
    const [cx, cz] = ck.split(",").map(Number);
    if (
      !Number.isInteger(cx) ||
      !Number.isInteger(cz) ||
      Math.abs(cx * CHUNK_SIZE) > WORLD_XZ_LIMIT ||
      Math.abs(cz * CHUNK_SIZE) > WORLD_XZ_LIMIT
    )
      throw Error("区块坐标无效");
    if (!raw || typeof raw !== "object") throw Error("区块数据无效");
    const chunk = raw as { set?: unknown; removed?: unknown };
    const set: Record<string, MaterialId> = {};
    const removed: Record<string, true> = {};
    for (const [k, material] of Object.entries(
      (chunk.set as Record<string, unknown>) ?? {},
    )) {
      const p = parseKey(k);
      if (
        !inside(p) ||
        key(p) !== k ||
        chunkKeyAt(p) !== ck ||
        !isMaterial(material)
      )
        throw Error("区块包含无效方块");
      if (++cells > MAX_EDITS) throw Error("方块数量超出世界边界");
      set[k] = material;
    }
    for (const [k, mark] of Object.entries(
      (chunk.removed as Record<string, unknown>) ?? {},
    )) {
      const p = parseKey(k);
      if (
        mark !== true ||
        !inside(p) ||
        key(p) !== k ||
        chunkKeyAt(p) !== ck
      )
        throw Error("区块包含无效的移除记录");
      if (++cells > MAX_EDITS) throw Error("方块数量超出世界边界");
      removed[k] = true;
    }
    edits[ck] = { set, removed };
  }
  return {
    version: 2,
    name: d.name,
    seed: d.seed as number,
    edits,
    legacy,
    inventory: { ...(d.inventory as Record<MaterialId, number>) },
    player: {
      x: d.player.x,
      y: d.player.y,
      z: d.player.z,
    },
    revision: d.revision as number,
  };
}

function decodeV1(d: Record<string, unknown>): WorldDocument {
  if (
    typeof d.name !== "string" ||
    !d.blocks ||
    typeof d.blocks !== "object" ||
    !validInventory(d.inventory) ||
    !validPlayer(d.player) ||
    !Number.isInteger(d.revision) ||
    (d.revision as number) < 0
  )
    throw Error("无法识别的世界文件");
  const entries = Object.entries(d.blocks as Record<string, unknown>);
  if (entries.length > 20480) throw Error("方块数量超出世界边界");
  const blocks: LegacyWorldDocument["blocks"] = {};
  for (const [k, raw] of entries) {
    const b = raw as Record<string, unknown>;
    if (!b || typeof b !== "object" || !isMaterial(b.material))
      throw Error("文件包含无效方块");
    const p = { x: b.x, y: b.y, z: b.z } as {
      x: number;
      y: number;
      z: number;
    };
    if (
      ![p.x, p.y, p.z].every(Number.isInteger) ||
      p.y < 0 ||
      p.y >= 20 ||
      key(p) !== k
    )
      throw Error("文件包含无效方块");
    blocks[k] = { ...p, material: b.material };
  }
  return migrateV1({
    version: 1,
    name: d.name,
    blocks,
    inventory: { ...(d.inventory as Record<MaterialId, number>) },
    player: { x: d.player.x, y: d.player.y, z: d.player.z },
    revision: d.revision as number,
  });
}

export function decode(raw: string): WorldDocument {
  if (raw.length > MAX_FILE) throw Error("世界文件过大");
  const d = JSON.parse(raw) as Record<string, unknown>;
  if (!d || typeof d !== "object") throw Error("无法识别的世界文件");
  if (d.version === 1) return decodeV1(d);
  if (d.version === 2) return decodeV2(d);
  throw Error("无法识别的世界文件");
}
