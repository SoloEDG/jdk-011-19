import type { Region, Vec3 } from "../../../shared/document";

export const MAX_REGION_VOLUME = 262_144;

export function regionDimensions(r: Region) {
  return {
    x: Math.abs(r.a.x - r.b.x) + 1,
    y: Math.abs(r.a.y - r.b.y) + 1,
    z: Math.abs(r.a.z - r.b.z) + 1,
  };
}

export const dimensions = regionDimensions;

export interface RegionShape {
  volume: number;
  dimensions: ReturnType<typeof regionDimensions>;
  /** True when the region exceeds the single-batch limit. */
  oversized: boolean;
}

/**
 * Dimensions and volume of a region without enumerating it. A corner can sit
 * in terrain that has not loaded yet, so the panel must never wait on
 * streaming or walk millions of cells just to show the count.
 */
export function describeRegion(r: Region): RegionShape {
  const dimensions = regionDimensions(r);
  const volume = dimensions.x * dimensions.y * dimensions.z;
  return { volume, dimensions, oversized: volume > MAX_REGION_VOLUME };
}

/** Lazily enumerate cells, in the same order as the old region helper. */
export function* iterateRegion(r: Region): Generator<Vec3> {
  for (let x = Math.min(r.a.x, r.b.x); x <= Math.max(r.a.x, r.b.x); x++)
    for (let y = Math.min(r.a.y, r.b.y); y <= Math.max(r.a.y, r.b.y); y++)
      for (let z = Math.min(r.a.z, r.b.z); z <= Math.max(r.a.z, r.b.z); z++)
        yield { x, y, z };
}

/** Materialize a region; used by callers that need random access. */
export function regionCells(r: Region): Vec3[] {
  const { volume, oversized } = describeRegion(r);
  if (oversized)
    throw Error(
      `区域过大（${volume.toLocaleString()} 格），请缩小选择范围`,
    );
  return [...iterateRegion(r)];
}
