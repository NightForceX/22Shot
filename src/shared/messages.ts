import type {
  CaptureResult,
  CaptureType,
  DocumentRecord,
  EditOp,
  ExportImageOptions,
  FrameInfo,
  PageMetrics,
  PdfExportOptions,
  RegionRect,
  ScrollableElementInfo,
  Settings,
} from "./types";
import type { FixedElementMode } from "./constants";

export type RequestMessage =
  | { type: "CAPTURE_VISIBLE" }
  | { type: "START_REGION_CAPTURE" }
  | { type: "START_ELEMENT_CAPTURE" }
  | {
      type: "START_FULLPAGE_CAPTURE";
      includeLazy?: boolean;
      fixedMode?: FixedElementMode;
    }
  | { type: "CAPTURE_REGION"; rect: RegionRect }
  | { type: "CAPTURE_ELEMENT"; rect: RegionRect }
  | {
      type: "CAPTURE_SCROLLABLE";
      rect: RegionRect;
      scrollWidth: number;
      scrollHeight: number;
      selectorPath: string;
    }
  | { type: "CAPTURE_IFRAME"; frameInfo: FrameInfo; full: boolean }
  | { type: "CANCEL_CAPTURE" }
  | { type: "SAVE_IMAGE"; options: ExportImageOptions }
  | { type: "COPY_IMAGE"; captureId: string; renderedBlob?: Blob }
  | { type: "ADD_TO_DOCUMENT"; captureId: string; documentId?: string }
  | { type: "OPEN_EDITOR"; documentId?: string; captureId?: string }
  | { type: "SAVE_WEBPAGE_PDF"; preserveLinks?: boolean }
  | { type: "EXPORT_PDF"; options: PdfExportOptions }
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; settings: Partial<Settings> }
  | { type: "GET_DOCUMENTS" }
  | { type: "GET_DOCUMENT"; documentId: string }
  | { type: "CREATE_DOCUMENT"; title: string }
  | { type: "RENAME_DOCUMENT"; documentId: string; title: string }
  | { type: "DELETE_DOCUMENT"; documentId: string }
  | { type: "REORDER_DOCUMENT_PAGES"; documentId: string; pageOrder: string[] }
  | { type: "UPDATE_DOCUMENT"; document: import("./types").DocumentRecord }
  | { type: "GET_CAPTURE"; captureId: string }
  | { type: "GET_CAPTURE_BLOB"; captureId: string }
  | { type: "DELETE_CAPTURE"; captureId: string }
  | { type: "GET_ACTIVE_DOCUMENT_SUMMARY" }
  | { type: "STORE_CAPTURE_TEMP"; dataUrl: string; meta: Omit<CaptureResult, "captureId" | "previewDataUrl"> & { captureType: CaptureType } }
  | { type: "PING" }
  // Content → background
  | { type: "CONTENT_READY" }
  | {
      type: "REGION_SELECTED";
      rect: RegionRect;
      action?: string;
      coordinateSpace?: "viewport" | "document";
    }
  | { type: "ELEMENT_SELECTED"; rect: RegionRect; tagName: string; action?: string }
  | { type: "OVERLAY_CANCELLED" }
  | { type: "PAGE_METRICS"; metrics: PageMetrics }
  | { type: "SCROLLABLE_FOUND"; elements: ScrollableElementInfo[] }
  | { type: "CAPTURE_PROGRESS"; current: number; total: number; message: string }
  | { type: "DEBUG_LOG"; message: string; data?: unknown };

export type ResponseMessage =
  | { ok: true; data?: unknown }
  | { ok: false; error: string; code?: string };

export interface CaptureVisibleResponse {
  capture: CaptureResult;
}

export interface SettingsResponse {
  settings: Settings;
}

export interface DocumentsResponse {
  documents: DocumentRecord[];
}

export interface ActiveDocumentSummary {
  documentId: string | null;
  title: string | null;
  captureCount: number;
}

export async function sendMessage<T = unknown>(
  message: RequestMessage
): Promise<T> {
  if (typeof browser === "undefined" || !browser.runtime?.sendMessage) {
    throw new Error(
      "Extension API unavailable. Load dist/manifest.json via about:debugging."
    );
  }
  let response: ResponseMessage;
  try {
    response = (await browser.runtime.sendMessage(
      message
    )) as ResponseMessage;
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `Background error: ${err.message}`
        : "Background script did not respond. Reload the temporary add-on."
    );
  }
  if (!response || typeof response !== "object") {
    throw new Error(
      "No response from background. Reload the temporary add-on from dist/manifest.json."
    );
  }
  if (!response.ok) {
    throw new Error(response.error || "Unknown error");
  }
  return response.data as T;
}

export function ok<T>(data?: T): ResponseMessage {
  return { ok: true, data };
}

export function fail(error: string, code?: string): ResponseMessage {
  return { ok: false, error, code };
}

export type ContentCommand =
  | { type: "SHOW_REGION_OVERLAY" }
  | { type: "SHOW_ELEMENT_OVERLAY" }
  | { type: "HIDE_OVERLAY" }
  | { type: "GET_PAGE_METRICS" }
  | {
      type: "SCROLL_TO";
      x: number;
      y: number;
      waitForStable?: boolean;
    }
  | {
      type: "PREPARE_FULLPAGE";
      fixedMode: FixedElementMode;
      hideStickyAfterFirst: boolean;
    }
  | { type: "RESTORE_PAGE_STATE" }
  | { type: "FIND_SCROLLABLES" }
  | {
      type: "SCROLL_ELEMENT";
      selectorPath: string;
      left: number;
      top: number;
    }
  | {
      type: "GET_ELEMENT_RECT";
      selectorPath: string;
    }
  | { type: "DETECT_LAZY_GROWTH" }
  | { type: "LIST_IFRAMES" }
  | {
      type: "COLLECT_PAGE_LINKS";
      clip?: { x: number; y: number; width: number; height: number };
    };

export async function sendToTab<T = unknown>(
  tabId: number,
  message: ContentCommand,
  options?: { frameId?: number }
): Promise<T> {
  const response = (await browser.tabs.sendMessage(
    tabId,
    message,
    options?.frameId !== undefined ? { frameId: options.frameId } : undefined
  )) as ResponseMessage;
  if (!response?.ok) {
    throw new Error(
      (response && "error" in response && response.error) ||
        "Content script error"
    );
  }
  return response.data as T;
}
