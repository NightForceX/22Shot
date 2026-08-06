export type ArrowHeads = "end" | "start" | "both";

export interface ArrowDrawOpts {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  lineWidth: number;
  heads?: ArrowHeads;
  /** Relative head size multiplier (default 1). */
  headSize?: number;
  /** Filled triangle head vs outline (default true). */
  filled?: boolean;
}

type AnyCtx =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

function headLength(lineWidth: number, headSize: number): number {
  return Math.max(8, 8 + lineWidth * 2) * Math.max(0.4, headSize);
}

function drawHead(
  ctx: AnyCtx,
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  size: number,
  filled: boolean
): void {
  const angle = Math.atan2(tipY - fromY, tipX - fromX);
  const spread = Math.PI / 6;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(
    tipX - size * Math.cos(angle - spread),
    tipY - size * Math.sin(angle - spread)
  );
  ctx.lineTo(
    tipX - size * Math.cos(angle + spread),
    tipY - size * Math.sin(angle + spread)
  );
  ctx.closePath();
  if (filled) ctx.fill();
  else {
    ctx.lineJoin = "miter";
    ctx.stroke();
  }
}

/** Shorten a segment by `amount` from the tip end. */
function shortenToward(
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  amount: number
): { x: number; y: number } {
  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.max(0, 1 - amount / len);
  return { x: fromX + dx * t, y: fromY + dy * t };
}

export function drawArrow(ctx: AnyCtx, opts: ArrowDrawOpts): void {
  const heads = opts.heads ?? "end";
  const headSize = opts.headSize ?? 1;
  const filled = opts.filled !== false;
  const size = headLength(opts.lineWidth, headSize);
  const inset = filled ? size * 0.85 : size * 0.55;

  let sx = opts.x1;
  let sy = opts.y1;
  let ex = opts.x2;
  let ey = opts.y2;

  if (heads === "end" || heads === "both") {
    const p = shortenToward(ex, ey, sx, sy, inset);
    ex = p.x;
    ey = p.y;
  }
  if (heads === "start" || heads === "both") {
    const p = shortenToward(sx, sy, opts.x2, opts.y2, inset);
    sx = p.x;
    sy = p.y;
  }

  ctx.save();
  ctx.strokeStyle = opts.stroke;
  ctx.fillStyle = opts.stroke;
  ctx.lineWidth = opts.lineWidth;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.stroke();

  if (heads === "end" || heads === "both") {
    drawHead(ctx, opts.x2, opts.y2, opts.x1, opts.y1, size, filled);
  }
  if (heads === "start" || heads === "both") {
    drawHead(ctx, opts.x1, opts.y1, opts.x2, opts.y2, size, filled);
  }
  ctx.restore();
}

export type RedactStyle = "solid" | "hatch" | "outline";

export interface RedactDrawOpts {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity?: number;
  style?: RedactStyle;
  cornerRadius?: number;
}

function roundRectPath(
  ctx: AnyCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  if (radius <= 0) {
    ctx.rect(x, y, w, h);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function drawRedact(ctx: AnyCtx, opts: RedactDrawOpts): void {
  const style = opts.style ?? "solid";
  const opacity = Math.min(1, Math.max(0.05, opts.opacity ?? 1));
  const r = Math.max(0, opts.cornerRadius ?? 0);

  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.color;

  if (style === "outline") {
    ctx.lineWidth = Math.max(2, Math.min(opts.width, opts.height) * 0.08);
    roundRectPath(ctx, opts.x, opts.y, opts.width, opts.height, r);
    ctx.stroke();
  } else if (style === "hatch") {
    roundRectPath(ctx, opts.x, opts.y, opts.width, opts.height, r);
    ctx.save();
    ctx.clip();
    ctx.lineWidth = 2;
    const step = 8;
    const x0 = opts.x - opts.height;
    const x1 = opts.x + opts.width + opts.height;
    for (let x = x0; x < x1; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, opts.y);
      ctx.lineTo(x + opts.height, opts.y + opts.height);
      ctx.stroke();
    }
    ctx.restore();
    ctx.lineWidth = 2;
    roundRectPath(ctx, opts.x, opts.y, opts.width, opts.height, r);
    ctx.stroke();
  } else {
    roundRectPath(ctx, opts.x, opts.y, opts.width, opts.height, r);
    ctx.fill();
  }
  ctx.restore();
}
