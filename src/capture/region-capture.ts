import { cropBlob } from "./image-utils";
import { captureVisibleTabPng } from "./visible-capture";
import type { RegionRect } from "../shared/types";
import { sendToTab } from "../shared/messages";
import { computeScrollStops, stitchVertical, type StitchSegment } from "./stitcher";
import { debugLogSync } from "../shared/debug";
import type { PageMetrics } from "../shared/types";

export async function captureRegion(
  rect: RegionRect,
  windowId?: number,
  dpr = 1
): Promise<{ blob: Blob; width: number; height: number }> {
  const visible = await captureVisibleTabPng(windowId);
  return cropBlob(visible.blob, rect, dpr || 1);
}

export async function captureRegionWithViewportDpr(
  rect: RegionRect,
  viewportCssWidth: number,
  windowId?: number
): Promise<{ blob: Blob; width: number; height: number }> {
  const visible = await captureVisibleTabPng(windowId);
  const dpr = visible.width / Math.max(1, viewportCssWidth);
  return cropBlob(visible.blob, rect, dpr);
}

/**
 * Capture a rectangle in document coordinates. Scrolls and stitches when the
 * selection is taller/wider than the viewport (edge-scroll region select).
 */
export async function captureDocumentRegion(options: {
  tabId: number;
  windowId?: number;
  rect: RegionRect;
}): Promise<{ blob: Blob; width: number; height: number }> {
  const { tabId, windowId, rect } = options;
  const metrics = await sendToTab<PageMetrics>(tabId, {
    type: "GET_PAGE_METRICS",
  });

  const sel: RegionRect = {
    x: Math.max(0, Math.round(rect.x)),
    y: Math.max(0, Math.round(rect.y)),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height)),
  };

  // Fast path: selection fits entirely in the current viewport
  const inView =
    sel.x >= metrics.scrollX &&
    sel.y >= metrics.scrollY &&
    sel.x + sel.width <= metrics.scrollX + metrics.viewportWidth + 1 &&
    sel.y + sel.height <= metrics.scrollY + metrics.viewportHeight + 1;

  if (inView) {
    await sendToTab(tabId, { type: "HIDE_OVERLAY" }).catch(() => undefined);
    const viewRect = {
      x: sel.x - metrics.scrollX,
      y: sel.y - metrics.scrollY,
      width: sel.width,
      height: sel.height,
    };
    return captureRegionWithViewportDpr(
      viewRect,
      metrics.viewportWidth,
      windowId
    );
  }

  debugLogSync("Document region capture (stitched)", sel);
  await sendToTab(tabId, {
    type: "PREPARE_FULLPAGE",
    fixedMode: "auto",
    hideStickyAfterFirst: false,
  }).catch(() => undefined);

  try {
    const maxScrollX = Math.max(0, metrics.scrollWidth - metrics.viewportWidth);
    const maxScrollY = Math.max(0, metrics.scrollHeight - metrics.viewportHeight);
    const xStops = scrollStopsForRange(
      sel.x,
      sel.x + sel.width,
      metrics.viewportWidth,
      maxScrollX
    );
    const yStops = scrollStopsForRange(
      sel.y,
      sel.y + sel.height,
      metrics.viewportHeight,
      maxScrollY
    );

    const segments: StitchSegment[] = [];
    let dpr = metrics.devicePixelRatio;

    for (let row = 0; row < yStops.length; row++) {
      for (let col = 0; col < xStops.length; col++) {
        const scrollX = xStops[col];
        const scrollY = yStops[row];
        await sendToTab(tabId, {
          type: "SCROLL_TO",
          x: scrollX,
          y: scrollY,
          waitForStable: true,
        });

        if (row > 0 || col > 0) {
          await sendToTab(tabId, {
            type: "PREPARE_FULLPAGE",
            fixedMode: "auto",
            hideStickyAfterFirst: true,
          }).catch(() => undefined);
        }

        const shot = await captureVisibleTabPng(windowId);
        if (row === 0 && col === 0) {
          dpr = shot.width / Math.max(1, metrics.viewportWidth);
        }

        const ix = Math.max(sel.x, scrollX);
        const iy = Math.max(sel.y, scrollY);
        const ir = Math.min(sel.x + sel.width, scrollX + metrics.viewportWidth);
        const ib = Math.min(sel.y + sel.height, scrollY + metrics.viewportHeight);
        const iw = ir - ix;
        const ih = ib - iy;
        if (iw < 1 || ih < 1) continue;

        const cropped = await cropBlob(
          shot.blob,
          {
            x: ix - scrollX,
            y: iy - scrollY,
            width: iw,
            height: ih,
          },
          dpr
        );

        segments.push({
          blob: cropped.blob,
          destX: Math.round((ix - sel.x) * dpr),
          destY: Math.round((iy - sel.y) * dpr),
          srcW: cropped.width,
          srcH: cropped.height,
        });
      }
    }

    if (!segments.length) {
      throw new Error("Could not capture the selected region");
    }

    const totalWidth = Math.round(sel.width * dpr);
    const totalHeight = Math.round(sel.height * dpr);
    return stitchVertical(segments, totalWidth, totalHeight);
  } finally {
    await sendToTab(tabId, { type: "RESTORE_PAGE_STATE" }).catch(() => undefined);
  }
}

function scrollStopsForRange(
  rangeStart: number,
  rangeEnd: number,
  viewportSize: number,
  maxScroll: number
): number[] {
  if (rangeEnd - rangeStart <= viewportSize + 1) {
    return [Math.max(0, Math.min(maxScroll, rangeStart))];
  }
  // Fake a "page" that is just this range, then offset stops into document space
  const local = computeScrollStops(rangeEnd - rangeStart, viewportSize);
  const stops = local.map((s) =>
    Math.max(0, Math.min(maxScroll, Math.round(rangeStart + s)))
  );
  // Deduplicate
  return stops.filter((v, i, arr) => i === 0 || Math.abs(v - arr[i - 1]) > 1);
}
