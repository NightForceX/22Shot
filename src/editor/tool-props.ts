import type { ArrowHeads, RedactStyle } from "./draw-shapes";
import type { Tool } from "./tool-types";

export interface ToolPropValues {
  blurStrength: number;
  lineHeight: number;
  lineWidthMode: "drag" | "full";
  linePadding: number;
  lineBlurGuideColor: string;
  redactColor: string;
  redactOpacity: number;
  redactStyle: RedactStyle;
  redactRadius: number;
  strokeColor: string;
  fillColor: string;
  fillEnabled: boolean;
  strokeWidth: number;
  lineStrokeColor: string;
  lineStrokeWidth: number;
  arrowColor: string;
  arrowWidth: number;
  arrowHeads: ArrowHeads;
  arrowHeadSize: number;
  arrowFilled: boolean;
  highlightColor: string;
  highlightOpacity: number;
  textColor: string;
  textSize: number;
  textFont: string;
  drawColor: string;
  drawWidth: number;
  eraserMode: "annotations" | "last";
}

function num(id: string, fallback: number): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const n = Number(el?.value);
  return Number.isFinite(n) ? n : fallback;
}

function str(id: string, fallback: string): string {
  const el = document.getElementById(id) as
    | HTMLInputElement
    | HTMLSelectElement
    | null;
  return el?.value || fallback;
}

function checked(id: string): boolean {
  return (document.getElementById(id) as HTMLInputElement | null)?.checked === true;
}

export function readToolProps(): ToolPropValues {
  // arrow-head-size slider is 5–30 representing 0.5×–3.0×
  const headSlider = num("arrow-head-size", 10);
  return {
    blurStrength: num("blur-strength", 22),
    lineHeight: num("line-height", 28),
    lineWidthMode: str("line-width-mode", "drag") as "drag" | "full",
    linePadding: num("line-padding", 8),
    lineBlurGuideColor: str("lineblur-guide-color", "#ffe000"),
    redactColor: str("redact-color", "#000000"),
    redactOpacity: num("redact-opacity", 100) / 100,
    redactStyle: str("redact-style", "solid") as RedactStyle,
    redactRadius: num("redact-radius", 0),
    strokeColor: str("stroke-color", "#0a84ff"),
    fillColor: str("fill-color", "#0a84ff"),
    fillEnabled: checked("fill-enabled"),
    strokeWidth: num("stroke-width", 3),
    lineStrokeColor: str("line-stroke-color", "#c50042"),
    lineStrokeWidth: num("line-stroke-width", 3),
    arrowColor: str("arrow-color", "#c50042"),
    arrowWidth: num("arrow-width", 3),
    arrowHeads: str("arrow-heads", "end") as ArrowHeads,
    arrowHeadSize: Math.max(0.4, headSlider / 10),
    arrowFilled: checked("arrow-filled"),
    highlightColor: str("highlight-color", "#ffe900"),
    highlightOpacity: num("highlight-opacity", 35) / 100,
    textColor: str("text-color", "#c50042"),
    textSize: num("text-size", 22),
    textFont: str("text-font", "Segoe UI, sans-serif"),
    drawColor: str("draw-color", "#c50042"),
    drawWidth: num("draw-width", 3),
    eraserMode: str("eraser-mode", "annotations") as "annotations" | "last",
  };
}

export function syncAllRangeOutputs(): void {
  const pairs: Array<[string, string, string]> = [
    ["line-height", "line-height-val", "px"],
    ["blur-strength", "blur-strength-val", ""],
    ["line-padding", "line-padding-val", "px"],
    ["stroke-width", "stroke-width-val", "px"],
    ["line-stroke-width", "line-stroke-width-val", "px"],
    ["arrow-width", "arrow-width-val", "px"],
    ["highlight-opacity", "highlight-opacity-val", "%"],
    ["text-size", "text-size-val", "px"],
    ["draw-width", "draw-width-val", "px"],
    ["redact-opacity", "redact-opacity-val", "%"],
    ["redact-radius", "redact-radius-val", "px"],
  ];
  for (const [inputId, outId, suffix] of pairs) {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const out = document.getElementById(outId);
    if (!input || !out) continue;
    out.textContent = `${input.value}${suffix}`;
  }

  const headInput = document.getElementById(
    "arrow-head-size"
  ) as HTMLInputElement | null;
  const headOut = document.getElementById("arrow-head-size-val");
  if (headInput && headOut) {
    const mult = (Number(headInput.value) || 10) / 10;
    headOut.textContent = `${mult.toFixed(1)}×`;
  }
}

const TOOL_HINTS: Record<Tool, string> = {
  select: "Select a page from the left, or switch tools to annotate.",
  blur: "Drag over sensitive areas. Adjust strength on the right.",
  lineblur: "Hover the guide band on a text line, then click or drag.",
  redact: "Drag a redaction box. Set style, color, opacity, and corners.",
  rect: "Drag to draw a rectangle. Set stroke, width, and optional fill.",
  arrow: "Drag from start to tip. Choose heads, size, and filled style.",
  line: "Click and drag to draw a straight line.",
  text: "Click where the text should start, then type in the prompt.",
  highlighter: "Drag a translucent highlight. Set color and opacity.",
  freehand: "Draw freely with the pen. Set color and thickness.",
  eraser: "Drag over annotations to remove them, or undo the last mark.",
};

export function hintForTool(tool: Tool): string {
  return TOOL_HINTS[tool];
}

/** Which property panels to show for the active tool. */
export function panelsForTool(tool: Tool): string[] {
  switch (tool) {
    case "blur":
      return ["panel-blur"];
    case "lineblur":
      return ["panel-blur", "panel-lineblur"];
    case "redact":
      return ["panel-redact"];
    case "rect":
      return ["panel-shape"];
    case "line":
      return ["panel-stroke"];
    case "arrow":
      return ["panel-arrow"];
    case "text":
      return ["panel-text"];
    case "highlighter":
      return ["panel-highlight"];
    case "freehand":
      return ["panel-draw"];
    case "eraser":
      return ["panel-eraser"];
    case "select":
    default:
      return ["panel-select"];
  }
}

export function applyToolPanelVisibility(tool: Tool): void {
  const active = new Set(panelsForTool(tool));
  document.querySelectorAll<HTMLElement>("[data-tool-panel]").forEach((el) => {
    const id = el.dataset.toolPanel || "";
    el.hidden = !active.has(id);
  });
  const title = document.getElementById("tool-props-title");
  if (title) {
    title.textContent =
      tool === "lineblur"
        ? "Line Blur"
        : tool === "freehand"
          ? "Draw"
          : tool === "highlighter"
            ? "Highlight"
            : tool.charAt(0).toUpperCase() + tool.slice(1);
  }
  const hint = document.getElementById("tool-hint");
  if (hint) hint.textContent = hintForTool(tool);
}

export function bindSwatches(): void {
  document.querySelectorAll<HTMLElement>(".swatches").forEach((group) => {
    const targetId = group.dataset.target;
    if (!targetId) return;
    const input = document.getElementById(targetId) as HTMLInputElement | null;
    if (!input) return;
    group.querySelectorAll<HTMLButtonElement>("[data-color]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const color = btn.dataset.color;
        if (!color) return;
        input.value = color;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
  });
}
