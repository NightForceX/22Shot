import {
  MARGIN_PRESETS,
  PAGE_SIZES,
  type MarginPreset,
  type PageSizeKey,
} from "../shared/constants";
import type { DocumentRecord } from "../shared/types";

const PT_PER_IN = 72;

export interface PageBox {
  widthPt: number;
  heightPt: number;
  marginPt: number;
  contentWidthPt: number;
  contentHeightPt: number;
}

export function resolvePageBox(doc: DocumentRecord, imageWidthPx: number, imageHeightPx: number): PageBox {
  let widthIn: number;
  let heightIn: number;

  if (doc.pageSize === "image") {
    // Treat 96 CSS px per inch for "image size" pages
    widthIn = imageWidthPx / 96;
    heightIn = imageHeightPx / 96;
  } else if (doc.pageSize === "automatic") {
    const aspect = imageWidthPx / Math.max(1, imageHeightPx);
    widthIn = PAGE_SIZES.letter.widthIn;
    heightIn = widthIn / aspect;
    if (heightIn > 20) {
      heightIn = 11;
      widthIn = heightIn * aspect;
    }
  } else {
    const size = PAGE_SIZES[doc.pageSize as keyof typeof PAGE_SIZES];
    widthIn = size.widthIn;
    heightIn = size.heightIn;
  }

  if (doc.orientation === "landscape" || (doc.orientation === "auto" && imageWidthPx > imageHeightPx)) {
    if (widthIn < heightIn) {
      const t = widthIn;
      widthIn = heightIn;
      heightIn = t;
    }
  } else if (doc.orientation === "portrait") {
    if (widthIn > heightIn && doc.pageSize !== "image" && doc.pageSize !== "automatic") {
      const t = widthIn;
      widthIn = heightIn;
      heightIn = t;
    }
  }

  const marginIn =
    doc.margins === "custom"
      ? doc.customMarginIn ?? 0.5
      : MARGIN_PRESETS[doc.margins as Exclude<MarginPreset, "custom">] ?? 0.5;

  const widthPt = widthIn * PT_PER_IN;
  const heightPt = heightIn * PT_PER_IN;
  const marginPt = marginIn * PT_PER_IN;
  return {
    widthPt,
    heightPt,
    marginPt,
    contentWidthPt: Math.max(1, widthPt - marginPt * 2),
    contentHeightPt: Math.max(1, heightPt - marginPt * 2),
  };
}

export function fitImageRect(
  doc: DocumentRecord,
  page: PageBox,
  imageWidthPx: number,
  imageHeightPx: number
): { widthPt: number; heightPt: number; x: number; y: number; scale: number } {
  const pxToPt = 72 / 96;
  const naturalW = imageWidthPx * pxToPt;
  const naturalH = imageHeightPx * pxToPt;
  let scale = 1;

  switch (doc.imageFit) {
    case "actual":
      scale = 1;
      break;
    case "fit-width":
      scale = page.contentWidthPt / naturalW;
      break;
    case "fit-height":
      scale = page.contentHeightPt / naturalH;
      break;
    case "fit-page":
    default:
      scale = Math.min(
        page.contentWidthPt / naturalW,
        page.contentHeightPt / naturalH
      );
      break;
  }

  const widthPt = naturalW * scale;
  const heightPt = naturalH * scale;
  const x = page.marginPt + (page.contentWidthPt - widthPt) / 2;
  const y =
    doc.imageAlign === "center"
      ? page.marginPt + (page.contentHeightPt - heightPt) / 2
      : page.marginPt;

  return { widthPt, heightPt, x, y, scale };
}

export function splitLongImagePages(
  imageHeightPt: number,
  contentHeightPt: number
): number[] {
  // Returns y offsets (in image pt space) for each page start
  if (imageHeightPt <= contentHeightPt) return [0];
  const offsets: number[] = [];
  let y = 0;
  while (y < imageHeightPt - 0.5) {
    offsets.push(y);
    y += contentHeightPt;
  }
  return offsets;
}

export function suggestBreaks(
  imageHeightPx: number,
  pageContentHeightPx: number
): number[] {
  // Prefer breaks near whitespace; without pixel analysis, use even splits
  // with slight upward bias for last 5% of each page.
  if (imageHeightPx <= pageContentHeightPx) return [];
  const breaks: number[] = [];
  let y = pageContentHeightPx;
  while (y < imageHeightPx) {
    breaks.push(Math.round(y - pageContentHeightPx * 0.02));
    y += pageContentHeightPx;
  }
  return breaks;
}

export type { PageSizeKey };
