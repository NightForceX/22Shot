import { buildFilename } from "../shared/filename";
import type { CaptureLink, CaptureResult, CaptureType } from "../shared/types";
import { createId, putCapture, type CaptureRecord } from "../storage/indexeddb";
import { getSettings } from "../storage/settings";
import { blobToDataUrl } from "./image-utils";

export async function storeCapture(options: {
  blob: Blob;
  width: number;
  height: number;
  pageTitle: string;
  url: string;
  captureType: CaptureType;
  documentId?: string | null;
  preview?: boolean;
  links?: CaptureLink[];
}): Promise<CaptureResult> {
  const settings = await getSettings();
  const id = createId("cap");
  const filenameBase = buildFilename({
    template: settings.filenameTemplate,
    title: options.pageTitle,
    url: options.url,
    width: options.width,
    height: options.height,
    extension: "png",
  }).replace(/\.png$/i, "");

  const record: CaptureRecord = {
    id,
    documentId: options.documentId ?? settings.activeDocumentId,
    blob: options.blob,
    width: options.width,
    height: options.height,
    mimeType: options.blob.type || "image/png",
    pageTitle: options.pageTitle,
    url: options.url,
    createdAt: Date.now(),
    captureType: options.captureType,
    filenameBase,
    links: options.links,
  };
  await putCapture(record);

  const result: CaptureResult = {
    captureId: id,
    width: options.width,
    height: options.height,
    mimeType: record.mimeType,
    pageTitle: options.pageTitle,
    url: options.url,
    filenameBase,
  };
  // Opt-in only — full PNG→dataURL is expensive and unused when opening the editor.
  if (options.preview === true) {
    result.previewDataUrl = await blobToDataUrl(options.blob);
  }
  return result;
}
