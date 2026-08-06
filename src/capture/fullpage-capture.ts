import type { FixedElementMode } from "../shared/constants";
import { MAX_CAPTURE_HEIGHT_CSS, LAZY_STABLE_CHECKS } from "../shared/constants";
import { debugLog } from "../shared/debug";
import { sendToTab } from "../shared/messages";
import type { PageMetrics } from "../shared/types";
import { cropBlob } from "./image-utils";
import { computeScrollStops, stitchVertical, type StitchSegment } from "./stitcher";
import { planTiles } from "./tile-manager";
import { captureVisibleTabPng } from "./visible-capture";

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type: "PING_CONTENT" });
  } catch {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["content/content-bridge.js"],
    });
  }
}

export interface FullPageCaptureOptions {
  tabId: number;
  windowId?: number;
  includeLazy?: boolean;
  fixedMode?: FixedElementMode;
  maxHeightCss?: number;
  onProgress?: (current: number, total: number, message: string) => void;
}

export async function captureFullPage(options: FullPageCaptureOptions): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  const {
    tabId,
    windowId,
    includeLazy = false,
    fixedMode = "auto",
    maxHeightCss = MAX_CAPTURE_HEIGHT_CSS,
    onProgress,
  } = options;

  await ensureContentScript(tabId);
  const started = performance.now();

  try {
    await sendToTab(tabId, {
      type: "PREPARE_FULLPAGE",
      fixedMode,
      // Auto: keep fixed/sticky on the first segment, hide afterward.
      hideStickyAfterFirst: fixedMode === "hide",
    });

    let metrics = await sendToTab<PageMetrics>(tabId, {
      type: "GET_PAGE_METRICS",
    });
    await debugLog("Viewport", {
      w: metrics.viewportWidth,
      h: metrics.viewportHeight,
      dpr: metrics.devicePixelRatio,
    });
    await debugLog("Page dimensions", {
      w: metrics.scrollWidth,
      h: metrics.scrollHeight,
    });

    if (includeLazy) {
      metrics = await growLazyContent(tabId, metrics, maxHeightCss, onProgress);
    }

    const plan = planTiles({
      scrollWidth: metrics.scrollWidth,
      scrollHeight: metrics.scrollHeight,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight,
      devicePixelRatio: metrics.devicePixelRatio,
      maxHeightCss,
    });

    if (plan.tooLarge) {
      throw new Error(
        `${plan.reason || "Page is too large for a single bitmap."} Estimated ${Math.round(plan.bytes / (1024 * 1024))} MB. Options: export as multi-page PDF, split into multiple PNG files, reduce resolution, or capture in sections.`
      );
    }

    const xStops = plan.xStops;
    const yStops = plan.yStops;
    const total = xStops.length * yStops.length;
    await debugLog("Segments required", { total, xStops, yStops });

    const segments: StitchSegment[] = [];
    let firstCaptureDone = false;
    let measuredDpr = metrics.devicePixelRatio;

    for (let row = 0; row < yStops.length; row++) {
      for (let col = 0; col < xStops.length; col++) {
        const x = xStops[col];
        const y = yStops[row];
        const index = row * xStops.length + col + 1;
        onProgress?.(index, total, `Capturing segment ${index}/${total}`);
        await debugLog(`Segment ${index}/${total}`, { x, y });

        await sendToTab(tabId, {
          type: "SCROLL_TO",
          x,
          y,
          waitForStable: true,
        });

        if (firstCaptureDone && (fixedMode === "auto" || fixedMode === "hide")) {
          await sendToTab(tabId, {
            type: "PREPARE_FULLPAGE",
            fixedMode,
            hideStickyAfterFirst: true,
          });
        }

        const shot = await captureVisibleTabPng(windowId);
        if (!firstCaptureDone) {
          measuredDpr = shot.width / Math.max(1, metrics.viewportWidth);
          firstCaptureDone = true;
        }

        const remainingX = plan.totalWidthCss - x;
        const remainingY = plan.totalHeightCss - y;
        const cropW = Math.min(metrics.viewportWidth, remainingX);
        const cropH = Math.min(metrics.viewportHeight, remainingY);

        const cropped = await cropBlob(
          shot.blob,
          { x: 0, y: 0, width: cropW, height: cropH },
          measuredDpr
        );

        segments.push({
          blob: cropped.blob,
          destX: Math.round(x * measuredDpr),
          destY: Math.round(y * measuredDpr),
          srcX: 0,
          srcY: 0,
          srcW: cropped.width,
          srcH: cropped.height,
        });
      }
    }

    const totalWidth = Math.round(plan.totalWidthCss * measuredDpr);
    const totalHeight = Math.round(plan.totalHeightCss * measuredDpr);
    onProgress?.(total, total, "Stitching…");
    const result = await stitchVertical(segments, totalWidth, totalHeight);
    await debugLog("Full page complete", {
      result: `${result.width}x${result.height}`,
      durationMs: Math.round(performance.now() - started),
    });
    return result;
  } finally {
    try {
      await sendToTab(tabId, { type: "RESTORE_PAGE_STATE" });
    } catch {
      // best effort
    }
  }
}

async function growLazyContent(
  tabId: number,
  initial: PageMetrics,
  maxHeightCss: number,
  onProgress?: (current: number, total: number, message: string) => void
): Promise<PageMetrics> {
  let metrics = initial;
  let stable = 0;
  let lastHeight = metrics.scrollHeight;
  let guard = 0;
  const yStopsSeed = computeScrollStops(
    Math.min(metrics.scrollHeight, maxHeightCss),
    metrics.viewportHeight
  );

  for (const y of yStopsSeed) {
    guard++;
    if (guard > 500) break;
    onProgress?.(guard, yStopsSeed.length, "Loading lazy content…");
    await sendToTab(tabId, { type: "SCROLL_TO", x: 0, y, waitForStable: true });
    metrics = await sendToTab<PageMetrics>(tabId, { type: "GET_PAGE_METRICS" });
    if (metrics.scrollHeight >= maxHeightCss) {
      metrics = { ...metrics, scrollHeight: maxHeightCss };
      break;
    }
    if (Math.abs(metrics.scrollHeight - lastHeight) < 2) {
      stable++;
      if (stable >= LAZY_STABLE_CHECKS) break;
    } else {
      stable = 0;
      lastHeight = metrics.scrollHeight;
    }
  }

  // Final pass: continue while height grows
  stable = 0;
  while (stable < LAZY_STABLE_CHECKS && metrics.scrollHeight < maxHeightCss) {
    guard++;
    if (guard > 800) break;
    const target = Math.max(0, metrics.scrollHeight - metrics.viewportHeight);
    await sendToTab(tabId, {
      type: "SCROLL_TO",
      x: 0,
      y: target,
      waitForStable: true,
    });
    const next = await sendToTab<PageMetrics>(tabId, { type: "GET_PAGE_METRICS" });
    if (Math.abs(next.scrollHeight - metrics.scrollHeight) < 2) {
      stable++;
    } else {
      stable = 0;
    }
    metrics = next;
  }
  return metrics;
}

export async function captureScrollableElement(options: {
  tabId: number;
  windowId?: number;
  selectorPath: string;
  rect: { x: number; y: number; width: number; height: number };
  scrollWidth: number;
  scrollHeight: number;
  onProgress?: (current: number, total: number, message: string) => void;
}): Promise<{ blob: Blob; width: number; height: number }> {
  const { tabId, windowId, selectorPath, rect, scrollWidth, scrollHeight, onProgress } =
    options;
  await ensureContentScript(tabId);

  const originalMetrics = await sendToTab<PageMetrics>(tabId, {
    type: "GET_PAGE_METRICS",
  });

  try {
    const xStops = computeScrollStops(scrollWidth, rect.width);
    const yStops = computeScrollStops(scrollHeight, rect.height);
    const total = xStops.length * yStops.length;
    const segments: StitchSegment[] = [];
    let dpr = originalMetrics.devicePixelRatio;

    for (let row = 0; row < yStops.length; row++) {
      for (let col = 0; col < xStops.length; col++) {
        const left = xStops[col];
        const top = yStops[row];
        const index = row * xStops.length + col + 1;
        onProgress?.(index, total, `Scrollable capture ${index}/${total}`);

        await sendToTab(tabId, {
          type: "SCROLL_ELEMENT",
          selectorPath,
          left,
          top,
        });

        const liveRect = await sendToTab<{
          x: number;
          y: number;
          width: number;
          height: number;
        }>(tabId, { type: "GET_ELEMENT_RECT", selectorPath });

        const shot = await captureVisibleTabPng(windowId);
        if (index === 1) {
          dpr = shot.width / Math.max(1, originalMetrics.viewportWidth);
        }

        const cropW = Math.min(liveRect.width, scrollWidth - left);
        const cropH = Math.min(liveRect.height, scrollHeight - top);
        const cropped = await cropBlob(
          shot.blob,
          {
            x: liveRect.x,
            y: liveRect.y,
            width: cropW,
            height: cropH,
          },
          dpr
        );

        segments.push({
          blob: cropped.blob,
          destX: Math.round(left * dpr),
          destY: Math.round(top * dpr),
          srcW: cropped.width,
          srcH: cropped.height,
        });
      }
    }

    const totalWidth = Math.round(scrollWidth * dpr);
    const totalHeight = Math.round(scrollHeight * dpr);
    return stitchVertical(segments, totalWidth, totalHeight);
  } finally {
    await sendToTab(tabId, {
      type: "SCROLL_ELEMENT",
      selectorPath,
      left: 0,
      top: 0,
    }).catch(() => undefined);
    await sendToTab(tabId, { type: "RESTORE_PAGE_STATE" }).catch(() => undefined);
  }
}
