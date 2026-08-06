import { SEGMENT_OVERLAP_PX } from "../shared/constants";
import { debugLogSync } from "../shared/debug";
import {
  canAllocateBitmap,
  dataUrlToImageBitmap,
} from "./image-utils";

export interface StitchSegment {
  /** Preferred — avoids base64 encode/decode between crop and stitch. */
  blob?: Blob;
  dataUrl?: string;
  /** Device-pixel Y offset in the final image */
  destY: number;
  /** Device-pixel X offset in the final image */
  destX: number;
  /** Optional crop from source bitmap in device pixels */
  srcX?: number;
  srcY?: number;
  srcW?: number;
  srcH?: number;
}

async function segmentBitmap(seg: StitchSegment): Promise<ImageBitmap> {
  if (seg.blob) return createImageBitmap(seg.blob);
  if (seg.dataUrl) return dataUrlToImageBitmap(seg.dataUrl);
  throw new Error("Stitch segment missing blob/dataUrl");
}

export async function stitchVertical(
  segments: StitchSegment[],
  totalWidth: number,
  totalHeight: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const check = canAllocateBitmap(totalWidth, totalHeight);
  if (!check.ok) {
    throw new Error(
      `${check.reason}. Options: export as multi-page PDF, split into multiple PNG files, or reduce resolution.`
    );
  }
  debugLogSync("Stitch started", {
    segments: segments.length,
    totalWidth,
    totalHeight,
    bytes: check.bytes,
  });

  const canvas = new OffscreenCanvas(totalWidth, totalHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas allocation failed");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, totalWidth, totalHeight);

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const bitmap = await segmentBitmap(seg);
    const sx = seg.srcX ?? 0;
    const sy = seg.srcY ?? 0;
    const sw = seg.srcW ?? bitmap.width - sx;
    const sh = seg.srcH ?? bitmap.height - sy;
    ctx.drawImage(
      bitmap,
      sx,
      sy,
      sw,
      sh,
      seg.destX,
      seg.destY,
      sw,
      sh
    );
    bitmap.close();
    debugLogSync(`Stitch segment ${i + 1}/${segments.length}`);
  }

  const blob = await canvas.convertToBlob({ type: "image/png" });
  debugLogSync("Stitch completed", {
    width: totalWidth,
    height: totalHeight,
  });
  return { blob, width: totalWidth, height: totalHeight };
}

export function computeScrollStops(
  pageSize: number,
  viewportSize: number,
  overlapCss = SEGMENT_OVERLAP_PX
): number[] {
  if (pageSize <= viewportSize) return [0];
  const step = Math.max(1, viewportSize - overlapCss);
  const stops: number[] = [];
  let pos = 0;
  while (pos + viewportSize < pageSize) {
    stops.push(pos);
    pos += step;
  }
  stops.push(Math.max(0, pageSize - viewportSize));
  // Deduplicate near-identical stops
  return stops.filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 1);
}

export async function stitchGrid(
  tiles: Array<{
    blob?: Blob;
    dataUrl?: string;
    col: number;
    row: number;
    srcX?: number;
    srcY?: number;
    srcW?: number;
    srcH?: number;
  }>,
  tileWidth: number,
  tileHeight: number,
  cols: number,
  rows: number,
  totalWidth: number,
  totalHeight: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const segments: StitchSegment[] = tiles.map((t) => ({
    blob: t.blob,
    dataUrl: t.dataUrl,
    destX: t.col * tileWidth,
    destY: t.row * tileHeight,
    srcX: t.srcX,
    srcY: t.srcY,
    srcW: t.srcW ?? tileWidth,
    srcH: t.srcH ?? tileHeight,
  }));
  // Adjust last column/row destinations for remainder
  for (const seg of segments) {
    if (seg.destX + (seg.srcW ?? 0) > totalWidth) {
      seg.srcW = totalWidth - seg.destX;
    }
    if (seg.destY + (seg.srcH ?? 0) > totalHeight) {
      seg.srcH = totalHeight - seg.destY;
    }
  }
  void cols;
  void rows;
  return stitchVertical(segments, totalWidth, totalHeight);
}
