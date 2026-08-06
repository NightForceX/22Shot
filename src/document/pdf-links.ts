import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFPage,
  PDFString,
} from "pdf-lib";
import type { CaptureLink } from "../shared/types";
import { isSafeHref } from "../shared/safe-url";

export function addUriLink(
  pdf: PDFDocument,
  page: PDFPage,
  uri: string,
  rect: { x1: number; y1: number; x2: number; y2: number }
): void {
  if (!isSafeHref(uri)) return;
  const linkRef = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [rect.x1, rect.y1, rect.x2, rect.y2],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(uri),
      },
    })
  );

  const existing = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (existing) {
    existing.push(linkRef);
  } else {
    page.node.set(PDFName.of("Annots"), pdf.context.obj([linkRef]));
  }
}

/**
 * Map image-pixel link boxes onto a drawn image rectangle on a PDF page.
 * PDF y grows upward; image y grows downward.
 */
export function placeCaptureLinksOnPage(options: {
  pdf: PDFDocument;
  page: PDFPage;
  links: CaptureLink[] | undefined;
  imageWidthPx: number;
  imageHeightPx: number;
  /** Source crop in image pixels (for multi-page splits) */
  srcY?: number;
  srcH?: number;
  drawX: number;
  drawY: number;
  drawW: number;
  drawH: number;
}): void {
  const links = options.links;
  if (!links?.length) return;

  const srcY = options.srcY ?? 0;
  const srcH = options.srcH ?? options.imageHeightPx;
  const srcBottom = srcY + srcH;
  const scaleX = options.drawW / options.imageWidthPx;
  const scaleY = options.drawH / srcH;

  for (const link of links) {
    const linkBottom = link.y + link.height;
    if (linkBottom <= srcY || link.y >= srcBottom) continue;

    const clippedTop = Math.max(link.y, srcY);
    const clippedBottom = Math.min(linkBottom, srcBottom);
    const relTop = clippedTop - srcY;
    const relHeight = clippedBottom - clippedTop;
    if (relHeight < 1 || link.width < 1) continue;

    const x1 = options.drawX + link.x * scaleX;
    const x2 = options.drawX + (link.x + link.width) * scaleX;
    // PDF coords: drawY is bottom of image
    const y2 = options.drawY + options.drawH - relTop * scaleY;
    const y1 = y2 - relHeight * scaleY;

    try {
      addUriLink(options.pdf, options.page, link.href, { x1, y1, x2, y2 });
    } catch {
      // ignore malformed URIs
    }
  }
}
