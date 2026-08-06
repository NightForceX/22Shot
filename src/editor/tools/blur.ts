import type { EditOp } from "../../shared/types";

export function createBlurOp(
  x: number,
  y: number,
  width: number,
  height: number,
  strength = 12
): EditOp {
  return { type: "blur", x, y, width, height, strength };
}

/** Horizontal band for line-by-line redaction blur. */
export function createLineBlurOp(options: {
  yCenter: number;
  x: number;
  width: number;
  lineHeight: number;
  imageHeight: number;
  strength?: number;
}): EditOp {
  const height = Math.max(10, Math.round(options.lineHeight));
  const y = Math.max(
    0,
    Math.min(
      options.imageHeight - height,
      Math.round(options.yCenter - height / 2)
    )
  );
  return {
    type: "blur",
    x: Math.max(0, Math.round(options.x)),
    y,
    width: Math.max(1, Math.round(options.width)),
    height,
    strength: options.strength ?? 16,
  };
}
