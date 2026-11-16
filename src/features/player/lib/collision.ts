import { key, type Vec3, type WorldDocument } from "../../../shared/document";
import { solidAt } from "../../world/lib/chunks";

/**
 * Solid-cell query for the player's bounding box. It reads the sparse world
 * store, which answers for unloaded chunks from the deterministic baseline,
 * so walking into an area that is not meshed yet cannot drop the player.
 */
export function collides(doc: WorldDocument, p: Vec3) {
  for (let x = Math.floor(p.x - 0.28); x <= Math.floor(p.x + 0.28); x++)
    for (let z = Math.floor(p.z - 0.28); z <= Math.floor(p.z + 0.28); z++)
      for (let y = Math.floor(p.y + 0.01); y <= Math.floor(p.y + 1.65); y++)
        if (solidAt(doc, { x, y, z })) return true;
  return false;
}

export { key };
