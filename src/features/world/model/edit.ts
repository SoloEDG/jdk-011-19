import type { Workspace } from "../../../shared/document";
import type { EditResult } from "../../../shared/commands";
import { applyOverride, materialAt } from "../lib/chunks";
import { overlapsPlayer } from "../lib/queries";
import { key, type MaterialId, type Vec3 } from "../../../shared/document";
import { describeRegion, iterateRegion } from "../../selection/lib/region";

/** Upper bound for one batch edit, to keep a stray selection responsive. */
export const MAX_BATCH_CELLS = 262_144;

interface Planned {
  cell: Vec3;
  from: MaterialId | null;
  to: MaterialId | null;
}

export interface BatchPlan {
  ok: boolean;
  message: string;
  /** Cells that would actually change. */
  changes: Planned[];
  /** Requested volume, before duplicate removal. */
  volume: number;
  /** Cells that cannot change (already filled / already empty). */
  skipped: number;
  /** Blocks needed (fill) or returned (remove), by material. */
  materials: Partial<Record<MaterialId, number>>;
  blockedByPlayer: boolean;
}

const tooLarge = (volume: number): BatchPlan => ({
  ok: false,
  message: `区域包含 ${volume.toLocaleString()} 格，超过单次上限 ${MAX_BATCH_CELLS.toLocaleString()} 格，请缩小选区`,
  changes: [],
  volume,
  skipped: 0,
  materials: {},
  blockedByPlayer: false,
});

/**
 * Validate a whole batch before touching the world. Nothing is written until
 * every cell passed, so a failed fill can never leave a half-built region.
 * Occupancy comes from the sparse store, which answers for chunks that are
 * loaded, unloaded, or still streaming, so the result does not depend on
 * terrain streaming timing.
 */
export function planBatch(
  s: Workspace,
  cells: Iterable<Vec3>,
  remove = false,
): BatchPlan {
  const plan: BatchPlan = {
    ok: true,
    message: "",
    changes: [],
    volume: 0,
    skipped: 0,
    materials: {},
    blockedByPlayer: false,
  };
  const seen = new Set<string>();
  for (const p of cells) {
    if (++plan.volume > MAX_BATCH_CELLS) return tooLarge(plan.volume);
    const k = key(p);
    if (seen.has(k)) continue;
    seen.add(k);
    const from = materialAt(s.doc, p) ?? null;
    if (!remove) {
      if (from) {
        plan.skipped++;
        continue;
      }
      if (overlapsPlayer(p, s.doc.player)) plan.blockedByPlayer = true;
      plan.changes.push({ cell: { x: p.x, y: p.y, z: p.z }, from, to: s.material });
      plan.materials[s.material] = (plan.materials[s.material] ?? 0) + 1;
    } else {
      // The bottom layer is bedrock: removing it would open a hole the player
      // can fall through, and the old fixed map never allowed it either.
      if (!from || p.y === 0) {
        plan.skipped++;
        continue;
      }
      plan.changes.push({ cell: { x: p.x, y: p.y, z: p.z }, from, to: null });
      plan.materials[from] = (plan.materials[from] ?? 0) + 1;
    }
  }
  if (plan.blockedByPlayer)
    return { ...plan, ok: false, message: "选区包含角色所在位置，未进行建造" };
  if (!remove)
    for (const [id, count] of Object.entries(plan.materials) as [
      MaterialId,
      number,
    ][])
      if ((s.doc.inventory[id] ?? 0) < count)
        return {
          ...plan,
          ok: false,
          message: `物品数量不足（需要 ${count.toLocaleString()} 个），未进行建造`,
        };
  return plan;
}

/** Apply an already-validated plan. */
export function commitPlan(s: Workspace, plan: BatchPlan): EditResult {
  if (!plan.ok) return { ok: false, message: plan.message, changed: [] };
  const changed = [];
  let added = 0,
    removed = 0;
  for (const step of plan.changes) {
    if (!applyOverride(s.doc, step.cell, step.to)) continue;
    if (step.to === null) {
      if (step.from) s.doc.inventory[step.from]++;
      removed++;
    } else {
      s.doc.inventory[step.to]--;
      added++;
    }
    changed.push(
      step.to === null
        ? {
            x: step.cell.x,
            y: step.cell.y,
            z: step.cell.z,
            material: step.from!,
          }
        : { x: step.cell.x, y: step.cell.y, z: step.cell.z, material: step.to },
    );
  }
  if (changed.length) {
    s.doc.revision++;
    s.dirty = true;
  }
  return {
    ok: true,
    message: changed.length
      ? `修改了 ${changed.length.toLocaleString()} 个方块（放置 ${added.toLocaleString()} · 拆除 ${removed.toLocaleString()}）`
      : "没有可修改的方块",
    changed,
  };
}

export function editCells(
  s: Workspace,
  cells: Vec3[],
  remove = false,
): EditResult {
  return commitPlan(s, planBatch(s, cells, remove));
}

/**
 * Plan + commit a region lazily. The size check happens before enumeration,
 * so a selection that spans millions of unloaded cells fails fast and safely
 * rather than hanging the frame.
 */
export function editRegion(s: Workspace, remove = false): EditResult {
  if (!s.region) return { ok: false, message: "请先选择区域", changed: [] };
  const shape = describeRegion(s.region);
  if (shape.oversized) return { ok: false, message: tooLarge(shape.volume).message, changed: [] };
  return commitPlan(s, planBatch(s, iterateRegion(s.region), remove));
}
