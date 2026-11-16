import type { Workspace, WorldDocument } from "../../../shared/document";
import { writeWorld, readWorld, downloadWorld } from "../lib/storage";
import { decode, migrateV1 } from "../lib/codec";
import type { LegacyWorldDocument } from "../../../shared/document";

/**
 * Swap in a new document. The renderer notices `s.doc` changed, drops every
 * chunk mesh and re-streams around the player; no full-map load is needed.
 */
function install(s: Workspace, doc: WorldDocument) {
  const revision = s.doc.revision + 1;
  s.doc = doc;
  s.doc.revision = revision;
  s.dirty = false;
  s.mode = "build";
  s.savedAt = null;
  s.region = null;
  s.anchor = null;
  s.loadedChunks = 0;
  s.message = doc.legacy ? "世界已载入（旧地图已迁移）" : "世界已载入";
}

/**
 * Saving writes only sparse edits, never the loaded terrain, so it is
 * independent of which chunks happen to be resident. Taking the snapshot at
 * the current revision means an edit committed mid-save is still marked dirty
 * and will be saved next time rather than silently lost.
 */
export function save(s: Workspace) {
  try {
    s.savedAt = writeWorld(s.doc);
    s.dirty = false;
    s.message = "世界已保存到此浏览器";
  } catch {
    s.message = "保存失败，请导出备份";
  }
}
export function load(s: Workspace) {
  try {
    install(s, readWorld());
  } catch (e) {
    s.message = (e as Error).message;
  }
}
export function exportWorld(s: Workspace) {
  downloadWorld(s.doc);
  s.message = "世界文件已导出";
}
export async function importWorld(s: Workspace, file: File) {
  try {
    install(s, decode(await file.text()));
  } catch (e) {
    s.message = (e as Error).message;
  }
}

/** Exposed for tooling: migrate a legacy document in memory. */
export const migrateDocument = (old: LegacyWorldDocument) => migrateV1(old);
