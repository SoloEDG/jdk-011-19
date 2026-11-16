import type { Workspace } from "../../../shared/document";
import { WORLD_XZ_LIMIT } from "../../../shared/document";
import { collides } from "./collision";

export interface Motion {
  vertical: number;
  grounded: boolean;
}

const SAFE_STEP = 0.45;
/** Tallest ledge the player can walk up without jumping. */
const STEP_UP = 1.05;

/** Keep the player inside the (very wide) world coordinate safety rail. */
const clampXZ = (v: number) =>
  Math.max(-WORLD_XZ_LIMIT, Math.min(WORLD_XZ_LIMIT, v));
const inBounds = (p: { x: number; z: number }) =>
  Math.abs(p.x) <= WORLD_XZ_LIMIT && Math.abs(p.z) <= WORLD_XZ_LIMIT;

/**
 * Move one axis, stepping up a single block when the generated terrain rises.
 * Unloaded terrain is still solid here (see collision), so a rise that has not
 * streamed in blocks exactly like one that has.
 */
function stride(
  s: Workspace,
  axis: "x" | "z",
  amount: number,
  grounded: boolean,
) {
  const p = s.doc.player;
  const next = { ...p, [axis]: clampXZ(p[axis] + amount) };
  if (!inBounds(next)) return;
  if (!collides(s.doc, next)) {
    p[axis] = next[axis];
    return;
  }
  if (!grounded) return;
  const raised = { ...next, y: next.y + STEP_UP - 0.02 };
  if (collides(s.doc, raised)) return;
  p[axis] = next[axis];
  p.y = raised.y;
}

export function stepPlayer(
  s: Workspace,
  keys: Set<string>,
  motion: Motion,
  dt: number,
) {
  if (s.mode !== "walk") return;
  const p = s.doc.player;
  const speed = 4 * dt;
  let dx = (Number(keys.has("KeyD")) - Number(keys.has("KeyA"))) * speed,
    dz = (Number(keys.has("KeyS")) - Number(keys.has("KeyW"))) * speed;
  if (dx && dz) {
    dx /= Math.SQRT2;
    dz /= Math.SQRT2;
  }
  // Substep so a fast frame cannot tunnel through a one-block wall.
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / SAFE_STEP));
  for (let step = 0; step < steps; step++) {
    stride(s, "x", dx / steps, motion.grounded);
    stride(s, "z", dz / steps, motion.grounded);
  }
  if (keys.has("Space") && motion.grounded) {
    motion.vertical = 6;
    motion.grounded = false;
  }
  motion.vertical -= 18 * dt;
  const next = { ...p, y: p.y + motion.vertical * dt };
  if (collides(s.doc, next)) {
    motion.grounded = motion.vertical < 0;
    motion.vertical = 0;
  } else {
    p.y = next.y;
    motion.grounded = false;
  }
  if (p.y < -5) {
    Object.assign(p, { x: 0, y: 12, z: 9 });
    motion.vertical = 0;
  }
  s.dirty = true;
}
