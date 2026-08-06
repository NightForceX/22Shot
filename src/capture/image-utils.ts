import {
  MAX_SAFE_CANVAS_PIXELS,
  MAX_SAFE_DIMENSION,
} from "../shared/constants";

/** Sync decode — prefer {@link dataUrlToBlobAsync} on hot paths. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  if (!header || data === undefined) {
    throw new Error("Invalid data URL");
  }
  const mimeMatch = /data:([^;]+)/.exec(header);
  const mime = mimeMatch?.[1] || "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

/** Faster than atob loop — uses the browser's native data-URL fetch. */
export async function dataUrlToBlobAsync(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error("Failed to decode data URL");
  return res.blob();
}

/** Read PNG IHDR without decoding pixels (falls back to ImageBitmap). */
export async function blobDimensions(
  blob: Blob
): Promise<{ width: number; height: number }> {
  if (blob.type === "image/png" || blob.type === "" || blob.type === "application/octet-stream") {
    const header = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
    if (
      header.length >= 24 &&
      header[0] === 0x89 &&
      header[1] === 0x50 &&
      header[2] === 0x4e &&
      header[3] === 0x47
    ) {
      const width =
        (header[16] << 24) | (header[17] << 16) | (header[18] << 8) | header[19];
      const height =
        (header[20] << 24) | (header[21] << 16) | (header[22] << 8) | header[23];
      if (width > 0 && height > 0) return { width, height };
    }
  }
  const bitmap = await createImageBitmap(blob);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

export async function dataUrlToImageBitmap(dataUrl: string): Promise<ImageBitmap> {
  const blob = await dataUrlToBlobAsync(dataUrl);
  return createImageBitmap(blob);
}

/** Downscaled object URL for sidebar thumbs (caller must revoke). */
export async function createThumbnailObjectUrl(
  source: Blob,
  maxEdge = 240
): Promise<string> {
  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const thumb = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.72 });
    return URL.createObjectURL(thumb);
  } finally {
    bitmap.close();
  }
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export function estimateRgbaBytes(width: number, height: number): number {
  return width * height * 4;
}

export function canAllocateBitmap(width: number, height: number): {
  ok: boolean;
  reason?: string;
  bytes: number;
} {
  const bytes = estimateRgbaBytes(width, height);
  if (width <= 0 || height <= 0) {
    return { ok: false, reason: "Invalid dimensions", bytes };
  }
  if (width > MAX_SAFE_DIMENSION || height > MAX_SAFE_DIMENSION) {
    return {
      ok: false,
      reason: `Dimension exceeds ${MAX_SAFE_DIMENSION}px limit`,
      bytes,
    };
  }
  if (width * height > MAX_SAFE_CANVAS_PIXELS) {
    return {
      ok: false,
      reason: "Page is too large for a single bitmap",
      bytes,
    };
  }
  return { ok: true, bytes };
}

export async function loadImage(dataUrlOrBlobUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrlOrBlobUrl;
  });
}

export async function cropBlob(
  source: Blob | string,
  rect: { x: number; y: number; width: number; height: number },
  dpr = 1
): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap =
    typeof source === "string"
      ? await dataUrlToImageBitmap(source)
      : await createImageBitmap(source);
  try {
    const sx = Math.max(0, Math.round(rect.x * dpr));
    const sy = Math.max(0, Math.round(rect.y * dpr));
    const sw = Math.max(1, Math.round(rect.width * dpr));
    const sh = Math.max(1, Math.round(rect.height * dpr));
    const width = Math.min(sw, bitmap.width - sx);
    const height = Math.min(sh, bitmap.height - sy);
    if (width <= 0 || height <= 0) {
      throw new Error("Crop rectangle is outside the captured image");
    }
    const check = canAllocateBitmap(width, height);
    if (!check.ok) throw new Error(check.reason);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, sx, sy, width, height, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}

export async function cropDataUrl(
  dataUrl: string,
  rect: { x: number; y: number; width: number; height: number },
  dpr = 1
): Promise<{ dataUrl: string; width: number; height: number; blob: Blob }> {
  const cropped = await cropBlob(dataUrl, rect, dpr);
  return {
    ...cropped,
    dataUrl: await blobToDataUrl(cropped.blob),
  };
}

export async function encodeBlob(
  source: ImageBitmap | HTMLImageElement | OffscreenCanvas,
  format: "png" | "jpeg" | "webp",
  quality: number
): Promise<Blob> {
  let width: number;
  let height: number;
  if (source instanceof OffscreenCanvas) {
    width = source.width;
    height = source.height;
  } else {
    width = "naturalWidth" in source ? source.naturalWidth || source.width : source.width;
    height =
      "naturalHeight" in source ? source.naturalHeight || source.height : source.height;
  }

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  if (format === "jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(source as CanvasImageSource, 0, 0);

  const type =
    format === "png" ? "image/png" : format === "jpeg" ? "image/jpeg" : "image/webp";
  const q = format === "png" ? undefined : Math.min(1, Math.max(0.01, quality / 100));
  return canvas.convertToBlob({ type, quality: q });
}

export async function scaleBitmap(
  bitmap: ImageBitmap,
  scale: number
): Promise<ImageBitmap> {
  if (scale === 1) return bitmap;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const check = canAllocateBitmap(width, height);
  if (!check.ok) throw new Error(check.reason);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas.transferToImageBitmap();
}

export function revokeLater(url: string): void {
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
