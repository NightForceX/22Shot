import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
  putDocument,
  getCapture,
  putCapture,
} from "../storage/indexeddb";
import { setSettings } from "../storage/settings";
import type { DocumentRecord } from "../shared/types";

export async function ensureActiveDocument(
  title = "Untitled Document"
): Promise<DocumentRecord> {
  const docs = await listDocuments();
  if (docs[0]) {
    await setSettings({ activeDocumentId: docs[0].id });
    return docs[0];
  }
  const doc = await createDocument(title);
  await setSettings({ activeDocumentId: doc.id });
  return doc;
}

export async function duplicateDocument(
  documentId: string
): Promise<DocumentRecord> {
  const src = await getDocument(documentId);
  if (!src) throw new Error("Document not found");
  const copy = await createDocument(`${src.title} Copy`);
  copy.pageOrder = [...src.pageOrder];
  copy.pageSize = src.pageSize;
  copy.orientation = src.orientation;
  copy.margins = src.margins;
  copy.customMarginIn = src.customMarginIn;
  copy.imageFit = src.imageFit;
  copy.imageAlign = src.imageAlign;
  copy.modifiedAt = Date.now();
  await putDocument(copy);
  return copy;
}

export async function moveCaptureToDocument(
  captureId: string,
  fromDocId: string,
  toDocId: string
): Promise<void> {
  const from = await getDocument(fromDocId);
  const to = await getDocument(toDocId);
  const capture = await getCapture(captureId);
  if (!from || !to || !capture) throw new Error("Move failed");
  from.pageOrder = from.pageOrder.filter((id) => id !== captureId);
  if (!to.pageOrder.includes(captureId)) to.pageOrder.push(captureId);
  capture.documentId = toDocId;
  from.modifiedAt = Date.now();
  to.modifiedAt = Date.now();
  await putCapture(capture);
  await putDocument(from);
  await putDocument(to);
}

export { deleteDocument, listDocuments, getDocument, putDocument };
