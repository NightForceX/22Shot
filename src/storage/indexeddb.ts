import type { CaptureMeta, DocumentRecord, EditOp } from "../shared/types";

const DB_NAME = "22shot";
const DB_VERSION = 1;

export interface CaptureRecord extends CaptureMeta {
  blob: Blob;
}

export interface EditRecord {
  id: string;
  captureId: string;
  operations: EditOp[];
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("captures")) {
        const store = db.createObjectStore("captures", { keyPath: "id" });
        store.createIndex("documentId", "documentId", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("documents")) {
        const store = db.createObjectStore("documents", { keyPath: "id" });
        store.createIndex("modifiedAt", "modifiedAt", { unique: false });
      }
      if (!db.objectStoreNames.contains("edits")) {
        const store = db.createObjectStore("edits", { keyPath: "id" });
        store.createIndex("captureId", "captureId", { unique: true });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error("IndexedDB open failed"));
    };
  });
  return dbPromise;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}

export function createId(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function putCapture(record: CaptureRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("captures", "readwrite");
  tx.objectStore("captures").put(record);
  await txDone(tx);
}

export async function getCapture(id: string): Promise<CaptureRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction("captures", "readonly");
  const result = await reqToPromise(
    tx.objectStore("captures").get(id) as IDBRequest<CaptureRecord | undefined>
  );
  await txDone(tx);
  return result;
}

export async function getCapturesByIds(
  ids: string[]
): Promise<Map<string, CaptureRecord>> {
  const map = new Map<string, CaptureRecord>();
  if (!ids.length) return map;
  const db = await openDb();
  const tx = db.transaction("captures", "readonly");
  const store = tx.objectStore("captures");
  await Promise.all(
    ids.map(async (id) => {
      const row = await reqToPromise(
        store.get(id) as IDBRequest<CaptureRecord | undefined>
      );
      if (row) map.set(id, row);
    })
  );
  await txDone(tx);
  return map;
}

export async function deleteCapture(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["captures", "edits"], "readwrite");
  tx.objectStore("captures").delete(id);
  const editIndex = tx.objectStore("edits").index("captureId");
  const existing = await reqToPromise(
    editIndex.get(id) as IDBRequest<EditRecord | undefined>
  );
  if (existing) tx.objectStore("edits").delete(existing.id);
  await txDone(tx);
}

export async function listCapturesByDocument(
  documentId: string
): Promise<CaptureRecord[]> {
  const db = await openDb();
  const tx = db.transaction("captures", "readonly");
  const index = tx.objectStore("captures").index("documentId");
  const result = await reqToPromise(
    index.getAll(documentId) as IDBRequest<CaptureRecord[]>
  );
  await txDone(tx);
  return result;
}

export async function putDocument(doc: DocumentRecord): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("documents", "readwrite");
  tx.objectStore("documents").put(doc);
  await txDone(tx);
}

export async function getDocument(
  id: string
): Promise<DocumentRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction("documents", "readonly");
  const result = await reqToPromise(
    tx.objectStore("documents").get(id) as IDBRequest<DocumentRecord | undefined>
  );
  await txDone(tx);
  return result;
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  const db = await openDb();
  const tx = db.transaction("documents", "readonly");
  const result = await reqToPromise(
    tx.objectStore("documents").getAll() as IDBRequest<DocumentRecord[]>
  );
  await txDone(tx);
  return result.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

export async function deleteDocument(id: string): Promise<void> {
  const captures = await listCapturesByDocument(id);
  const db = await openDb();
  const tx = db.transaction(["documents", "captures", "edits"], "readwrite");
  tx.objectStore("documents").delete(id);
  for (const c of captures) {
    tx.objectStore("captures").delete(c.id);
  }
  await txDone(tx);
}

export async function getEdits(captureId: string): Promise<EditOp[]> {
  const db = await openDb();
  const tx = db.transaction("edits", "readonly");
  const index = tx.objectStore("edits").index("captureId");
  const result = await reqToPromise(
    index.get(captureId) as IDBRequest<EditRecord | undefined>
  );
  await txDone(tx);
  return result?.operations ?? [];
}

export async function saveEdits(
  captureId: string,
  operations: EditOp[]
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("edits", "readwrite");
  const index = tx.objectStore("edits").index("captureId");
  const existing = await reqToPromise(
    index.get(captureId) as IDBRequest<EditRecord | undefined>
  );
  const record: EditRecord = {
    id: existing?.id || createId("edit"),
    captureId,
    operations,
    updatedAt: Date.now(),
  };
  tx.objectStore("edits").put(record);
  await txDone(tx);
}

export async function createDocument(title: string): Promise<DocumentRecord> {
  const now = Date.now();
  const doc: DocumentRecord = {
    id: createId("doc"),
    title,
    pageOrder: [],
    createdAt: now,
    modifiedAt: now,
    pageSize: "letter",
    orientation: "portrait",
    margins: "medium",
    imageFit: "fit-width",
    imageAlign: "top",
  };
  await putDocument(doc);
  return doc;
}
