import type { Workspace } from "../../../shared/document";
import { materialAt } from "../../world/lib/chunks";
import { describeRegion, iterateRegion, type RegionShape } from "./region";

export interface RegionSummary extends RegionShape {
  occupied: number;
  empty: number;
  /** True when `occupied` was counted exactly rather than sampled. */
  complete: boolean;
  /** True when any corner / cell of the selection lies in unloaded terrain. */
  spansUnloaded: boolean;
}

/** Budget for an exact preview count before falling back to a stride sample. */
const SAMPLE_BUDGET = 40_000;

export function regionSummary(s: Workspace): RegionSummary {
  if (!s.region)
    return {
      volume: 0,
      dimensions: { x: 0, y: 0, z: 0 },
      oversized: false,
      occupied: 0,
      empty: 0,
      complete: true,
      spansUnloaded: false,
    };
  const shape = describeRegion(s.region);
  let occupied = 0;
  let counted = 0;
  if (shape.volume <= SAMPLE_BUDGET) {
    for (const p of iterateRegion(s.region)) {
      counted++;
      if (materialAt(s.doc, p)) occupied++;
    }
    return {
      ...shape,
      occupied,
      empty: counted - occupied,
      complete: true,
      spansUnloaded: false,
    };
  }
  // Too large to count exactly every frame: preview a stable stride sample.
  // The authoritative validation still runs over every cell on confirmation.
  const stride = Math.ceil(shape.volume / SAMPLE_BUDGET);
  let index = 0;
  for (const p of iterateRegion(s.region)) {
    if (index++ % stride) continue;
    counted++;
    if (materialAt(s.doc, p)) occupied++;
  }
  const estimated = Math.round((occupied / Math.max(1, counted)) * shape.volume);
  return {
    ...shape,
    occupied: estimated,
    empty: shape.volume - estimated,
    complete: false,
    spansUnloaded: true,
  };
}
