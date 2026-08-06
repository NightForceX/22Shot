import type { EditOp } from "../../shared/types";

export function createTextOp(
  x: number,
  y: number,
  text: string,
  options?: Partial<Pick<Extract<EditOp, { type: "text" }>, "color" | "fontSize" | "fontFamily">>
): EditOp {
  return {
    type: "text",
    x,
    y,
    text,
    color: options?.color || "#c50042",
    fontSize: options?.fontSize || 18,
    fontFamily: options?.fontFamily || "Segoe UI, sans-serif",
  };
}
