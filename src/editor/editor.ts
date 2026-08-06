import { sendMessage } from "../shared/messages";
import type { DocumentRecord, EditOp, Settings } from "../shared/types";
import {
  buildFilename,
  buildNameBase,
  FILENAME_PRESETS,
  formatDateParts,
  parseUrlParts,
  presetMatchingTemplate,
  templateForPreset,
} from "../shared/filename";
import { createThumbnailObjectUrl } from "../capture/image-utils";
import { previewBlob } from "./rasterize";
import { suggestBreaks } from "../document/page-layout";
import type { Tool } from "./tool-types";
import { drawArrow, drawRedact } from "./draw-shapes";
import {
  applyToolPanelVisibility,
  bindSwatches,
  readToolProps,
  syncAllRangeOutputs,
  type ToolPropValues,
} from "./tool-props";
import {
  getCapture,
  getCapturesByIds,
  getEdits,
  saveEdits as idbSaveEdits,
} from "../storage/indexeddb";

interface GuideRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PageItem {
  id: string;
  title: string;
  previewDataUrl: string;
  width: number;
  height: number;
  url: string;
  createdAt: number;
  thumbReady?: boolean;
}

const params = new URLSearchParams(location.search);
let documentId = params.get("documentId");
let activeCaptureId: string | null = params.get("captureId");
let doc: DocumentRecord | null = null;
let pages: PageItem[] = [];
let sourceBlob: Blob | null = null;
let ops: EditOp[] = [];
let redoStack: EditOp[][] = [];
let undoStack: EditOp[][] = [];
let tool: Tool = "select";
let dragStart: { x: number; y: number } | null = null;
let freehandPoints: Array<{ x: number; y: number }> = [];
let freehandLast: { x: number; y: number } | null = null;
let dragStrokeProps: ToolPropValues | null = null;
let settings: Settings | null = null;
let pageBreaks: number[] = [];
let lineBlurAnchorY: number | null = null;
let cachedPreviewUrl: string | null = null;
/** Fast source for rubber-band / live draw restore. */
let previewBitmap: ImageBitmap | null = null;
/** Latest rasterized PNG for fast save/copy (includes edits). */
let cachedPreviewBlob: Blob | null = null;
let saveEditsTimer: number | null = null;
let blobRefreshTimer: number | null = null;
let freehandRaf = 0;
let pendingFreehandPoint: { x: number; y: number } | null = null;
const pageThumbUrls = new Set<string>();
const selectedCaptureIds = new Set<string>();
const NAV_WIDTH_KEY = "22shot.navWidth";
const NAV_WIDTH_MIN = 180;
const NAV_WIDTH_MAX = 560;
/** View-only zoom multiplier on top of the fit-to-viewport scale. Does not affect save/export. */
let viewZoom = 1;
const VIEW_ZOOM_MIN = 0.25;
const VIEW_ZOOM_MAX = 4;
const VIEW_FIT_MAX_CSS = 900;

const appEl = document.querySelector(".app") as HTMLElement;
const workspaceEl = document.querySelector(".workspace") as HTMLElement;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const zoomLabelBtn = document.getElementById("btn-zoom-label");
const ctx = canvas.getContext("2d", { alpha: false })!;
const pageList = document.getElementById("page-list")!;
const empty = document.getElementById("empty")!;
const dims = document.getElementById("dims")!;
const statusEl = document.getElementById("status")!;
const docTitle = document.getElementById("doc-title") as HTMLInputElement;
const breakLines = document.getElementById("break-lines")!;
const blurGuide = document.getElementById("blur-guide") as HTMLDivElement;
const lineHeightInput = document.getElementById("line-height") as HTMLInputElement;
const blurStrengthInput = document.getElementById(
  "blur-strength"
) as HTMLInputElement;
const linePaddingInput = document.getElementById(
  "line-padding"
) as HTMLInputElement;
const lineWidthMode = document.getElementById(
  "line-width-mode"
) as HTMLSelectElement;
const namePresetEl = document.getElementById(
  "name-preset"
) as HTMLSelectElement;
const nameTemplateEl = document.getElementById(
  "name-template"
) as HTMLInputElement;
const nameCustomWrap = document.getElementById("name-custom-wrap");
const namePreviewEl = document.getElementById("name-preview");
const nameMetaEl = document.getElementById("name-meta");
const exportNamePresetEl = document.getElementById(
  "export-name-preset"
) as HTMLSelectElement | null;
const exportNameTemplateEl = document.getElementById(
  "export-name-template"
) as HTMLInputElement | null;
const exportCustomWrap = document.getElementById("export-custom-wrap");

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function fillNamePresetSelect(select: HTMLSelectElement | null): void {
  if (!select) return;
  select.innerHTML = "";
  for (const p of FILENAME_PRESETS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    opt.title = p.description;
    select.appendChild(opt);
  }
}

function activePage(): PageItem | undefined {
  return pages.find((p) => p.id === activeCaptureId) || pages[0];
}

function currentNameTemplate(from: "sidebar" | "export" = "sidebar"): string {
  if (from === "export" && exportNamePresetEl) {
    const id = exportNamePresetEl.value;
    if (id === "custom") {
      return (
        exportNameTemplateEl?.value ||
        nameTemplateEl.value ||
        settings?.filenameTemplate ||
        "{title} - {date} {time}"
      );
    }
    return templateForPreset(id, settings?.filenameTemplate);
  }
  const id = namePresetEl.value;
  if (id === "custom") {
    return (
      nameTemplateEl.value ||
      settings?.filenameTemplate ||
      "{title} - {date} {time}"
    );
  }
  return templateForPreset(id, settings?.filenameTemplate);
}

function syncNameCustomVisibility(): void {
  if (nameCustomWrap) nameCustomWrap.hidden = namePresetEl.value !== "custom";
  if (exportCustomWrap && exportNamePresetEl) {
    exportCustomWrap.hidden = exportNamePresetEl.value !== "custom";
  }
}

function namingContext() {
  const page = activePage();
  return {
    title: page?.title || doc?.title || "screenshot",
    docTitle: doc?.title || "document",
    url: page?.url || "",
    width: page?.width,
    height: page?.height,
    capturedAt: page?.createdAt || Date.now(),
  };
}

function updateNamePreview(): void {
  const ctx = namingContext();
  const template = currentNameTemplate("sidebar");
  const base = buildNameBase({
    template,
    title: ctx.title,
    docTitle: ctx.docTitle,
    url: ctx.url,
    width: ctx.width,
    height: ctx.height,
    capturedAt: ctx.capturedAt,
  });
  if (namePreviewEl) namePreviewEl.textContent = base || "—";

  const parts = parseUrlParts(ctx.url);
  const when = formatDateParts(new Date(ctx.capturedAt));
  if (nameMetaEl) {
    if (ctx.url) {
      nameMetaEl.textContent = `Website: ${parts.website}\nPlace: /${parts.place === "home" ? "" : parts.place.replace(/_/g, "/")}\nTaken: ${when.date} ${when.time.replace(/-/g, ":")}`;
    } else {
      nameMetaEl.textContent = "Select a capture to use website / place / time.";
    }
  }
}

async function persistNameTemplate(template: string): Promise<void> {
  await sendMessage({
    type: "SET_SETTINGS",
    settings: { filenameTemplate: template },
  });
  if (settings) settings.filenameTemplate = template;
}

function initNamingUi(): void {
  fillNamePresetSelect(namePresetEl);
  fillNamePresetSelect(exportNamePresetEl);
  const template = settings?.filenameTemplate || "{title} - {date} {time}";
  const presetId = presetMatchingTemplate(template);
  namePresetEl.value = presetId;
  nameTemplateEl.value = template;
  if (exportNamePresetEl) exportNamePresetEl.value = presetId;
  if (exportNameTemplateEl) exportNameTemplateEl.value = template;
  syncNameCustomVisibility();
  updateNamePreview();
}

function syncRangeOutputs(): void {
  syncAllRangeOutputs();
}

function hideGuide(): void {
  blurGuide.hidden = true;
}

function hexToRgba(hex: string, alpha: number): string {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (full.length !== 6) return `rgba(255, 230, 0, ${alpha})`;
  const n = Number.parseInt(full, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyGuideColor(): void {
  const color = readToolProps().lineBlurGuideColor || "#ffe000";
  blurGuide.style.setProperty("--guide-color", color);
  blurGuide.style.setProperty("--guide-fill", hexToRgba(color, 0.35));
}

function showGuide(rect: GuideRect): void {
  if (!canvas.width || !canvas.height) {
    hideGuide();
    return;
  }
  const scaleX = canvas.clientWidth / canvas.width;
  const scaleY = canvas.clientHeight / canvas.height;
  if (tool === "lineblur") {
    applyGuideColor();
  } else {
    blurGuide.style.setProperty("--guide-color", "#0a84ff");
    blurGuide.style.setProperty("--guide-fill", "rgba(10, 132, 255, 0.25)");
  }
  blurGuide.hidden = false;
  blurGuide.style.left = `${rect.x * scaleX}px`;
  blurGuide.style.top = `${rect.y * scaleY}px`;
  blurGuide.style.width = `${Math.max(1, rect.width) * scaleX}px`;
  blurGuide.style.height = `${Math.max(1, rect.height) * scaleY}px`;
}

function lineHeightPx(): number {
  return Math.max(10, Number(lineHeightInput.value) || 28);
}

function blurStrength(): number {
  return Math.max(4, readToolProps().blurStrength || 16);
}

function linePaddingPx(): number {
  return Math.max(0, Number(linePaddingInput.value) || 0);
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function lineBandAt(
  cursorX: number,
  cursorY: number,
  endX?: number
): GuideRect {
  const height = lineHeightPx();
  const pad = linePaddingPx();
  const y = clamp(
    Math.round((lineBlurAnchorY ?? cursorY) - height / 2),
    0,
    Math.max(0, canvas.height - height)
  );

  if (lineWidthMode.value === "full") {
    return {
      x: pad,
      y,
      width: Math.max(1, canvas.width - pad * 2),
      height,
    };
  }

  if (endX === undefined) {
    // Hover preview: modest band centered on cursor so aiming is obvious
    const previewW = Math.max(120, Math.round(canvas.width * 0.35));
    const x = clamp(
      Math.round(cursorX - previewW / 2),
      pad,
      Math.max(pad, canvas.width - pad - previewW)
    );
    return {
      x,
      y,
      width: Math.min(previewW, canvas.width - pad * 2),
      height,
    };
  }

  const left = Math.min(cursorX, endX);
  const right = Math.max(cursorX, endX);
  const x = clamp(Math.round(left), pad, canvas.width - pad);
  const width = Math.max(8, Math.round(right - left));
  return {
    x,
    y,
    width: Math.min(width, canvas.width - x - pad),
    height,
  };
}

async function ensureDocument(): Promise<void> {
  if (!documentId) {
    const created = await sendMessage<{ document: DocumentRecord }>({
      type: "CREATE_DOCUMENT",
      title: "Untitled Document",
    });
    documentId = created.document.id;
    doc = created.document;
  } else {
    const data = await sendMessage<{ document: DocumentRecord | undefined }>({
      type: "GET_DOCUMENT",
      documentId,
    });
    doc = data.document || null;
    if (!doc) {
      const created = await sendMessage<{ document: DocumentRecord }>({
        type: "CREATE_DOCUMENT",
        title: "Untitled Document",
      });
      documentId = created.document.id;
      doc = created.document;
    }
  }
  docTitle.value = doc.title;
  syncPropsFromDoc();
}

function syncPropsFromDoc(): void {
  if (!doc) return;
  (document.getElementById("page-size") as HTMLSelectElement).value = doc.pageSize;
  (document.getElementById("orientation") as HTMLSelectElement).value = doc.orientation;
  (document.getElementById("margins") as HTMLSelectElement).value = doc.margins;
  (document.getElementById("image-fit") as HTMLSelectElement).value = doc.imageFit;
  (document.getElementById("image-align") as HTMLSelectElement).value = doc.imageAlign;
}

async function persistDocPatch(patch: Partial<DocumentRecord>): Promise<void> {
  if (!doc || !documentId) return;
  doc = { ...doc, ...patch, modifiedAt: Date.now() };
  await sendMessage({ type: "UPDATE_DOCUMENT", document: doc });
}

function revokePageThumbs(): void {
  for (const url of pageThumbUrls) URL.revokeObjectURL(url);
  pageThumbUrls.clear();
}

function revokePreviewUrl(): void {
  if (cachedPreviewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(cachedPreviewUrl);
  }
  cachedPreviewUrl = null;
  if (previewBitmap) {
    previewBitmap.close();
    previewBitmap = null;
  }
}

function scheduleSaveEdits(): void {
  if (!activeCaptureId) return;
  if (saveEditsTimer !== null) window.clearTimeout(saveEditsTimer);
  const captureId = activeCaptureId;
  const snapshot = ops;
  saveEditsTimer = window.setTimeout(() => {
    saveEditsTimer = null;
    void idbSaveEdits(captureId, snapshot);
  }, 350);
}

async function flushSaveEdits(): Promise<void> {
  if (saveEditsTimer !== null) {
    window.clearTimeout(saveEditsTimer);
    saveEditsTimer = null;
  }
  if (!activeCaptureId) return;
  await idbSaveEdits(activeCaptureId, ops);
}

function schedulePreviewBlobRefresh(): void {
  if (blobRefreshTimer !== null) window.clearTimeout(blobRefreshTimer);
  blobRefreshTimer = window.setTimeout(() => {
    blobRefreshTimer = null;
    void refreshPreviewBlobFromCanvas();
  }, 120);
}

function canvasToPngBlob(): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/png"
    );
  });
}

async function refreshPreviewBlobFromCanvas(): Promise<void> {
  try {
    cachedPreviewBlob = await canvasToPngBlob();
  } catch {
    /* ignore */
  }
}

async function syncPreviewBitmapFromCanvas(): Promise<void> {
  if (previewBitmap) previewBitmap.close();
  previewBitmap = await createImageBitmap(canvas);
  schedulePreviewBlobRefresh();
}

function opNeedsFullRaster(op: EditOp): boolean {
  return op.type === "blur" || op.type === "pixelate" || op.type === "crop";
}

function paintOpOnDisplay(op: EditOp): void {
  if (op.type === "redact") {
    drawRedact(ctx, {
      x: op.x,
      y: op.y,
      width: op.width,
      height: op.height,
      color: op.color,
      opacity: op.opacity,
      style: op.style,
      cornerRadius: op.cornerRadius,
    });
  } else if (op.type === "rect") {
    ctx.save();
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
  } else if (op.type === "freehand" && op.points.length > 1) {
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

async function fillPageThumbnails(
  byId: Map<string, { blob: Blob }>
): Promise<void> {
  const ids = pages.map((p) => p.id);
  // Prefer the active page thumb first, then the rest in batches.
  const ordered = activeCaptureId
    ? [activeCaptureId, ...ids.filter((id) => id !== activeCaptureId)]
    : ids;

  const concurrency = 3;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < ordered.length) {
      const id = ordered[cursor++];
      const page = pages.find((p) => p.id === id);
      const cap = byId.get(id);
      if (!page || !cap || page.thumbReady) continue;
      try {
        const thumb = await createThumbnailObjectUrl(cap.blob, 220);
        pageThumbUrls.add(thumb);
        page.previewDataUrl = thumb;
        page.thumbReady = true;
        const img = pageList.querySelector(
          `li[data-id="${CSS.escape(id)}"] img`
        ) as HTMLImageElement | null;
        if (img) img.src = thumb;
      } catch {
        // leave placeholder
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, ordered.length) }, () => worker())
  );
}

async function loadPages(): Promise<void> {
  if (!doc) return;
  revokePageThumbs();
  pages = [];

  const byId = await getCapturesByIds(doc.pageOrder);

  const built: PageItem[] = [];
  for (const id of doc.pageOrder) {
    const cap = byId.get(id);
    if (!cap) continue;
    built.push({
      id,
      title: cap.pageTitle,
      previewDataUrl: "",
      width: cap.width,
      height: cap.height,
      url: cap.url || "",
      createdAt: cap.createdAt || Date.now(),
      thumbReady: false,
    });
  }
  pages = built;

  if (activeCaptureId && !doc.pageOrder.includes(activeCaptureId)) {
    await sendMessage({
      type: "ADD_TO_DOCUMENT",
      captureId: activeCaptureId,
      documentId: documentId!,
    });
    const refreshed = await sendMessage<{ document: DocumentRecord }>({
      type: "GET_DOCUMENT",
      documentId: documentId!,
    });
    doc = refreshed.document;
    return loadPages();
  }

  renderPageList();
  if (!activeCaptureId && pages[0]) activeCaptureId = pages[0].id;

  // Show the active capture immediately; thumbnails fill in afterward.
  const loadMain = activeCaptureId
    ? loadCapture(activeCaptureId)
    : Promise.resolve().then(() => {
        empty.classList.remove("hidden");
        canvas.style.display = "none";
      });

  void fillPageThumbnails(byId);
  await loadMain;
}

function updatePageToolbar(): void {
  const selectAll = document.getElementById(
    "select-all-pages"
  ) as HTMLInputElement | null;
  const deleteSelected = document.getElementById(
    "btn-delete-selected"
  ) as HTMLButtonElement | null;
  const deleteAll = document.getElementById(
    "btn-delete-all"
  ) as HTMLButtonElement | null;
  const n = selectedCaptureIds.size;
  if (deleteSelected) {
    deleteSelected.disabled = n === 0;
    deleteSelected.textContent =
      n > 0 ? `Delete selected (${n})` : "Delete selected";
  }
  if (deleteAll) deleteAll.disabled = pages.length === 0;
  if (selectAll) {
    selectAll.checked = pages.length > 0 && n === pages.length;
    selectAll.indeterminate = n > 0 && n < pages.length;
  }
}

async function removeCaptures(ids: string[], confirmMsg: string): Promise<void> {
  if (!ids.length) return;
  if (!confirm(confirmMsg)) return;

  const unique = [...new Set(ids)];
  for (const captureId of unique) {
    await sendMessage({ type: "DELETE_CAPTURE", captureId });
    selectedCaptureIds.delete(captureId);
  }

  if (doc) {
    doc.pageOrder = doc.pageOrder.filter((id) => !unique.includes(id));
  }
  pages = pages.filter((p) => !unique.includes(p.id));

  const lostActive = !!(activeCaptureId && unique.includes(activeCaptureId));
  if (lostActive) {
    activeCaptureId = pages[0]?.id || null;
    if (activeCaptureId) {
      await loadCapture(activeCaptureId);
    } else {
      sourceBlob = null;
      ops = [];
      undoStack = [];
      redoStack = [];
      canvas.style.display = "none";
      empty.classList.remove("hidden");
      dims.textContent = "";
      hideGuide();
      renderPageList();
      updateNamePreview();
    }
  } else {
    renderPageList();
  }

  setStatus(
    unique.length === 1 ? "Capture deleted" : `Deleted ${unique.length} captures`
  );
}

async function deletePageCapture(captureId: string): Promise<void> {
  const page = pages.find((p) => p.id === captureId);
  const label = page?.title || "this capture";
  await removeCaptures(
    [captureId],
    `Delete “${label}” from this document? This cannot be undone.`
  );
}

function renderPageList(): void {
  // Drop selection for pages that no longer exist
  for (const id of [...selectedCaptureIds]) {
    if (!pages.some((p) => p.id === id)) selectedCaptureIds.delete(id);
  }

  pageList.innerHTML = "";
  pages.forEach((p, index) => {
    const li = document.createElement("li");
    li.draggable = true;
    li.dataset.id = p.id;
    if (p.id === activeCaptureId) li.classList.add("active");
    if (selectedCaptureIds.has(p.id)) li.classList.add("checked");

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "cap-check";
    check.checked = selectedCaptureIds.has(p.id);
    check.title = "Select for bulk delete";
    check.setAttribute("aria-label", `Select ${p.title}`);
    check.addEventListener("click", (e) => e.stopPropagation());
    check.addEventListener("change", () => {
      if (check.checked) selectedCaptureIds.add(p.id);
      else selectedCaptureIds.delete(p.id);
      li.classList.toggle("checked", check.checked);
      updatePageToolbar();
    });

    const body = document.createElement("div");
    body.className = "cap-body";

    const img = document.createElement("img");
    img.alt = "";
    if (p.previewDataUrl) img.src = p.previewDataUrl;
    else img.classList.add("thumb-pending");

    const meta = document.createElement("div");
    meta.className = "cap-meta";

    const title = document.createElement("div");
    title.className = "cap-title";
    title.textContent = `${index + 1}. ${p.title}`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "cap-delete";
    del.title = "Delete capture";
    del.setAttribute("aria-label", `Delete ${p.title}`);
    del.textContent = "Delete";
    del.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void deletePageCapture(p.id);
    });

    meta.append(title, del);
    body.append(img, meta);
    li.append(check, body);

    li.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest(".cap-delete") || t.closest(".cap-check")) return;
      void loadCapture(p.id);
    });
    li.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/plain", p.id);
    });
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", async (e) => {
      e.preventDefault();
      const fromId = e.dataTransfer?.getData("text/plain");
      if (!fromId || !doc) return;
      const order = [...doc.pageOrder];
      const from = order.indexOf(fromId);
      const to = order.indexOf(p.id);
      if (from < 0 || to < 0) return;
      order.splice(from, 1);
      order.splice(to, 0, fromId);
      await sendMessage({
        type: "REORDER_DOCUMENT_PAGES",
        documentId: documentId!,
        pageOrder: order,
      });
      doc.pageOrder = order;
      await loadPages();
    });
    pageList.appendChild(li);
  });
  updatePageToolbar();
}

function applyNavWidth(px: number, persist = false): number {
  const width = Math.min(NAV_WIDTH_MAX, Math.max(NAV_WIDTH_MIN, Math.round(px)));
  appEl.style.setProperty("--nav-width", `${width}px`);
  const resizer = document.getElementById("nav-resizer");
  resizer?.setAttribute("aria-valuenow", String(width));
  if (persist) localStorage.setItem(NAV_WIDTH_KEY, String(width));
  return width;
}

function initNavResizer(): void {
  const stored = Number(localStorage.getItem(NAV_WIDTH_KEY));
  applyNavWidth(Number.isFinite(stored) ? stored : 220);

  const resizer = document.getElementById("nav-resizer");
  if (!resizer) return;

  let dragging = false;

  const onMove = (clientX: number) => {
    const left = appEl.getBoundingClientRect().left;
    applyNavWidth(clientX - left);
  };

  resizer.addEventListener("pointerdown", (e) => {
    dragging = true;
    appEl.classList.add("nav-resizing");
    resizer.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  resizer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    onMove(e.clientX);
  });
  const endDrag = (e: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    appEl.classList.remove("nav-resizing");
    try {
      resizer.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const current =
      parseInt(getComputedStyle(appEl).getPropertyValue("--nav-width"), 10) ||
      220;
    applyNavWidth(current, true);
  };
  resizer.addEventListener("pointerup", endDrag);
  resizer.addEventListener("pointercancel", endDrag);

  resizer.addEventListener("keydown", (e) => {
    const current =
      parseInt(getComputedStyle(appEl).getPropertyValue("--nav-width"), 10) ||
      220;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      applyNavWidth(current - 16, true);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      applyNavWidth(current + 16, true);
    }
  });
}

function bindPageToolbar(): void {
  document.getElementById("select-all-pages")?.addEventListener("change", (e) => {
    const on = (e.target as HTMLInputElement).checked;
    selectedCaptureIds.clear();
    if (on) {
      for (const p of pages) selectedCaptureIds.add(p.id);
    }
    renderPageList();
  });

  document.getElementById("btn-delete-selected")?.addEventListener("click", () => {
    const ids = [...selectedCaptureIds];
    void removeCaptures(
      ids,
      `Delete ${ids.length} selected capture${ids.length === 1 ? "" : "s"}? This cannot be undone.`
    );
  });

  document.getElementById("btn-delete-all")?.addEventListener("click", () => {
    const ids = pages.map((p) => p.id);
    void removeCaptures(
      ids,
      `Delete all ${ids.length} captures in this document? This cannot be undone.`
    );
  });
}

async function loadCapture(captureId: string): Promise<void> {
  activeCaptureId = captureId;
  const [cap, edits] = await Promise.all([
    getCapture(captureId),
    getEdits(captureId),
  ]);
  if (!cap) {
    setStatus("Capture not found");
    return;
  }
  sourceBlob = cap.blob;
  ops = edits;
  undoStack = [];
  redoStack = [];
  cachedPreviewBlob = null;
  empty.classList.add("hidden");
  canvas.style.display = "block";
  await redraw();
  renderPageList();
  dims.textContent = `${cap.width} × ${cap.height} px`;
  updateBreakLines(cap.width, cap.height);
  updateNamePreview();
}

function pageBreaksEnabled(): boolean {
  return (document.getElementById("show-page-breaks") as HTMLInputElement)
    ?.checked === true;
}

function updateBreakLines(width: number, height: number): void {
  breakLines.innerHTML = "";
  breakLines.classList.remove("visible");
  if (!pageBreaksEnabled()) {
    pageBreaks = [];
    return;
  }

  // Approximate letter content height at fit-width scale for visual guides
  const pageContentCss = Math.round((11 - 1) * 96);
  pageBreaks = suggestBreaks(
    height,
    Math.max(400, pageContentCss * (width / (8.5 * 96)))
  );
  if (!pageBreaks.length) return;

  breakLines.classList.add("visible");
  const displayHeight = canvas.clientHeight || height;
  const scaleY = displayHeight / height;
  for (const y of pageBreaks) {
    const el = document.createElement("div");
    el.className = "break";
    el.style.top = `${y * scaleY}px`;
    el.title = "PDF page break (drag to adjust)";
    let start = 0;
    let origin = y;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      start = e.clientY;
      origin = y;
      const move = (ev: PointerEvent) => {
        const dy = (ev.clientY - start) / scaleY;
        el.style.top = `${(origin + dy) * scaleY}px`;
      };
      const up = (ev: PointerEvent) => {
        const dy = (ev.clientY - start) / scaleY;
        const idx = pageBreaks.indexOf(origin);
        if (idx >= 0) pageBreaks[idx] = Math.max(20, origin + dy);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        updateBreakLines(width, height);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    breakLines.appendChild(el);
  }
}

async function redraw(): Promise<void> {
  if (!sourceBlob) return;
  const blob = await previewBlob(sourceBlob, ops);
  cachedPreviewBlob = blob;
  const bitmap = await createImageBitmap(blob);
  const sizeChanged =
    canvas.width !== bitmap.width || canvas.height !== bitmap.height;
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);

  revokePreviewUrl();
  previewBitmap = bitmap;
  cachedPreviewUrl = URL.createObjectURL(blob);
  if (sizeChanged) applyViewZoom();
  else updateZoomLabel();
}

function paintBasePreview(): void {
  if (!previewBitmap) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(previewBitmap, 0, 0);
}

function opIntersects(
  op: EditOp,
  x: number,
  y: number,
  w: number,
  h: number
): boolean {
  const right = x + w;
  const bottom = y + h;
  if ("width" in op && "height" in op && "x" in op && "y" in op) {
    const ox = op.x as number;
    const oy = op.y as number;
    const ow = op.width as number;
    const oh = op.height as number;
    return ox < right && ox + ow > x && oy < bottom && oy + oh > y;
  }
  if ("x1" in op && "y1" in op && "x2" in op && "y2" in op) {
    const minx = Math.min(op.x1, op.x2);
    const maxx = Math.max(op.x1, op.x2);
    const miny = Math.min(op.y1, op.y2);
    const maxy = Math.max(op.y1, op.y2);
    return minx < right && maxx > x && miny < bottom && maxy > y;
  }
  if (op.type === "freehand") {
    return op.points.some((p) => p.x >= x && p.x <= right && p.y >= y && p.y <= bottom);
  }
  return false;
}

async function commitOp(
  op: EditOp,
  opts?: { alreadyPainted?: boolean }
): Promise<void> {
  undoStack.push(ops.map((o) => ({ ...o })) as EditOp[]);
  redoStack = [];
  ops = [...ops, op];
  scheduleSaveEdits();
  if (opNeedsFullRaster(op) || !previewBitmap) {
    await redraw();
    return;
  }
  // Cheap annotations: paint onto the current canvas (no full re-rasterize).
  if (!opts?.alreadyPainted) paintOpOnDisplay(op);
  await syncPreviewBitmapFromCanvas();
}

async function undo(): Promise<void> {
  if (!undoStack.length) return;
  redoStack.push(ops);
  ops = undoStack.pop() || [];
  scheduleSaveEdits();
  await redraw();
}

async function redo(): Promise<void> {
  if (!redoStack.length) return;
  undoStack.push(ops);
  ops = redoStack.pop() || [];
  scheduleSaveEdits();
  await redraw();
}

function fitScale(): number {
  if (!canvas.width) return 1;
  const maxCss = Math.min(VIEW_FIT_MAX_CSS, Math.max(320, window.innerWidth * 0.7));
  return Math.min(1, maxCss / canvas.width);
}

function updateZoomLabel(): void {
  if (zoomLabelBtn) zoomLabelBtn.textContent = `${Math.round(viewZoom * 100)}%`;
}

/**
 * Sets CSS display size only. Bitmap `canvas.width/height` (and exports) stay full resolution.
 */
function applyViewZoom(anchor?: { clientX: number; clientY: number }): void {
  if (!canvas.width || !canvas.height) return;

  const prevRect = canvas.getBoundingClientRect();
  const scale = fitScale() * viewZoom;
  const displayW = Math.max(1, Math.round(canvas.width * scale));
  const displayH = Math.max(1, Math.round(canvas.height * scale));
  canvas.style.width = `${displayW}px`;
  canvas.style.height = `${displayH}px`;
  updateZoomLabel();

  if (anchor && workspaceEl && prevRect.width > 0 && prevRect.height > 0) {
    const relX = (anchor.clientX - prevRect.left) / prevRect.width;
    const relY = (anchor.clientY - prevRect.top) / prevRect.height;
    const nextLeft = anchor.clientX - relX * displayW;
    const nextTop = anchor.clientY - relY * displayH;
    // Convert desired canvas screen position into workspace scroll delta
    const deltaX = prevRect.left - nextLeft;
    const deltaY = prevRect.top - nextTop;
    workspaceEl.scrollLeft += deltaX;
    workspaceEl.scrollTop += deltaY;
  }

  if (canvas.width && canvas.height) {
    updateBreakLines(canvas.width, canvas.height);
  }
}

function setViewZoom(
  next: number,
  anchor?: { clientX: number; clientY: number }
): void {
  viewZoom = Math.min(VIEW_ZOOM_MAX, Math.max(VIEW_ZOOM_MIN, next));
  // Snap near 100%
  if (Math.abs(viewZoom - 1) < 0.03) viewZoom = 1;
  applyViewZoom(anchor);
}

function zoomBy(
  factor: number,
  anchor?: { clientX: number; clientY: number }
): void {
  setViewZoom(viewZoom * factor, anchor);
}

function canvasPoint(e: MouseEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
  return { x, y };
}

function updateLineBlurGuide(p: { x: number; y: number }, endX?: number): void {
  const band = lineBandAt(p.x, p.y, endX);
  showGuide(band);
}

canvas.addEventListener("mousedown", (e) => {
  if (!sourceBlob) return;
  const p = canvasPoint(e);
  dragStart = p;
  const props = readToolProps();
  dragStrokeProps = props;
  if (tool === "lineblur") {
    lineBlurAnchorY = p.y;
    if (lineWidthMode.value === "full") {
      updateLineBlurGuide(p);
    } else {
      updateLineBlurGuide(p, p.x);
    }
    return;
  }
  if (tool === "eraser" && props.eraserMode === "last") {
    if (ops.length) {
      void (async () => {
        undoStack.push(ops.map((o) => ({ ...o })) as EditOp[]);
        redoStack = [];
        ops = ops.slice(0, -1);
        scheduleSaveEdits();
        await redraw();
        setStatus("Removed last mark");
      })();
    }
    dragStart = null;
    return;
  }
  if (
    tool === "blur" ||
    tool === "redact" ||
    tool === "highlighter" ||
    tool === "eraser" ||
    tool === "rect"
  ) {
    showGuide({ x: p.x, y: p.y, width: 1, height: 1 });
  }
  if (tool === "freehand") {
    freehandPoints = [p];
    freehandLast = p;
    ctx.strokeStyle = props.drawColor;
    ctx.lineWidth = props.drawWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }
  if (tool === "text") {
    const text = prompt("Text annotation");
    if (text) {
      void commitOp({
        type: "text",
        x: p.x,
        y: p.y,
        text,
        color: props.textColor,
        fontSize: Math.max(10, props.textSize),
        fontFamily: props.textFont,
      });
    }
    dragStart = null;
    hideGuide();
  }
});

function strokeFreehandSegment(
  from: { x: number; y: number },
  to: { x: number; y: number }
): void {
  const props = dragStrokeProps;
  if (!props) return;
  ctx.strokeStyle = props.drawColor;
  ctx.lineWidth = props.drawWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

canvas.addEventListener("mousemove", (e) => {
  if (!sourceBlob) return;
  const p = canvasPoint(e);

  if (tool === "lineblur") {
    if (dragStart) {
      updateLineBlurGuide(
        { x: dragStart.x, y: dragStart.y },
        lineWidthMode.value === "full" ? undefined : p.x
      );
    } else {
      lineBlurAnchorY = null;
      updateLineBlurGuide(p);
    }
    return;
  }

  if (!dragStart || tool === "select" || tool === "text") {
    if (tool !== "blur") hideGuide();
    return;
  }

  if (
    tool === "blur" ||
    tool === "redact" ||
    tool === "highlighter" ||
    tool === "eraser" ||
    tool === "rect"
  ) {
    const x = Math.min(dragStart.x, p.x);
    const y = Math.min(dragStart.y, p.y);
    showGuide({
      x,
      y,
      width: Math.abs(p.x - dragStart.x),
      height: Math.abs(p.y - dragStart.y),
    });
  }

  if (tool === "freehand") {
    pendingFreehandPoint = p;
    if (!freehandRaf) {
      freehandRaf = requestAnimationFrame(() => {
        freehandRaf = 0;
        const next = pendingFreehandPoint;
        pendingFreehandPoint = null;
        if (!next || !freehandLast) return;
        freehandPoints.push(next);
        strokeFreehandSegment(freehandLast, next);
        freehandLast = next;
      });
    }
    return;
  }

  if (tool === "line" && dragStart) {
    const props = dragStrokeProps || readToolProps();
    paintBasePreview();
    ctx.strokeStyle = props.lineStrokeColor;
    ctx.lineWidth = props.lineStrokeWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(dragStart.x, dragStart.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  if (tool === "arrow" && dragStart) {
    const props = dragStrokeProps || readToolProps();
    paintBasePreview();
    drawArrow(ctx, {
      x1: dragStart.x,
      y1: dragStart.y,
      x2: p.x,
      y2: p.y,
      stroke: props.arrowColor,
      lineWidth: props.arrowWidth,
      heads: props.arrowHeads,
      headSize: props.arrowHeadSize,
      filled: props.arrowFilled,
    });
  }
});

canvas.addEventListener("mouseleave", () => {
  if (!dragStart && tool === "lineblur") hideGuide();
});

canvas.addEventListener("mouseup", async (e) => {
  if (!dragStart) return;
  const p = canvasPoint(e);
  const props = readToolProps();

  try {
    if (tool === "lineblur") {
      const band =
        lineWidthMode.value === "full"
          ? lineBandAt(dragStart.x, dragStart.y)
          : lineBandAt(dragStart.x, dragStart.y, p.x);
      // Tiny click with drag mode: expand to a usable default span around click
      if (lineWidthMode.value === "drag" && band.width < 12) {
        const widened = lineBandAt(dragStart.x, dragStart.y);
        await commitOp({
          type: "blur",
          x: widened.x,
          y: widened.y,
          width: widened.width,
          height: widened.height,
          strength: blurStrength(),
        });
      } else {
        await commitOp({
          type: "blur",
          x: band.x,
          y: band.y,
          width: band.width,
          height: band.height,
          strength: blurStrength(),
        });
      }
      setStatus("Line blurred");
      return;
    }

    const x = Math.min(dragStart.x, p.x);
    const y = Math.min(dragStart.y, p.y);
    const width = Math.abs(p.x - dragStart.x);
    const height = Math.abs(p.y - dragStart.y);

    if (tool === "freehand" && freehandPoints.length > 1) {
      // Flush any pending rAF point, then commit without re-painting.
      if (pendingFreehandPoint && freehandLast) {
        freehandPoints.push(pendingFreehandPoint);
        strokeFreehandSegment(freehandLast, pendingFreehandPoint);
        freehandLast = pendingFreehandPoint;
        pendingFreehandPoint = null;
      }
      await commitOp(
        {
          type: "freehand",
          points: freehandPoints,
          stroke: props.drawColor,
          lineWidth: Math.max(1, props.drawWidth),
        },
        { alreadyPainted: true }
      );
    } else if (width >= 2 && height >= 2) {
      if (tool === "blur") {
        await commitOp({
          type: "blur",
          x,
          y,
          width,
          height,
          strength: blurStrength(),
        });
      } else if (tool === "redact") {
        await commitOp({
          type: "redact",
          x,
          y,
          width,
          height,
          color: props.redactColor,
          opacity: props.redactOpacity,
          style: props.redactStyle,
          cornerRadius: props.redactRadius,
        });
      } else if (tool === "rect") {
        await commitOp({
          type: "rect",
          x,
          y,
          width,
          height,
          stroke: props.strokeColor,
          lineWidth: Math.max(1, props.strokeWidth),
          fill: props.fillEnabled ? props.fillColor : undefined,
        });
      } else if (tool === "highlighter") {
        await commitOp({
          type: "highlighter",
          x,
          y,
          width,
          height,
          color: props.highlightColor,
          opacity: props.highlightOpacity,
        });
      } else if (tool === "eraser") {
        undoStack.push(ops.map((o) => ({ ...o })) as EditOp[]);
        redoStack = [];
        ops = ops.filter((op) => !opIntersects(op, x, y, width, height));
        scheduleSaveEdits();
        await redraw();
        setStatus("Erased intersecting marks");
      }
    } else if (tool === "line") {
      paintBasePreview();
      ctx.strokeStyle = props.lineStrokeColor;
      ctx.lineWidth = Math.max(1, props.lineStrokeWidth);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(dragStart.x, dragStart.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      await commitOp(
        {
          type: "line",
          x1: dragStart.x,
          y1: dragStart.y,
          x2: p.x,
          y2: p.y,
          stroke: props.lineStrokeColor,
          lineWidth: Math.max(1, props.lineStrokeWidth),
        },
        { alreadyPainted: true }
      );
    } else if (tool === "arrow") {
      paintBasePreview();
      drawArrow(ctx, {
        x1: dragStart.x,
        y1: dragStart.y,
        x2: p.x,
        y2: p.y,
        stroke: props.arrowColor,
        lineWidth: Math.max(1, props.arrowWidth),
        heads: props.arrowHeads,
        headSize: props.arrowHeadSize,
        filled: props.arrowFilled,
      });
      await commitOp(
        {
          type: "arrow",
          x1: dragStart.x,
          y1: dragStart.y,
          x2: p.x,
          y2: p.y,
          stroke: props.arrowColor,
          lineWidth: Math.max(1, props.arrowWidth),
          heads: props.arrowHeads,
          headSize: props.arrowHeadSize,
          filled: props.arrowFilled,
        },
        { alreadyPainted: true }
      );
    }
  } finally {
    dragStart = null;
    freehandPoints = [];
    freehandLast = null;
    pendingFreehandPoint = null;
    dragStrokeProps = null;
    lineBlurAnchorY = null;
    if (tool !== "lineblur") hideGuide();
  }
});

document.querySelectorAll<HTMLButtonElement>("[data-tool]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll("[data-tool]")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    tool = btn.dataset.tool as Tool;
    hideGuide();
    lineBlurAnchorY = null;
    applyToolPanelVisibility(tool);
    setStatus(tool === "select" ? "" : `Tool: ${btn.textContent || tool}`);
  });
});

document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((el) => {
  el.addEventListener("input", () => syncRangeOutputs());
});
bindSwatches();
applyToolPanelVisibility(tool);
syncRangeOutputs();
applyGuideColor();
document
  .getElementById("lineblur-guide-color")
  ?.addEventListener("input", () => applyGuideColor());

document.getElementById("btn-undo")!.addEventListener("click", () => void undo());
document.getElementById("btn-redo")!.addEventListener("click", () => void redo());

document.getElementById("btn-zoom-in")!.addEventListener("click", () => {
  zoomBy(1.25);
});
document.getElementById("btn-zoom-out")!.addEventListener("click", () => {
  zoomBy(1 / 1.25);
});
document.getElementById("btn-zoom-fit")!.addEventListener("click", () => {
  setViewZoom(1);
});
document.getElementById("btn-zoom-label")!.addEventListener("click", () => {
  setViewZoom(1);
});

workspaceEl?.addEventListener(
  "wheel",
  (e) => {
    if (!(e.ctrlKey || e.metaKey) || !sourceBlob) return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    zoomBy(factor, { clientX: e.clientX, clientY: e.clientY });
  },
  { passive: false }
);

window.addEventListener("resize", () => {
  if (sourceBlob) applyViewZoom();
});

window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    void undo();
  } else if (mod && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
    e.preventDefault();
    void redo();
  } else if (mod && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    zoomBy(1.25);
  } else if (mod && e.key === "-") {
    e.preventDefault();
    zoomBy(1 / 1.25);
  } else if (mod && e.key === "0") {
    e.preventDefault();
    setViewZoom(1);
  }
});

updateZoomLabel();

docTitle.addEventListener("change", async () => {
  if (!documentId) return;
  await sendMessage({
    type: "RENAME_DOCUMENT",
    documentId,
    title: docTitle.value || "Untitled Document",
  });
  if (doc) doc.title = docTitle.value;
});

document.getElementById("btn-new-doc")!.addEventListener("click", async () => {
  const created = await sendMessage<{ document: DocumentRecord }>({
    type: "CREATE_DOCUMENT",
    title: "Untitled Document",
  });
  location.href = `editor.html?documentId=${created.document.id}`;
});

async function saveLayoutField(): Promise<void> {
  if (!doc) return;
  doc.pageSize = (document.getElementById("page-size") as HTMLSelectElement)
    .value as DocumentRecord["pageSize"];
  doc.orientation = (
    document.getElementById("orientation") as HTMLSelectElement
  ).value as DocumentRecord["orientation"];
  doc.margins = (document.getElementById("margins") as HTMLSelectElement)
    .value as DocumentRecord["margins"];
  doc.imageFit = (document.getElementById("image-fit") as HTMLSelectElement)
    .value as DocumentRecord["imageFit"];
  doc.imageAlign = (
    document.getElementById("image-align") as HTMLSelectElement
  ).value as DocumentRecord["imageAlign"];
  await persistDocPatch(doc);
  setStatus("Layout saved");
}

["page-size", "orientation", "margins", "image-fit", "image-align"].forEach(
  (id) => {
    document.getElementById(id)!.addEventListener("change", () => {
      void saveLayoutField();
    });
  }
);

document.getElementById("show-page-breaks")?.addEventListener("change", () => {
  if (canvas.width && canvas.height) {
    updateBreakLines(canvas.width, canvas.height);
  } else {
    breakLines.innerHTML = "";
    breakLines.classList.remove("visible");
  }
});

const preservePdfLinksEl = document.getElementById(
  "preserve-pdf-links"
) as HTMLInputElement | null;
preservePdfLinksEl?.addEventListener("change", () => {
  void sendMessage({
    type: "SET_SETTINGS",
    settings: { preservePdfLinks: preservePdfLinksEl.checked },
  }).then(() => {
    if (settings) settings.preservePdfLinks = preservePdfLinksEl.checked;
    setStatus(
      preservePdfLinksEl.checked
        ? "PDF link preservation on"
        : "PDF link preservation off"
    );
  });
});

const exportDialog = document.getElementById("export-dialog") as HTMLDialogElement;

function refreshExportFilename(): void {
  const format = (
    document.getElementById("export-format") as HTMLSelectElement
  ).value;
  const ext =
    format === "jpeg" ? "jpg" : format === "webp" ? "webp" : format === "pdf" ? "pdf" : "png";
  const ctx = namingContext();
  (document.getElementById("export-filename") as HTMLInputElement).value =
    buildFilename({
      template: currentNameTemplate("export"),
      title: ctx.title,
      docTitle: ctx.docTitle,
      url: ctx.url,
      width: ctx.width,
      height: ctx.height,
      capturedAt: ctx.capturedAt,
      extension: ext,
    });
}

namePresetEl.addEventListener("change", () => {
  const id = namePresetEl.value;
  if (id !== "custom") {
    nameTemplateEl.value = templateForPreset(id, nameTemplateEl.value);
    void persistNameTemplate(nameTemplateEl.value);
  }
  if (exportNamePresetEl) exportNamePresetEl.value = id;
  syncNameCustomVisibility();
  updateNamePreview();
});

nameTemplateEl.addEventListener("input", () => {
  updateNamePreview();
});

nameTemplateEl.addEventListener("change", () => {
  void persistNameTemplate(currentNameTemplate("sidebar"));
  updateNamePreview();
});

document.getElementById("btn-apply-name")!.addEventListener("click", async () => {
  if (!documentId) return;
  const title = buildNameBase({
    template: currentNameTemplate("sidebar"),
    ...namingContext(),
  });
  docTitle.value = title;
  await sendMessage({
    type: "RENAME_DOCUMENT",
    documentId,
    title,
  });
  if (doc) doc.title = title;
  await persistNameTemplate(currentNameTemplate("sidebar"));
  setStatus("Document renamed");
  updateNamePreview();
});

exportNamePresetEl?.addEventListener("change", () => {
  const id = exportNamePresetEl.value;
  if (id !== "custom" && exportNameTemplateEl) {
    exportNameTemplateEl.value = templateForPreset(id, exportNameTemplateEl.value);
  }
  namePresetEl.value = id;
  if (id !== "custom") {
    nameTemplateEl.value = templateForPreset(id, nameTemplateEl.value);
    void persistNameTemplate(nameTemplateEl.value);
  }
  syncNameCustomVisibility();
  updateNamePreview();
  refreshExportFilename();
});

exportNameTemplateEl?.addEventListener("input", () => {
  refreshExportFilename();
});

document.getElementById("export-format")?.addEventListener("change", () => {
  refreshExportFilename();
});

function openSaveDialog(): void {
  if (!activeCaptureId || !settings) {
    setStatus("Nothing to save — capture a page first");
    return;
  }
  if (exportNamePresetEl) exportNamePresetEl.value = namePresetEl.value;
  if (exportNameTemplateEl) exportNameTemplateEl.value = nameTemplateEl.value;
  syncNameCustomVisibility();
  (document.getElementById("export-format") as HTMLSelectElement).value = "png";
  refreshExportFilename();
  exportDialog.showModal();
}

document.getElementById("btn-save")!.addEventListener("click", () => {
  openSaveDialog();
});
document.getElementById("btn-nav-save")!.addEventListener("click", () => {
  openSaveDialog();
});

document.getElementById("btn-export-pdf")!.addEventListener("click", async () => {
  if (!documentId || !settings) return;
  const ctx = namingContext();
  const filename = buildFilename({
    template: currentNameTemplate("sidebar"),
    title: ctx.docTitle || ctx.title,
    docTitle: ctx.docTitle,
    url: ctx.url,
    width: ctx.width,
    height: ctx.height,
    capturedAt: ctx.capturedAt,
    extension: "pdf",
  });
  setStatus("Exporting PDF…");
  await sendMessage({
    type: "EXPORT_PDF",
    options: {
      documentId,
      filename,
      saveAs: settings.saveAsDialog,
      mode: "screenshot-document",
    },
  });
  setStatus("PDF exported");
});

async function ensureRenderedBlob(): Promise<Blob | null> {
  await flushSaveEdits();
  if (blobRefreshTimer !== null) {
    window.clearTimeout(blobRefreshTimer);
    blobRefreshTimer = null;
    await refreshPreviewBlobFromCanvas();
  }
  if (cachedPreviewBlob) return cachedPreviewBlob;
  if (!sourceBlob) return null;
  cachedPreviewBlob = await previewBlob(sourceBlob, ops);
  return cachedPreviewBlob;
}

document.getElementById("btn-copy")!.addEventListener("click", async () => {
  if (!activeCaptureId) return;
  setStatus("Copying…");
  const renderedBlob = (await ensureRenderedBlob()) || undefined;
  await sendMessage({
    type: "COPY_IMAGE",
    captureId: activeCaptureId,
    renderedBlob,
  });
  setStatus("Copied to clipboard");
});

document.getElementById("export-form")!.addEventListener("submit", async (e) => {
  e.preventDefault();
  const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
  const value = submitter?.value || "cancel";
  if (value === "cancel") {
    exportDialog.close();
    return;
  }
  if (!activeCaptureId || !settings) return;
  const format = (document.getElementById("export-format") as HTMLSelectElement)
    .value as "png" | "jpeg" | "webp" | "pdf";
  const filename = (document.getElementById("export-filename") as HTMLInputElement)
    .value;
  const quality = Number(
    (document.getElementById("export-quality") as HTMLInputElement).value
  );
  const scale = Number(
    (document.getElementById("export-scale") as HTMLInputElement).value
  );

  if (value === "copy") {
    const renderedBlob = (await ensureRenderedBlob()) || undefined;
    await sendMessage({
      type: "COPY_IMAGE",
      captureId: activeCaptureId,
      renderedBlob,
    });
    setStatus("Copied to clipboard");
    exportDialog.close();
    return;
  }

  if (format === "pdf") {
    await flushSaveEdits();
    await sendMessage({
      type: "EXPORT_PDF",
      options: {
        documentId: documentId!,
        filename: filename.endsWith(".pdf") ? filename : `${filename}.pdf`,
        saveAs: settings.saveAsDialog,
        mode: "screenshot-document",
      },
    });
  } else {
    setStatus("Saving…");
    const renderedBlob = (await ensureRenderedBlob()) || undefined;
    await sendMessage({
      type: "SAVE_IMAGE",
      options: {
        captureId: activeCaptureId,
        format,
        quality: format === "webp" && settings.webpLossless ? 100 : quality,
        scale,
        filename,
        saveAs: settings.saveAsDialog,
        includeMetadata: (
          document.getElementById("export-meta") as HTMLInputElement
        ).checked,
        renderedBlob,
      },
    });
  }
  setStatus("Saved");
  exportDialog.close();
});

window.addEventListener("pagehide", () => {
  void flushSaveEdits();
});

async function boot(): Promise<void> {
  const s = await sendMessage<{ settings: Settings }>({ type: "GET_SETTINGS" });
  settings = s.settings;
  if (preservePdfLinksEl) {
    preservePdfLinksEl.checked = settings.preservePdfLinks !== false;
  }
  initNavResizer();
  bindPageToolbar();
  initNamingUi();
  await ensureDocument();
  await loadPages();
  updateNamePreview();
}

void boot().catch((err) => {
  setStatus(err instanceof Error ? err.message : String(err));
});
