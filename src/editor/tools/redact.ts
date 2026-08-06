import type { EditOp } from "../../shared/types";
import type { RedactStyle } from "../draw-shapes";

export function createRedactOp(
  x: number,
  y: number,
  width: number,
  height: number,
  color = "#000000",
  opts?: {
    opacity?: number;
    style?: RedactStyle;
    cornerRadius?: number;
  }
): EditOp {
  return {
    type: "redact",
    x,
    y,
    width,
    height,
    color,
    opacity: opts?.opacity ?? 1,
    style: opts?.style ?? "solid",
    cornerRadius: opts?.cornerRadius ?? 0,
  };
}
