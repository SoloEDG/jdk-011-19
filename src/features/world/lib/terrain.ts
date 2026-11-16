import type {
  Block,
  LegacyBounds,
  MaterialId,
  WorldDocument,
} from "../../../shared/document";
import {
  CHUNK_SIZE,
  LEGACY_BOUNDS,
  WORLD_HEIGHT,
  chunkKeyAt,
  inside,
  key,
} from "../../../shared/document";
import { initialStock } from "../../../shared/materials";

export const DEFAULT_SEED = 20261116;
/** Radius around spawn kept as the flat demo meadow. */
const MEADOW_RADIUS = 14;
const MEADOW_BLEND = 28;
/** How far generated relief takes to blend into a migrated map's edge. */
const LEGACY_BLEND = 26;

const hash2 = (a: number, b: number, salt = 0) => {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};
const unit = (a: number, b: number, salt = 0) => hash2(a, b, salt) / 0xffffffff;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);

const noise = (x: number, z: number, salt: number) => {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = unit(ix, iz, salt);
  const b = unit(ix + 1, iz, salt);
  const c = unit(ix, iz + 1, salt);
  const d = unit(ix + 1, iz + 1, salt);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
};

/** Raw relief before the flat starting meadow is blended in. */
const relief = (seed: number, x: number, z: number) => {
  const broad = noise(x / 24, z / 24, seed) * 5.4;
  const detail = noise(x / 7, z / 7, seed ^ 0x9e3779b9) * 1.8;
  return 2 + Math.floor(broad + detail);
};

const legacyDistance = (b: LegacyBounds, x: number, z: number) => {
  const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
  const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
  return Math.hypot(dx, dz);
};

/**
 * Deterministic surface height. For a new world the old demo meadow stays
 * flat; for a migrated world its old rectangle stays flat and the new relief
 * blends in outside, so the seam is walkable and old buildings keep their
 * ground level.
 */
const surfaceCache = new Map<string, number>();
export function surfaceHeight(
  seed: number,
  x: number,
  z: number,
  legacy?: LegacyBounds,
) {
  // Column height is queried for every cell of a chunk and for collision; a
  // small bounded memo keeps those lookups cheap and deterministic.
  const memoKey = `${seed}|${x}|${z}|${legacy ? `${legacy.minX},${legacy.maxX},${legacy.minZ},${legacy.maxZ}` : ""}`;
  const hit = surfaceCache.get(memoKey);
  if (hit !== undefined) return hit;
  const raw = relief(seed, x, z);
  let height: number;
  if (legacy) {
    const d = legacyDistance(legacy, x, z);
    if (d <= 0) height = 1;
    else if (d >= LEGACY_BLEND) height = raw;
    else
      height = Math.max(1, Math.round(lerp(1, raw, smooth(d / LEGACY_BLEND))));
  } else {
    const radius = Math.hypot(x, z);
    if (radius <= MEADOW_RADIUS) height = 1;
    else if (radius >= MEADOW_BLEND) height = raw;
    else
      height = Math.max(
        1,
        Math.round(
          lerp(
            1,
            raw,
            smooth((radius - MEADOW_RADIUS) / (MEADOW_BLEND - MEADOW_RADIUS)),
          ),
        ),
      );
  }
  if (surfaceCache.size > 200_000) surfaceCache.clear();
  surfaceCache.set(memoKey, height);
  return height;
}

const isOpen = (x: number, z: number, legacy?: LegacyBounds) =>
  legacy ? legacyDistance(legacy, x, z) > 4 : Math.hypot(x, z) > MEADOW_RADIUS;

export const isSandy = (
  seed: number,
  x: number,
  z: number,
  legacy?: LegacyBounds,
) =>
  isOpen(x, z, legacy) &&
  noise(x / 18, z / 18, seed ^ 0x5bd1e995) > 0.58;

const treeAnchor = (
  seed: number,
  x: number,
  z: number,
  legacy?: LegacyBounds,
) =>
  isOpen(x, z, legacy) &&
  hash2(x, z, seed ^ 0x7f4a7c15) % 61 === 0;

const boulderAnchor = (
  seed: number,
  x: number,
  z: number,
  legacy?: LegacyBounds,
) =>
  isOpen(x, z, legacy) &&
  hash2(x, z, seed ^ 0x165667b1) % 211 === 0;

/** Leaf silhouette offset for a tree whose leaf base is `dy = 0`. */
const leafAt = (dx: number, dz: number, dy: number) => {
  if (dy === 0) return Math.abs(dx) <= 2 && Math.abs(dz) <= 2;
  if (dy === 1) return Math.abs(dx) <= 1 && Math.abs(dz) <= 1;
  return dy === 2 && dx === 0 && dz === 0;
};

/**
 * The pure baseline of the endless terrain. Every chunk derives from this
 * function, so chunks loaded at different times always agree on shared cells,
 * and collision can query terrain that has never been meshed.
 */
export function generatedBlockAt(
  seed: number,
  x: number,
  y: number,
  z: number,
  legacy?: LegacyBounds,
): MaterialId | undefined {
  if (!inside({ x, y, z })) return undefined;
  // A migrated save is authoritative inside its old rectangle: generating
  // anything here could fill a dug hole or bury a building that touched the
  // old edge. Outside the rectangle terrain blends up to the old ground level.
  if (
    legacy &&
    x >= legacy.minX &&
    x <= legacy.maxX &&
    z >= legacy.minZ &&
    z <= legacy.maxZ
  )
    return undefined;
  const top = surfaceHeight(seed, x, z, legacy);
  if (y <= top) {
    const sandy = isSandy(seed, x, z, legacy);
    if (y === top) return sandy ? "sand" : "grass";
    if (y >= top - 2) return sandy ? "sand" : "soil";
    return "stone";
  }
  if (boulderAnchor(seed, x, z, legacy) && y === top + 1) return "stone";
  for (let ax = x - 2; ax <= x + 2; ax++)
    for (let az = z - 2; az <= z + 2; az++) {
      if (!treeAnchor(seed, ax, az, legacy)) continue;
      const base = surfaceHeight(seed, ax, az, legacy);
      const dx = x - ax;
      const dz = z - az;
      if (dx === 0 && dz === 0 && y >= base + 1 && y <= base + 4)
        return "wood";
      if (leafAt(dx, dz, y - (base + 4))) return "leaf";
    }
  return undefined;
}

/** The original demo cottage, at exactly its old coordinates. */
function cottageBlocks(): Block[] {
  const blocks: Block[] = [];
  const put = (x: number, y: number, z: number, material: MaterialId) =>
    blocks.push({ x, y, z, material });
  for (let x = -4; x <= 3; x++)
    for (let z = -4; z <= 2; z++) put(x, 2, z, "wood");
  for (let y = 3; y <= 6; y++) {
    for (let x = -4; x <= 3; x++) {
      put(x, y, -4, y === 4 ? "glass" : "brick");
      if (x !== -1 && x !== 0) put(x, y, 2, "brick");
    }
    for (let z = -3; z <= 1; z++) {
      put(-4, y, z, y === 4 ? "glass" : "brick");
      put(3, y, z, y === 4 ? "glass" : "brick");
    }
  }
  for (let x = -5; x <= 4; x++)
    for (let z = -5; z <= 3; z++) put(x, 7, z, "wood");
  for (let z = 3; z < 11; z++)
    for (let x = -1; x <= 0; x++) put(x, 2, z, "sand");
  for (const [tx, tz] of [
    [7, 6],
    [-7, -6],
    [6, -7],
  ]) {
    for (let y = 2; y < 6; y++) put(tx, y, tz, "wood");
    for (let x = -2; x <= 2; x++)
      for (let z = -2; z <= 2; z++)
        for (let y = 5; y <= 7; y++)
          if (Math.abs(x) + Math.abs(z) < 4) put(tx + x, y, tz + z, "leaf");
  }
  return blocks;
}

export function demoEdits(): WorldDocument["edits"] {
  const edits: WorldDocument["edits"] = {};
  for (const b of cottageBlocks()) {
    const record = (edits[chunkKeyAt(b)] ||= { set: {}, removed: {} });
    record.set[key(b)] = b.material;
  }
  return edits;
}

export function createWorld(): WorldDocument {
  return {
    version: 2,
    name: "林间小屋",
    seed: DEFAULT_SEED,
    edits: demoEdits(),
    inventory: initialStock(),
    player: { x: 0, y: 3, z: 9 },
    revision: 0,
  };
}

/** Union of the old fixed bounds and every block in a migrated save. */
export function legacyBoundsFor(blocks: Record<string, Block>): LegacyBounds {
  const b: LegacyBounds = { ...LEGACY_BOUNDS };
  for (const block of Object.values(blocks)) {
    b.minX = Math.min(b.minX, block.x);
    b.maxX = Math.max(b.maxX, block.x);
    b.minZ = Math.min(b.minZ, block.z);
    b.maxZ = Math.max(b.maxZ, block.z);
  }
  return b;
}

/**
 * Fast path used when building a chunk: the same result as calling
 * `generatedBlockAt` for every cell, but tree / boulder anchors are resolved
 * once per chunk instead of once per air cell.
 */
export function generateChunkCells(
  seed: number,
  legacy: LegacyBounds | undefined,
  cx: number,
  cz: number,
) {
  const cells = new Map<string, MaterialId>();
  const minX = cx * CHUNK_SIZE;
  const minZ = cz * CHUNK_SIZE;
  const maxX = minX + CHUNK_SIZE - 1;
  const maxZ = minZ + CHUNK_SIZE - 1;
  const trees: { x: number; z: number; base: number }[] = [];
  for (let ax = minX - 2; ax <= maxX + 2; ax++)
    for (let az = minZ - 2; az <= maxZ + 2; az++)
      if (treeAnchor(seed, ax, az, legacy))
        trees.push({ x: ax, z: az, base: surfaceHeight(seed, ax, az, legacy) });

  const put = (x: number, y: number, z: number, material: MaterialId) => {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    // A migrated save is authoritative inside its old rectangle.
    if (
      legacy &&
      x >= legacy.minX &&
      x <= legacy.maxX &&
      z >= legacy.minZ &&
      z <= legacy.maxZ
    )
      return;
    cells.set(key({ x, y, z }), material);
  };
  /** Trees only fill air and the first anchor in scan order wins. */
  const plant = (x: number, y: number, z: number, material: MaterialId) => {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const k = key({ x, y, z });
    if (!cells.has(k)) put(x, y, z, material);
  };

  for (let x = minX; x <= maxX; x++)
    for (let z = minZ; z <= maxZ; z++) {
      const top = surfaceHeight(seed, x, z, legacy);
      const sandy = isSandy(seed, x, z, legacy);
      for (let y = 0; y <= top; y++) {
        if (y === top) put(x, y, z, sandy ? "sand" : "grass");
        else if (y >= top - 2) put(x, y, z, sandy ? "sand" : "soil");
        else put(x, y, z, "stone");
      }
      if (boulderAnchor(seed, x, z, legacy)) put(x, top + 1, z, "stone");
      for (const tree of trees) {
        const dx = x - tree.x;
        const dz = z - tree.z;
        if (dx < -2 || dx > 2 || dz < -2 || dz > 2) continue;
        if (dx === 0 && dz === 0)
          for (let y = tree.base + 1; y <= tree.base + 4; y++)
            plant(x, y, z, "wood");
        for (let dy = 0; dy <= 2; dy++)
          if (leafAt(dx, dz, dy) && !(dx === 0 && dz === 0 && dy === 0))
            plant(x, tree.base + 4 + dy, z, "leaf");
      }
    }
  return cells;
}
