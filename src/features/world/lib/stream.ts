import type { WorldDocument } from "../../../shared/document";
import { CHUNK_SIZE, chunkCoord, chunkKey } from "../../../shared/document";
import {
  buildChunk,
  dropLoaded,
  hasLoaded,
  loadedKeys,
  setLoaded,
} from "./chunks";

export interface StreamStats {
  loaded: number;
  pending: number;
}

/**
 * Keeps a square of chunks resident around the player. A few chunks are built
 * per frame, nearest first, so the terrain just across a border appears
 * immediately; the far ring is unloaded afterwards. Unloading only frees the
 * resident grid — the sparse document still answers queries for that area, so
 * the player is never suspended over "air".
 */
export function createStreamer(viewRadius = 3, perFrame = 2) {
  let pending: string[] = [];
  let target = new Set<string>();
  let lastCenter = "";

  const centerOf = (focus: { x: number; z: number }) => ({
    cx: chunkCoord(focus.x),
    cz: chunkCoord(focus.z),
  });

  function retarget(doc: WorldDocument, focus: { x: number; z: number }) {
    const { cx, cz } = centerOf(focus);
    target = new Set();
    pending = [];
    // Loaded chunks stay where they are; only missing ones are queued.
    for (let dx = -viewRadius; dx <= viewRadius; dx++)
      for (let dz = -viewRadius; dz <= viewRadius; dz++) {
        const ck = chunkKey(cx + dx, cz + dz);
        target.add(ck);
        if (!hasLoaded(doc, ck)) pending.push(ck);
      }
    pending.sort((a, b) => {
      const [ax, az] = a.split(",").map(Number);
      const [bx, bz] = b.split(",").map(Number);
      return (
        (ax - cx) ** 2 + (az - cz) ** 2 - ((bx - cx) ** 2 + (bz - cz) ** 2)
      );
    });
    lastCenter = `${cx},${cz}`;
  }

  return {
    update(doc: WorldDocument, focus: { x: number; z: number }) {
      if (`${chunkCoord(focus.x)},${chunkCoord(focus.z)}` !== lastCenter)
        retarget(doc, focus);

      // The chunk under the player is built unconditionally and first, so the
      // ground you are standing on never lags behind the frame budget.
      const centerKey = `${chunkCoord(focus.x)},${chunkCoord(focus.z)}`;
      if (!hasLoaded(doc, centerKey)) {
        const [ccx, ccz] = centerKey.split(",").map(Number);
        setLoaded(doc, buildChunk(doc, ccx, ccz));
        pending = pending.filter((ck) => ck !== centerKey);
      }

      let budget = perFrame;
      while (pending.length && budget > 0) {
        const ck = pending.shift()!;
        if (!target.has(ck) || hasLoaded(doc, ck)) continue;
        const [cx, cz] = ck.split(",").map(Number);
        setLoaded(doc, buildChunk(doc, cx, cz));
        budget--;
      }

      // Only unload well outside the target so a chunk edited at the edge of
      // the view is not torn down while the player is editing it.
      for (const ck of loadedKeys(doc)) {
        if (!target.has(ck)) dropLoaded(doc, ck);
      }
    },
    /** Rebuild everything after a world load / import. */
    reset(doc: WorldDocument, focus: { x: number; z: number }) {
      lastCenter = "";
      retarget(doc, focus);
    },
    stats(doc: WorldDocument): StreamStats {
      return { loaded: loadedKeys(doc).length, pending: pending.length };
    },
    dispose() {
      pending = [];
      target.clear();
      lastCenter = "";
    },
  };
}
