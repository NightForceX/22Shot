import type { EditOp } from "../../shared/types";
import type { ArrowHeads } from "../draw-shapes";

export function createArrowOp(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke = "#c50042",
  lineWidth = 3,
  opts?: {
    heads?: ArrowHeads;
    headSize?: number;
    filled?: boolean;
  }
): EditOp {
  return {
    type: "arrow",
    x1,
    y1,
    x2,
    y2,
    stroke,
    lineWidth,
    heads: opts?.heads ?? "end",
    headSize: opts?.headSize ?? 1,
    filled: opts?.filled !== false,
  };
}
