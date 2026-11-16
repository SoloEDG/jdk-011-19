import { reactive } from "vue";
import type { Workspace, Tool, MaterialId } from "../shared/document";
import type { SceneHit } from "../shared/commands";
import { createWorld } from "../features/world/lib/terrain";
import { editCells, editRegion } from "../features/world/model/edit";
import { pickCorner, clearRegion } from "../features/selection/model/selection";
import { chooseMaterial, selectSlot } from "../features/inventory/model/catalog";
export function createWorkspace() {
  return reactive<Workspace>({
    doc: createWorld(),
    material: "grass",
    tool: "place",
    region: null,
    anchor: null,
    message: "欢迎来到方屿，开始建造你的世界",
    dirty: false,
    mode: "build",
    savedAt: null,
    loadedChunks: 0,
  });
}
export function commandRouter(s: Workspace) {
  return {
    tool(t: Tool) {
      s.tool = t;
      s.mode = "build";
    },
    material(id: MaterialId) {
      chooseMaterial(s, id);
    },
    hit(h: SceneHit) {
      if (s.tool === "select") pickCorner(s, h.cell);
      else
        s.message = editCells(
          s,
          [s.tool === "place" ? h.adjacent : h.cell],
          s.tool === "remove",
        ).message;
    },
    /**
     * Batch edits validate the entire region before writing anything, using
     * the sparse world data rather than resident meshes, so a selection that
     * crosses unloaded chunks behaves exactly like one that does not.
     */
    region(remove = false) {
      if (!s.region) {
        s.message = "请先选择区域";
        return;
      }
      s.message = editRegion(s, remove).message;
    },
    clear() {
      clearRegion(s);
    },
    toggle() {
      s.mode = s.mode === "build" ? "walk" : "build";
    },
    key(e: KeyboardEvent) {
      if (
        (e.target as HTMLElement).matches("input,textarea") ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (/^[1-8]$/.test(e.key)) selectSlot(s, Number(e.key) - 1);
      if (e.code === "KeyB") s.tool = "place";
      if (e.code === "KeyE") s.tool = "remove";
      if (e.code === "KeyR") s.tool = "select";
      if (e.code === "Escape") clearRegion(s);
      if (e.code === "Tab") {
        e.preventDefault();
        s.mode = s.mode === "build" ? "walk" : "build";
      }
    },
  };
}
