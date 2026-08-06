import { PDFDocument } from "pdf-lib";
import { getCapture, getDocument, getEdits } from "../storage/indexeddb";
import { getSettings } from "../storage/settings";
import { rasterizeEdits } from "../editor/rasterize";
import {
  fitImageRect,
  resolvePageBox,
  splitLongImagePages,
} from "./page-layout";
import { placeCaptureLinksOnPage } from "./pdf-links";

export async function exportDocumentPdf(documentId: string): Promise<Uint8Array> {
  const doc = await getDocument(documentId);
  if (!doc) throw new Error("Document not found");
  if (!doc.pageOrder.length) throw new Error("Document has no pages");
  const settings = await getSettings();
  const preserveLinks = settings.preservePdfLinks !== false;

  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setProducer("22Shot");
  pdf.setCreator("22Shot");

  for (const captureId of doc.pageOrder) {
    const capture = await getCapture(captureId);
    if (!capture) continue;
    const ops = await getEdits(captureId);
    const rendered =
      ops.length > 0 ? await rasterizeEdits(capture.blob, ops) : capture.blob;
    const bytes = new Uint8Array(await rendered.arrayBuffer());
    const mime = rendered.type || capture.mimeType;
    const embedded =
      mime.includes("jpeg") || mime.includes("jpg")
        ? await pdf.embedJpg(bytes)
        : await pdf.embedPng(bytes);

    const imgW = embedded.width;
    const imgH = embedded.height;
    const pageBox = resolvePageBox(doc, imgW, imgH);
    const fitted = fitImageRect(doc, pageBox, imgW, imgH);
    const links = preserveLinks ? capture.links : undefined;

    if (fitted.heightPt <= pageBox.contentHeightPt + 0.5) {
      const page = pdf.addPage([pageBox.widthPt, pageBox.heightPt]);
      const drawY = pageBox.heightPt - fitted.y - fitted.heightPt;
      page.drawImage(embedded, {
        x: fitted.x,
        y: drawY,
        width: fitted.widthPt,
        height: fitted.heightPt,
      });
      placeCaptureLinksOnPage({
        pdf,
        page,
        links,
        imageWidthPx: imgW,
        imageHeightPx: imgH,
        drawX: fitted.x,
        drawY,
        drawW: fitted.widthPt,
        drawH: fitted.heightPt,
      });
      continue;
    }

    const pageOffsets = splitLongImagePages(
      fitted.heightPt,
      pageBox.contentHeightPt
    );
    const scale = fitted.scale;
    const pxToPt = (72 / 96) * scale;

    for (let i = 0; i < pageOffsets.length; i++) {
      const offsetPt = pageOffsets[i];
      const sliceHeightPt = Math.min(
        pageBox.contentHeightPt,
        fitted.heightPt - offsetPt
      );
      const srcY = offsetPt / pxToPt;
      const srcH = sliceHeightPt / pxToPt;
      const page = pdf.addPage([pageBox.widthPt, pageBox.heightPt]);

      const cropped = await cropPngBytes(bytes, mime, 0, srcY, imgW, srcH);
      const sliceEmbedded = cropped.jpeg
        ? await pdf.embedJpg(cropped.bytes)
        : await pdf.embedPng(cropped.bytes);

      const drawW = fitted.widthPt;
      const drawH = sliceHeightPt;
      const x = pageBox.marginPt + (pageBox.contentWidthPt - drawW) / 2;
      const y = pageBox.heightPt - pageBox.marginPt - drawH;
      page.drawImage(sliceEmbedded, { x, y, width: drawW, height: drawH });
      placeCaptureLinksOnPage({
        pdf,
        page,
        links,
        imageWidthPx: imgW,
        imageHeightPx: imgH,
        srcY,
        srcH,
        drawX: x,
        drawY: y,
        drawW,
        drawH,
      });
    }
  }

  return pdf.save({ useObjectStreams: true });
}

async function cropPngBytes(
  bytes: Uint8Array,
  mime: string,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): Promise<{ bytes: Uint8Array; jpeg: boolean }> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime || "image/png" });
  const bitmap = await createImageBitmap(blob);
  const y = Math.max(0, Math.floor(sy));
  const h = Math.max(1, Math.min(bitmap.height - y, Math.ceil(sh)));
  const x = Math.max(0, Math.floor(sx));
  const w = Math.max(1, Math.min(bitmap.width - x, Math.ceil(sw)));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);
  bitmap.close();
  const out = await canvas.convertToBlob({ type: "image/png" });
  return { bytes: new Uint8Array(await out.arrayBuffer()), jpeg: false };
}
