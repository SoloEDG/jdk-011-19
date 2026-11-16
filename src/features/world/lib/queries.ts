import type { WorldDocument, Vec3 } from "../../../shared/document";
import { materialAt } from "./chunks";

export { summarize } from "./chunks";
export { materialAt, solidAt } from "./chunks";
export const at = (doc: WorldDocument, p: Vec3) => materialAt(doc, p);
export function overlapsPlayer(p: Vec3, player: Vec3) {
  return (
    Math.abs(p.x + 0.5 - player.x) < 0.78 &&
    Math.abs(p.z + 0.5 - player.z) < 0.78 &&
    p.y < player.y + 1.7 &&
    p.y + 1 > player.y
  );
}
