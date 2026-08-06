import { captureFullPage, captureScrollableElement } from "../capture/fullpage-capture";
import { storeCapture } from "../capture/capture-session";
import {
  blobToArrayBuffer,
  blobToDataUrl,
  dataUrlToBlob,
  encodeBlob,
  loadImage,
  scaleBitmap,
} from "../capture/image-utils";
import {
  captureDocumentRegion,
  captureRegionWithViewportDpr,
} from "../capture/region-capture";
import { captureVisibleTabPng } from "../capture/visible-capture";
import { linksToImageSpace, type DocLink } from "../capture/link-map";
import { debugLog } from "../shared/debug";
import { buildFilename, sanitizeDownloadFilename } from "../shared/filename";
import {
  assertMessageShape,
  assertSenderAllowed,
  sanitizeSettingsPatch,
} from "../shared/message-guard";
import {
  fail,
  ok,
  sendToTab,
  type RequestMessage,
  type ResponseMessage,
} from "../shared/messages";
import type { CaptureLink, CaptureType, RegionRect } from "../shared/types";
import {
  createDocument,
  createId,
  deleteCapture,
  deleteDocument,
  getCapture,
  getDocument,
  listDocuments,
  putCapture,
  putDocument,
} from "../storage/indexeddb";
import { getSettings, setSettings } from "../storage/settings";
import { installContextMenus } from "./menus";

/** Tab ids known to have content-bridge injected (cleared on navigate). */
const injectedTabs = new Set<number>();

async function getActiveTab(): Promise<browser.tabs.Tab> {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (!tab?.id) throw new Error("No active tab");
  return tab;
}

async function injectContent(tabId: number): Promise<void> {
  if (injectedTabs.has(tabId)) {
    try {
      await browser.tabs.sendMessage(tabId, { type: "PING_CONTENT" });
      return;
    } catch {
      injectedTabs.delete(tabId);
    }
  }
  try {
    await browser.tabs.sendMessage(tabId, { type: "PING_CONTENT" });
    injectedTabs.add(tabId);
  } catch {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["content/content-bridge.js"],
    });
    injectedTabs.add(tabId);
  }
}

browser.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});
browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || changeInfo.url) {
    injectedTabs.delete(tabId);
  }
});

async function tabMeta(tab: browser.tabs.Tab): Promise<{
  title: string;
  url: string;
  windowId?: number;
}> {
  return {
    title: tab.title || "Untitled",
    url: tab.url || "",
    windowId: tab.windowId,
  };
}

async function collectCaptureLinks(
  tabId: number,
  options: {
    originX: number;
    originY: number;
    widthCss: number;
    heightCss: number;
    imageWidth: number;
  }
): Promise<CaptureLink[] | undefined> {
  const settings = await getSettings();
  if (!settings.preservePdfLinks) return undefined;
  try {
    await injectContent(tabId);
    const docLinks = await sendToTab<DocLink[]>(tabId, {
      type: "COLLECT_PAGE_LINKS",
      clip: {
        x: options.originX,
        y: options.originY,
        width: options.widthCss,
        height: options.heightCss,
      },
    });
    const dpr = options.imageWidth / Math.max(1, options.widthCss);
    return linksToImageSpace(docLinks, { x: options.originX, y: options.originY }, dpr);
  } catch {
    return undefined;
  }
}

async function captureVisible(): Promise<ResponseMessage> {
  const tab = await getActiveTab();
  const meta = await tabMeta(tab);
  try {
    const metricsPromise = injectContent(tab.id!).then(() =>
      sendToTab<{
        scrollX: number;
        scrollY: number;
        viewportWidth: number;
        viewportHeight: number;
      }>(tab.id!, { type: "GET_PAGE_METRICS" }).catch(() => ({
        scrollX: 0,
        scrollY: 0,
        viewportWidth: 0,
        viewportHeight: 0,
      }))
    );
    const [metrics, shot] = await Promise.all([
      metricsPromise,
      captureVisibleTabPng(meta.windowId),
    ]);
    const links = await collectCaptureLinks(tab.id!, {
      originX: metrics.scrollX,
      originY: metrics.scrollY,
      widthCss: metrics.viewportWidth || shot.width,
      heightCss: metrics.viewportHeight || shot.height,
      imageWidth: shot.width,
    });
    const capture = await storeCapture({
      blob: shot.blob,
      width: shot.width,
      height: shot.height,
      pageTitle: meta.title,
      url: meta.url,
      captureType: "visible",
      links,
      preview: true,
    });
    return ok({ capture });
  } catch (err) {
    return fail(
      err instanceof Error
        ? err.message
        : "Visible capture failed. This page may be restricted.",
      "CAPTURE_FAILED"
    );
  }
}

async function startOverlay(kind: "region" | "element"): Promise<ResponseMessage> {
  const tab = await getActiveTab();
  if (!tab.id) return fail("No active tab");
  if (tab.url?.startsWith("about:") || tab.url?.startsWith("moz-extension:")) {
    return fail("Capture is not available on this page.", "RESTRICTED_PAGE");
  }
  await injectContent(tab.id);
  await sendToTab(tab.id, {
    type: kind === "region" ? "SHOW_REGION_OVERLAY" : "SHOW_ELEMENT_OVERLAY",
  });
  return ok(true);
}

async function handleRegionOrElement(
  rect: RegionRect,
  captureType: CaptureType,
  action: string = "capture",
  coordinateSpace: "viewport" | "document" = "viewport"
): Promise<ResponseMessage> {
  const tab = await getActiveTab();
  const meta = await tabMeta(tab);
  try {
    await injectContent(tab.id!);
    await sendToTab(tab.id!, { type: "HIDE_OVERLAY" }).catch(() => undefined);

    const metrics = await sendToTab<{
      scrollX: number;
      scrollY: number;
      viewportWidth: number;
      viewportHeight: number;
    }>(tab.id!, { type: "GET_PAGE_METRICS" }).catch(() => ({
      scrollX: 0,
      scrollY: 0,
      viewportWidth: Math.max(1, rect.width),
      viewportHeight: Math.max(1, rect.height),
    }));

    const shot =
      captureType === "region" && coordinateSpace === "document"
        ? await captureDocumentRegion({
            tabId: tab.id!,
            windowId: meta.windowId,
            rect,
          })
        : await captureRegionWithViewportDpr(
            rect,
            metrics.viewportWidth,
            meta.windowId
          );

    const clip =
      captureType === "region" && coordinateSpace === "document"
        ? rect
        : {
            x: metrics.scrollX + rect.x,
            y: metrics.scrollY + rect.y,
            width: rect.width,
            height: rect.height,
          };
    const links = await collectCaptureLinks(tab.id!, {
      originX: clip.x,
      originY: clip.y,
      widthCss: clip.width,
      heightCss: clip.height,
      imageWidth: shot.width,
    });

    const capture = await storeCapture({
      blob: shot.blob,
      width: shot.width,
      height: shot.height,
      pageTitle: meta.title,
      url: meta.url,
      captureType,
      links,
    });

    if (action === "copy") {
      await copyCapture(capture.captureId);
    } else if (action === "add") {
      await addToDocument(capture.captureId);
    } else {
      void openEditor(undefined, capture.captureId);
    }
    return ok({ capture });
  } catch (err) {
    try {
      await sendToTab(tab.id!, { type: "RESTORE_PAGE_STATE" });
    } catch {
      // ignore
    }
    return fail(err instanceof Error ? err.message : String(err), "CAPTURE_FAILED");
  }
}

async function runFullPage(
  includeLazy?: boolean,
  fixedMode?: "auto" | "keep" | "hide"
): Promise<ResponseMessage> {
  const tab = await getActiveTab();
  const meta = await tabMeta(tab);
  const settings = await getSettings();
  try {
    const shot = await captureFullPage({
      tabId: tab.id!,
      windowId: meta.windowId,
      includeLazy: includeLazy ?? settings.includeLazyContent,
      fixedMode: fixedMode ?? settings.fixedElementMode,
      maxHeightCss: settings.maxCaptureHeightCss,
      onProgress: (current, total, message) => {
        void debugLog(message, { current, total });
      },
    });
    let links: CaptureLink[] | undefined;
    try {
      const metrics = await sendToTab<{
        scrollWidth: number;
        scrollHeight: number;
        viewportWidth: number;
      }>(tab.id!, { type: "GET_PAGE_METRICS" });
      const dpr = shot.width / Math.max(1, metrics.viewportWidth);
      links = await collectCaptureLinks(tab.id!, {
        originX: 0,
        originY: 0,
        widthCss: metrics.scrollWidth,
        heightCss: Math.min(
          metrics.scrollHeight,
          shot.height / Math.max(0.01, dpr)
        ),
        imageWidth: shot.width,
      });
    } catch {
      links = undefined;
    }

    const capture = await storeCapture({
      blob: shot.blob,
      width: shot.width,
      height: shot.height,
      pageTitle: meta.title,
      url: meta.url,
      captureType: "fullpage",
      links,
    });
    void openEditor(undefined, capture.captureId);
    return ok({ capture });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err), "CAPTURE_FAILED");
  }
}

async function rasterizeIfNeeded(
  captureId: string,
  sourceBlob: Blob
): Promise<Blob> {
  const { getEdits } = await import("../storage/indexeddb");
  const ops = await getEdits(captureId);
  if (!ops.length) return sourceBlob;
  const { rasterizeEdits } = await import("../editor/rasterize");
  return rasterizeEdits(sourceBlob, ops);
}

async function copyCapture(
  captureId: string,
  renderedBlob?: Blob
): Promise<void> {
  let blob = renderedBlob;
  if (!blob) {
    const record = await getCapture(captureId);
    if (!record) throw new Error("Capture not found");
    blob = await rasterizeIfNeeded(captureId, record.blob);
  }
  const buffer = await blobToArrayBuffer(blob);
  const type = blob.type.includes("jpeg") ? "jpeg" : "png";
  await browser.clipboard.setImageData(buffer, type);
}

async function saveImage(options: {
  captureId: string;
  format: "png" | "jpeg" | "webp";
  quality: number;
  scale: number;
  filename: string;
  saveAs: boolean;
  renderedBlob?: Blob;
}): Promise<void> {
  let working = options.renderedBlob;
  if (!working) {
    const record = await getCapture(options.captureId);
    if (!record) throw new Error("Capture not found");
    working = await rasterizeIfNeeded(options.captureId, record.blob);
  }

  const scale = options.scale === 100 || options.scale === 1 ? 1 : options.scale / 100;
  // Fast path: PNG at full size — download the rendered blob as-is.
  if (
    options.format === "png" &&
    scale === 1 &&
    (working.type === "image/png" || !working.type)
  ) {
    const url = URL.createObjectURL(working);
    await browser.downloads.download({
      url,
      filename: sanitizeDownloadFilename(options.filename, "png"),
      saveAs: options.saveAs,
    });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const bitmap = await createImageBitmap(working);
  const scaled = scale === 1 ? bitmap : await scaleBitmap(bitmap, scale);
  const encoded = await encodeBlob(scaled, options.format, options.quality);
  bitmap.close();
  if (scaled !== bitmap) scaled.close();

  const url = URL.createObjectURL(encoded);
  await browser.downloads.download({
    url,
    filename: sanitizeDownloadFilename(options.filename, options.format),
    saveAs: options.saveAs,
  });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function addToDocument(
  captureId: string,
  documentId?: string
): Promise<{ documentId: string; title: string; captureCount: number }> {
  const settings = await getSettings();
  let docId = documentId || settings.activeDocumentId;
  let doc = docId ? await getDocument(docId) : undefined;
  if (!doc) {
    doc = await createDocument("Untitled Document");
    docId = doc.id;
    await setSettings({ activeDocumentId: docId });
  }
  const capture = await getCapture(captureId);
  if (!capture) throw new Error("Capture not found");
  capture.documentId = docId!;
  await putCapture(capture);
  if (!doc.pageOrder.includes(captureId)) {
    doc.pageOrder = [...doc.pageOrder, captureId];
  }
  doc.modifiedAt = Date.now();
  await putDocument(doc);
  return {
    documentId: doc.id,
    title: doc.title,
    captureCount: doc.pageOrder.length,
  };
}

async function openEditor(documentId?: string, captureId?: string): Promise<void> {
  const settings = await getSettings();
  const docId = documentId || settings.activeDocumentId || "";
  const params = new URLSearchParams();
  if (docId) params.set("documentId", docId);
  if (captureId) params.set("captureId", captureId);
  const url = browser.runtime.getURL(
    `editor/editor.html${params.toString() ? `?${params}` : ""}`
  );
  // Don't await tab paint — capture response can return immediately.
  void browser.tabs.create({ url });
}

async function saveWebpagePdf(preserveLinks?: boolean): Promise<ResponseMessage> {
  try {
    if (typeof browser.tabs.saveAsPDF !== "function") {
      return fail(
        "Save Webpage as PDF is not available in this Firefox build (unsupported on macOS).",
        "PDF_UNSUPPORTED"
      );
    }
    const settings = await getSettings();
    const keepLinks = preserveLinks ?? settings.preservePdfLinks;
    const tab = await getActiveTab();
    const baseName = buildFilename({
      template: settings.filenameTemplate,
      title: tab.title || "page",
      url: tab.url || "",
      extension: "pdf",
    }).replace(/\.pdf$/i, "");

    // Native Firefox print-to-PDF preserves hyperlinks when the browser
    // preference print.save_as_pdf.links.enabled is true (default in modern FF).
    // Screenshot-document PDFs use embedded link annotations separately.
    const status = await browser.tabs.saveAsPDF({
      toFileName: baseName,
      shrinkToFit: true,
      showBackgroundColors: true,
      showBackgroundImages: true,
      headerLeft: keepLinks ? "" : "&T",
      headerRight: keepLinks ? "" : "&U",
      footerLeft: keepLinks ? "" : "&PT",
      footerRight: keepLinks ? "" : "&D",
    });
    return ok({ status, preserveLinks: keepLinks });
  } catch (err) {
    return fail(
      err instanceof Error
        ? err.message
        : "Save Webpage as PDF failed. This API is not available on macOS.",
      "PDF_FAILED"
    );
  }
}

async function activeDocumentSummary(): Promise<ResponseMessage> {
  const settings = await getSettings();
  if (!settings.activeDocumentId) {
    return ok({ documentId: null, title: null, captureCount: 0 });
  }
  const doc = await getDocument(settings.activeDocumentId);
  if (!doc) {
    return ok({ documentId: null, title: null, captureCount: 0 });
  }
  return ok({
    documentId: doc.id,
    title: doc.title,
    captureCount: doc.pageOrder.length,
  });
}

async function handleMessage(
  message: RequestMessage,
  sender?: browser.runtime.MessageSender,
  internal = false
): Promise<ResponseMessage> {
  try {
    assertMessageShape(message);
    assertSenderAllowed(message.type, sender, { internal });
    switch (message.type) {
      case "PING":
        return ok(true);
      case "CAPTURE_VISIBLE":
        return captureVisible();
      case "START_REGION_CAPTURE":
        return startOverlay("region");
      case "START_ELEMENT_CAPTURE":
        return startOverlay("element");
      case "START_FULLPAGE_CAPTURE":
        return runFullPage(message.includeLazy, message.fixedMode);
      case "CAPTURE_REGION":
        return handleRegionOrElement(message.rect, "region", "capture", "document");
      case "CAPTURE_ELEMENT":
        return handleRegionOrElement(message.rect, "element", "capture", "viewport");
      case "REGION_SELECTED":
        return handleRegionOrElement(
          message.rect,
          "region",
          message.action || "capture",
          message.coordinateSpace || "document"
        );
      case "ELEMENT_SELECTED":
        return handleRegionOrElement(
          message.rect,
          "element",
          message.action || "capture",
          "viewport"
        );
      case "CAPTURE_SCROLLABLE": {
        const tab = await getActiveTab();
        const meta = await tabMeta(tab);
        const shot = await captureScrollableElement({
          tabId: tab.id!,
          windowId: meta.windowId,
          selectorPath: message.selectorPath,
          rect: message.rect,
          scrollWidth: message.scrollWidth,
          scrollHeight: message.scrollHeight,
        });
        const capture = await storeCapture({
          blob: shot.blob,
          width: shot.width,
          height: shot.height,
          pageTitle: meta.title,
          url: meta.url,
          captureType: "scrollable",
        });
        void openEditor(undefined, capture.captureId);
        return ok({ capture });
      }
      case "CAPTURE_IFRAME": {
        const tab = await getActiveTab();
        const meta = await tabMeta(tab);
        if (!message.full) {
          const shot = await captureRegionWithViewportDpr(
            message.frameInfo.boundingRect,
            (await sendToTab<{ viewportWidth: number }>(tab.id!, {
              type: "GET_PAGE_METRICS",
            })).viewportWidth,
            meta.windowId
          );
          const capture = await storeCapture({
            blob: shot.blob,
            width: shot.width,
            height: shot.height,
            pageTitle: meta.title,
            url: meta.url,
            captureType: "iframe",
          });
          void openEditor(undefined, capture.captureId);
          return ok({ capture });
        }
        if (!message.frameInfo.accessible) {
          return fail(
            "Full iframe capture is unavailable for this frame because Firefox does not permit the extension to access its contents. The visible portion can still be captured.",
            "IFRAME_INACCESSIBLE"
          );
        }
        // Same-origin / permitted: treat like scrollable using frame scroll dims
        await injectContent(tab.id!);
        try {
          await browser.scripting.executeScript({
            target: { tabId: tab.id!, allFrames: true },
            files: ["content/content-bridge.js"],
          });
        } catch {
          // some frames may reject
        }
        const safeSrc = message.frameInfo.url.replace(/"/g, '\\"');
        const shot = await captureScrollableElement({
          tabId: tab.id!,
          windowId: meta.windowId,
          selectorPath: `iframe[src="${safeSrc}"]`,
          rect: message.frameInfo.boundingRect,
          scrollWidth: message.frameInfo.scrollWidth,
          scrollHeight: message.frameInfo.scrollHeight,
        }).catch(async () => {
          // Fallback: visible iframe crop
          return captureRegionWithViewportDpr(
            message.frameInfo.boundingRect,
            message.frameInfo.viewportWidth || message.frameInfo.boundingRect.width,
            meta.windowId
          );
        });
        const capture = await storeCapture({
          blob: shot.blob,
          width: shot.width,
          height: shot.height,
          pageTitle: meta.title,
          url: meta.url,
          captureType: "iframe",
        });
        void openEditor(undefined, capture.captureId);
        return ok({ capture });
      }
      case "CANCEL_CAPTURE": {
        const tab = await getActiveTab();
        if (tab.id) {
          await sendToTab(tab.id, { type: "HIDE_OVERLAY" }).catch(() => undefined);
          await sendToTab(tab.id, { type: "RESTORE_PAGE_STATE" }).catch(
            () => undefined
          );
        }
        return ok(true);
      }
      case "COPY_IMAGE":
        await copyCapture(message.captureId, message.renderedBlob);
        return ok(true);
      case "SAVE_IMAGE":
        await saveImage(message.options);
        return ok(true);
      case "ADD_TO_DOCUMENT":
        return ok(await addToDocument(message.captureId, message.documentId));
      case "OPEN_EDITOR":
        void openEditor(message.documentId, message.captureId);
        return ok(true);
      case "SAVE_WEBPAGE_PDF":
        return saveWebpagePdf(message.preserveLinks);
      case "EXPORT_PDF": {
        const { exportDocumentPdf } = await import("../document/pdf-export");
        const bytes = await exportDocumentPdf(message.options.documentId);
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        const blob = new Blob([copy], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        await browser.downloads.download({
          url,
          filename: sanitizeDownloadFilename(message.options.filename, "pdf"),
          saveAs: message.options.saveAs,
        });
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return ok(true);
      }
      case "GET_SETTINGS":
        return ok({ settings: await getSettings() });
      case "SET_SETTINGS": {
        const patch = sanitizeSettingsPatch(
          message.settings as unknown as Record<string, unknown>
        );
        return ok({
          settings: await setSettings(patch as Parameters<typeof setSettings>[0]),
        });
      }
      case "GET_DOCUMENTS":
        return ok({ documents: await listDocuments() });
      case "GET_DOCUMENT":
        return ok({ document: await getDocument(message.documentId) });
      case "CREATE_DOCUMENT": {
        const doc = await createDocument(message.title);
        await setSettings({ activeDocumentId: doc.id });
        return ok({ document: doc });
      }
      case "RENAME_DOCUMENT": {
        const doc = await getDocument(message.documentId);
        if (!doc) return fail("Document not found");
        doc.title = message.title;
        doc.modifiedAt = Date.now();
        await putDocument(doc);
        return ok({ document: doc });
      }
      case "DELETE_DOCUMENT":
        await deleteDocument(message.documentId);
        return ok(true);
      case "REORDER_DOCUMENT_PAGES": {
        const doc = await getDocument(message.documentId);
        if (!doc) return fail("Document not found");
        doc.pageOrder = message.pageOrder;
        doc.modifiedAt = Date.now();
        await putDocument(doc);
        return ok({ document: doc });
      }
      case "UPDATE_DOCUMENT": {
        message.document.modifiedAt = Date.now();
        await putDocument(message.document);
        return ok({ document: message.document });
      }
      case "GET_CAPTURE": {
        const c = await getCapture(message.captureId);
        if (!c) return fail("Capture not found");
        const { blob, ...meta } = c;
        return ok({
          capture: meta,
          previewDataUrl: await blobToDataUrl(blob),
        });
      }
      case "GET_CAPTURE_BLOB": {
        const c = await getCapture(message.captureId);
        if (!c) return fail("Capture not found");
        return ok({
          dataUrl: await blobToDataUrl(c.blob),
          width: c.width,
          height: c.height,
          mimeType: c.mimeType,
        });
      }
      case "DELETE_CAPTURE": {
        const capture = await getCapture(message.captureId);
        if (capture?.documentId) {
          const doc = await getDocument(capture.documentId);
          if (doc) {
            doc.pageOrder = doc.pageOrder.filter((id) => id !== message.captureId);
            doc.modifiedAt = Date.now();
            await putDocument(doc);
          }
        } else {
          // Also scrub orphaned references from all documents
          const docs = await listDocuments();
          for (const d of docs) {
            if (!d.pageOrder.includes(message.captureId)) continue;
            d.pageOrder = d.pageOrder.filter((id) => id !== message.captureId);
            d.modifiedAt = Date.now();
            await putDocument(d);
          }
        }
        await deleteCapture(message.captureId);
        return ok(true);
      }
      case "GET_ACTIVE_DOCUMENT_SUMMARY":
        return activeDocumentSummary();
      case "STORE_CAPTURE_TEMP": {
        const blob = dataUrlToBlob(message.dataUrl);
        const capture = await storeCapture({
          blob,
          width: message.meta.width,
          height: message.meta.height,
          pageTitle: message.meta.pageTitle,
          url: message.meta.url,
          captureType: message.meta.captureType,
        });
        return ok({ capture });
      }
      case "OVERLAY_CANCELLED":
        return ok(true);
      case "DEBUG_LOG":
        await debugLog(message.message, message.data);
        return ok(true);
      default:
        return fail(`Unhandled message: ${(message as { type: string }).type}`);
    }
  } catch (err) {
    console.error("[22Shot]", err);
    return fail(err instanceof Error ? err.message : String(err));
  }
}

browser.runtime.onInstalled.addListener(() => {
  installContextMenus();
});

browser.runtime.onStartup.addListener(() => {
  installContextMenus();
});

installContextMenus();

browser.runtime.onMessage.addListener(
  (message: RequestMessage, sender: browser.runtime.MessageSender) => {
    // Always return a Promise so Firefox keeps the event page alive for async work.
    return Promise.resolve()
      .then(() => handleMessage(message, sender, false))
      .catch((err) =>
        fail(err instanceof Error ? err.message : String(err), "HANDLER_CRASH")
      );
  }
);

browser.menus.onClicked.addListener(async (info, tab) => {
  try {
    switch (info.menuItemId) {
      case "ps-visible":
        await handleMessage({ type: "CAPTURE_VISIBLE" }, undefined, true);
        break;
      case "ps-region":
        await handleMessage({ type: "START_REGION_CAPTURE" }, undefined, true);
        break;
      case "ps-element":
        await handleMessage({ type: "START_ELEMENT_CAPTURE" }, undefined, true);
        break;
      case "ps-fullpage":
        await handleMessage({ type: "START_FULLPAGE_CAPTURE" }, undefined, true);
        break;
      case "ps-pdf":
        await handleMessage({ type: "SAVE_WEBPAGE_PDF" }, undefined, true);
        break;
      case "ps-workspace":
        await openEditor();
        break;
      default:
        break;
    }
  } catch (err) {
    console.error("[22Shot] menu action failed", err);
  }
  void tab;
});

// Warm storage + settings so first popup/capture skips cold reads.
void createId;
void loadImage;
void buildFilename;
void getSettings();
