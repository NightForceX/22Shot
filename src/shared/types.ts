import type { FixedElementMode, MarginPreset, PageSizeKey } from "./constants";

export type CaptureType =
  | "visible"
  | "region"
  | "element"
  | "fullpage"
  | "scrollable"
  | "iframe";

/** Clickable link hotspots in capture image pixel coordinates. */
export interface CaptureLink {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureMeta {
  id: string;
  documentId: string | null;
  width: number;
  height: number;
  mimeType: string;
  pageTitle: string;
  url: string;
  createdAt: number;
  captureType: CaptureType;
  filenameBase: string;
  links?: CaptureLink[];
}

export interface CaptureResult {
  captureId: string;
  width: number;
  height: number;
  mimeType: string;
  pageTitle: string;
  url: string;
  filenameBase: string;
  /** Object URL usable only in the receiving extension page context when transferred as blob elsewhere */
  previewDataUrl?: string;
}

export interface RegionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageMetrics {
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  devicePixelRatio: number;
  zoom: number;
}

export interface DocumentRecord {
  id: string;
  title: string;
  pageOrder: string[];
  createdAt: number;
  modifiedAt: number;
  pageSize: PageSizeKey;
  orientation: "portrait" | "landscape" | "auto";
  margins: MarginPreset;
  customMarginIn?: number;
  imageFit: "fit-page" | "fit-width" | "fit-height" | "actual";
  imageAlign: "center" | "top";
}

export type EditOp =
  | { type: "blur"; x: number; y: number; width: number; height: number; strength: number }
  | { type: "pixelate"; x: number; y: number; width: number; height: number; blockSize: number }
  | {
      type: "redact";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      opacity?: number;
      style?: "solid" | "hatch" | "outline";
      cornerRadius?: number;
    }
  | { type: "crop"; x: number; y: number; width: number; height: number }
  | {
      type: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      stroke: string;
      lineWidth: number;
      fill?: string;
    }
  | {
      type: "arrow";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      lineWidth: number;
      /** Which ends get arrowheads. Default "end" (tip at drag end). */
      heads?: "end" | "start" | "both";
      /** Head size multiplier (default 1). */
      headSize?: number;
      /** Filled head vs outline. Default true. */
      filled?: boolean;
    }
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: string;
      lineWidth: number;
    }
  | {
      type: "text";
      x: number;
      y: number;
      text: string;
      color: string;
      fontSize: number;
      fontFamily: string;
    }
  | {
      type: "highlighter";
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      opacity?: number;
    }
  | {
      type: "freehand";
      points: Array<{ x: number; y: number }>;
      stroke: string;
      lineWidth: number;
    };

export interface Settings {
  filenameTemplate: string;
  jpgQuality: number;
  webpQuality: number;
  webpLossless: boolean;
  fixedElementMode: FixedElementMode;
  includeLazyContent: boolean;
  maxCaptureHeightCss: number;
  debugMode: boolean;
  defaultPageSize: PageSizeKey;
  defaultOrientation: "portrait" | "landscape" | "auto";
  defaultMargins: MarginPreset;
  saveAsDialog: boolean;
  activeDocumentId: string | null;
  /** Native webpage PDF and screenshot-PDF link annotations */
  preservePdfLinks: boolean;
}

export interface ExportImageOptions {
  captureId: string;
  format: "png" | "jpeg" | "webp";
  quality: number;
  scale: number;
  filename: string;
  saveAs: boolean;
  includeMetadata: boolean;
  /**
   * Optional already-rasterized preview (includes edits).
   * When set, save skips re-reading/re-rasterizing from IndexedDB.
   */
  renderedBlob?: Blob;
}

export interface PdfExportOptions {
  documentId: string;
  filename: string;
  saveAs: boolean;
  mode: "screenshot-document";
}

export interface FrameInfo {
  frameId: number;
  parentFrameId: number;
  url: string;
  sameOrigin: boolean;
  accessible: boolean;
  boundingRect: RegionRect;
  scrollWidth: number;
  scrollHeight: number;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
}

export interface ScrollableElementInfo {
  selectorPath: string;
  tagName: string;
  boundingRect: RegionRect;
  scrollWidth: number;
  scrollHeight: number;
  clientWidth: number;
  clientHeight: number;
  overflowX: string;
  overflowY: string;
}
