import type { Workspace, Vec3 } from "../../../shared/document";
import { chunkKeyAt } from "../../../shared/document";
import { hasLoaded } from "../../world/lib/chunks";
import { describeRegion } from "../lib/region";
export function pickCorner(s: Workspace, p: Vec3) {
  if (!s.anchor) {
    s.anchor = { ...p };
    s.region = { a: { ...p }, b: { ...p } };
    s.message = "已设置起点，请选择区域终点";
  } else {
    s.region = { a: { ...s.anchor }, b: { ...p } };
    s.anchor = null;
    const { volume, oversized } = describeRegion(s.region);
    s.message = oversized
      ? `区域已选择：${volume.toLocaleString()} 格，超出单次编辑上限`
      : "区域已选择，可填充或拆除";
  }
}

/** True when either corner of the selection is not resident yet. */
export function regionTouchesUnloaded(s: Workspace) {
  if (!s.region) return false;
  return (
    !hasLoaded(s.doc, chunkKeyAt(s.region.a)) ||
    !hasLoaded(s.doc, chunkKeyAt(s.region.b))
  );
}

export function clearRegion(s: Workspace) {
  s.anchor = null;
  s.region = null;
  s.message = "已取消区域选择";
}
