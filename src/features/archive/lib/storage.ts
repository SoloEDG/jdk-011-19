import type { WorldDocument } from "../../../shared/document";
import { encode, decode } from "./codec";
const SLOT = "blockhaven-world-v1";
const BACKUP = "blockhaven-world-v1-backup";
export function writeWorld(doc: WorldDocument) {
  const raw = encode(doc);
  // Keep the previous save as a backup: a failed write must not destroy it.
  try {
    const previous = localStorage.getItem(SLOT);
    if (previous) localStorage.setItem(BACKUP, previous);
  } catch {
    /* backup is best-effort */
  }
  localStorage.setItem(SLOT, raw);
  return new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
export function readWorld() {
  const raw = localStorage.getItem(SLOT) ?? localStorage.getItem(BACKUP);
  if (!raw) throw Error("还没有本地存档");
  return decode(raw);
}
export function downloadWorld(doc: WorldDocument) {
  const url = URL.createObjectURL(
    new Blob([encode(doc)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.name}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
