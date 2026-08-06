import type { EditOp } from "../shared/types";
import { blobToDataUrl } from "../capture/image-utils";
import { drawArrow, drawRedact } from "./draw-shapes";

export { blobToDataUrl };

export async function rasterizeEdits(
  sourceBlob: Blob,
  operations: EditOp[]
): Promise<Blob> {
  const bitmap = await createImageBitmap(sourceBlob);
  let width = bitmap.width;
  let height = bitmap.height;
  let canvas = new OffscreenCanvas(width, height);
  let ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  for (const op of operations) {
    if (op.type === "crop") {
      const sx = Math.max(0, Math.round(op.x));
      const sy = Math.max(0, Math.round(op.y));
      const sw = Math.max(1, Math.round(op.width));
      const sh = Math.max(1, Math.round(op.height));
      const next = new OffscreenCanvas(sw, sh);
      const nctx = next.getContext("2d")!;
      nctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
      canvas = next;
      ctx = nctx;
      width = sw;
      height = sh;
      continue;
    }

    if (op.type === "blur") {
      applyBlur(ctx, canvas, op);
    } else if (op.type === "pixelate") {
      applyPixelate(ctx, op);
    } else if (op.type === "redact") {
      drawRedact(ctx, {
        x: op.x,
        y: op.y,
        width: op.width,
        height: op.height,
        color: op.color || "#000000",
        opacity: op.opacity,
        style: op.style,
        cornerRadius: op.cornerRadius,
      });
    } else if (op.type === "rect") {
      ctx.save();
      ctx.lineJoin = "miter";
      ctx.strokeStyle = op.stroke;
      ctx.lineWidth = op.lineWidth;
      if (op.fill) {
        ctx.fillStyle = op.fill;
        ctx.fillRect(op.x, op.y, op.width, op.height);
      }
      ctx.strokeRect(op.x, op.y, op.width, op.height);
      ctx.restore();
    } else if (op.type === "arrow") {
      drawArrow(ctx, {
        x1: op.x1,
        y1: op.y1,
        x2: op.x2,
        y2: op.y2,
        stroke: op.stroke,
        lineWidth: op.lineWidth,
        heads: op.heads,
        headSize: op.headSize,
        filled: op.filled,
      });
    } else if (op.type === "line") {
      ctx.save();
      ctx.strokeStyle = op.stroke;
      ctx.lineWidth = op.lineWidth;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(op.x1, op.y1);
      ctx.lineTo(op.x2, op.y2);
      ctx.stroke();
      ctx.restore();
    } else if (op.type === "text") {
      ctx.save();
      ctx.fillStyle = op.color;
      ctx.font = `${op.fontSize}px ${op.fontFamily}`;
      ctx.textBaseline = "top";
      ctx.fillText(op.text, op.x, op.y);
      ctx.restore();
    } else if (op.type === "highlighter") {
      ctx.save();
      ctx.fillStyle = op.color;
      ctx.globalAlpha = Math.min(1, Math.max(0.05, op.opacity ?? 0.35));
      ctx.fillRect(op.x, op.y, op.width, op.height);
      ctx.restore();
    } else if (op.type === "freehand") {
      if (op.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = op.stroke;
      ctx.lineWidth = op.lineWidth;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(op.points[0].x, op.points[0].y);
      for (let i = 1; i < op.points.length; i++) {
        ctx.lineTo(op.points[i].x, op.points[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  return canvas.convertToBlob({ type: "image/png" });
}

function applyBlur(
  ctx: OffscreenCanvasRenderingContext2D,
  canvas: OffscreenCanvas,
  op: Extract<EditOp, { type: "blur" }>
): void {
  const x = Math.max(0, Math.round(op.x));
  const y = Math.max(0, Math.round(op.y));
  const w = Math.max(1, Math.min(canvas.width - x, Math.round(op.width)));
  const h = Math.max(1, Math.min(canvas.height - y, Math.round(op.height)));
  if (w <= 0 || h <= 0) return;

  // UI strength 4–40 → soft radius. Higher values fully obscure text.
  const strength = Math.max(1, Math.min(40, op.strength));
  const radius = Math.max(3, Math.round(3 + strength * 1.35));

  // Pad so blur samples outside the selection (avoids hard rectangle edges).
  const pad = Math.ceil(radius * 3);
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const pw = Math.min(canvas.width, x + w + pad) - sx;
  const ph = Math.min(canvas.height, y + h + pad) - sy;
  const ox = x - sx;
  const oy = y - sy;

  const padded = new OffscreenCanvas(pw, ph);
  const pctx = padded.getContext("2d", { willReadFrequently: true })!;
  pctx.drawImage(canvas, sx, sy, pw, ph, 0, 0, pw, ph);

  const blurred = new OffscreenCanvas(pw, ph);
  const bctx = blurred.getContext("2d", { willReadFrequently: true })!;

  let usedFilter = false;
  try {
    bctx.filter = `blur(${radius}px)`;
    bctx.drawImage(padded, 0, 0);
    bctx.filter = "none";
    if (strength >= 14) {
      const pass = new OffscreenCanvas(pw, ph);
      const p2 = pass.getContext("2d")!;
      p2.filter = `blur(${Math.max(2, Math.round(radius * 0.55))}px)`;
      p2.drawImage(blurred, 0, 0);
      bctx.clearRect(0, 0, pw, ph);
      bctx.drawImage(pass, 0, 0);
    }
    usedFilter = filterChangedPixels(pctx, bctx, pw, ph);
  } catch {
    usedFilter = false;
  }

  if (!usedFilter) {
    // 3-pass separable box blur ≈ Gaussian, smooth and readable as soft smudge
    const passes = strength >= 20 ? 4 : 3;
    boxBlurImage(pctx, bctx, pw, ph, Math.max(1, Math.round(radius * 0.65)), passes);
  }

  ctx.drawImage(blurred, ox, oy, w, h, x, y, w, h);
}

function filterChangedPixels(
  src: OffscreenCanvasRenderingContext2D,
  dst: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number
): boolean {
  const sw = Math.min(12, w);
  const sh = Math.min(12, h);
  const a = src.getImageData(0, 0, sw, sh).data;
  const b = dst.getImageData(0, 0, sw, sh).data;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    diff +=
      Math.abs(a[i] - b[i]) +
      Math.abs(a[i + 1] - b[i + 1]) +
      Math.abs(a[i + 2] - b[i + 2]);
  }
  return diff > sw * sh * 3;
}

function boxBlurImage(
  srcCtx: OffscreenCanvasRenderingContext2D,
  dstCtx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  radius: number,
  passes: number
): void {
  let image = srcCtx.getImageData(0, 0, w, h);
  const temp = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < passes; i++) {
    boxBlurAxis(image.data, temp, w, h, radius, true);
    boxBlurAxis(temp, image.data, w, h, radius, false);
  }
  dstCtx.putImageData(image, 0, 0);
}

function boxBlurAxis(
  src: Uint8ClampedArray,
  dst: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  horizontal: boolean
): void {
  const r = Math.max(1, radius | 0);
  const dim = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const extent = r * 2 + 1;

  for (let line = 0; line < lines; line++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let sa = 0;

    for (let k = -r; k <= r; k++) {
      const i = clampIndex(k, dim);
      const idx = horizontal ? (line * w + i) * 4 : (i * w + line) * 4;
      sr += src[idx];
      sg += src[idx + 1];
      sb += src[idx + 2];
      sa += src[idx + 3];
    }

    for (let pos = 0; pos < dim; pos++) {
      const out = horizontal ? (line * w + pos) * 4 : (pos * w + line) * 4;
      dst[out] = Math.round(sr / extent);
      dst[out + 1] = Math.round(sg / extent);
      dst[out + 2] = Math.round(sb / extent);
      dst[out + 3] = Math.round(sa / extent);

      const leave = clampIndex(pos - r, dim);
      const enter = clampIndex(pos + r + 1, dim);
      const leaveIdx = horizontal
        ? (line * w + leave) * 4
        : (leave * w + line) * 4;
      const enterIdx = horizontal
        ? (line * w + enter) * 4
        : (enter * w + line) * 4;
      sr += src[enterIdx] - src[leaveIdx];
      sg += src[enterIdx + 1] - src[leaveIdx + 1];
      sb += src[enterIdx + 2] - src[leaveIdx + 2];
      sa += src[enterIdx + 3] - src[leaveIdx + 3];
    }
  }
}

function clampIndex(i: number, max: number): number {
  if (i < 0) return 0;
  if (i >= max) return max - 1;
  return i;
}

function applyPixelate(
  ctx: OffscreenCanvasRenderingContext2D,
  op: Extract<EditOp, { type: "pixelate" }>
): void {
  const x = Math.max(0, Math.round(op.x));
  const y = Math.max(0, Math.round(op.y));
  const w = Math.max(1, Math.round(op.width));
  const h = Math.max(1, Math.round(op.height));
  const block = Math.max(2, Math.round(op.blockSize));
  const region = ctx.getImageData(x, y, w, h);
  const tmp = new OffscreenCanvas(w, h);
  const tctx = tmp.getContext("2d")!;
  tctx.putImageData(region, 0, 0);
  const sw = Math.max(1, Math.round(w / block));
  const sh = Math.max(1, Math.round(h / block));
  const small = new OffscreenCanvas(sw, sh);
  const sctx = small.getContext("2d")!;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(tmp, 0, 0, sw, sh);
  tctx.imageSmoothingEnabled = false;
  tctx.clearRect(0, 0, w, h);
  tctx.drawImage(small, 0, 0, w, h);
  ctx.drawImage(tmp, x, y);
}

export async function previewDataUrl(
  sourceBlob: Blob,
  operations: EditOp[]
): Promise<string> {
  const blob = await rasterizeEdits(sourceBlob, operations);
  return blobToDataUrl(blob);
}

/** Rasterize edits and return a blob (prefer over base64 for the editor). */
export async function previewBlob(
  sourceBlob: Blob,
  operations: EditOp[]
): Promise<Blob> {
  return rasterizeEdits(sourceBlob, operations);
}
