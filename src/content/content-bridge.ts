import {
  findFixedStickyElements,
  hideElement,
  rememberStyle,
  restorePageState,
  snapshotPageState,
  type PageStateSnapshot,
} from "./cleanup";
import {
  hideOverlay,
  showElementOverlay,
  showRegionOverlay,
} from "./capture-overlay";
import { getPageMetrics, scrollWindowTo, waitFrames } from "./page-scroller";
import {
  findScrollableElements,
  resolveSelectorPath,
} from "./scrollable-elements";
import { collectSameOriginIframes } from "./iframe-capture";
import { collectPageLinks } from "./link-collector";
import { fail, ok, type ContentCommand } from "../shared/messages";

let pageState: PageStateSnapshot | null = null;
let fixedHidden = false;

function prepareFullpage(
  fixedMode: "auto" | "keep" | "hide",
  hideStickyAfterFirst: boolean
): void {
  if (!pageState) pageState = snapshotPageState();
  hideOverlay();

  // Soften smooth scroll during capture
  rememberStyle(pageState, document.documentElement);
  (document.documentElement as HTMLElement).style.scrollBehavior = "auto";

  if (fixedMode === "keep") return;

  if (fixedMode === "hide" || (fixedMode === "auto" && hideStickyAfterFirst)) {
    const els = findFixedStickyElements();
    for (const el of els) {
      hideElement(pageState, el);
    }
    fixedHidden = true;
  } else if (fixedMode === "auto" && !hideStickyAfterFirst) {
    // First segment: keep fixed elements visible
    fixedHidden = false;
  }
}

browser.runtime.onMessage.addListener((message: ContentCommand | { type: string }) => {
  return handleMessage(message as ContentCommand | { type: string });
});

async function handleMessage(
  message: ContentCommand | { type: string }
): Promise<ReturnType<typeof ok> | ReturnType<typeof fail>> {
  try {
    switch (message.type) {
      case "PING_CONTENT":
      case "PING":
        return ok(true);
      case "SHOW_REGION_OVERLAY":
        showRegionOverlay();
        return ok(true);
      case "SHOW_ELEMENT_OVERLAY":
        showElementOverlay();
        return ok(true);
      case "HIDE_OVERLAY":
        hideOverlay();
        return ok(true);
      case "GET_PAGE_METRICS":
        return ok(getPageMetrics());
      case "SCROLL_TO": {
        const m = message as Extract<ContentCommand, { type: "SCROLL_TO" }>;
        await scrollWindowTo(m.x, m.y, m.waitForStable !== false);
        return ok(getPageMetrics());
      }
      case "PREPARE_FULLPAGE": {
        const m = message as Extract<ContentCommand, { type: "PREPARE_FULLPAGE" }>;
        prepareFullpage(m.fixedMode, m.hideStickyAfterFirst);
        return ok(true);
      }
      case "RESTORE_PAGE_STATE": {
        hideOverlay();
        restorePageState(pageState);
        pageState = null;
        fixedHidden = false;
        return ok(true);
      }
      case "FIND_SCROLLABLES":
        return ok(findScrollableElements());
      case "SCROLL_ELEMENT": {
        const m = message as Extract<ContentCommand, { type: "SCROLL_ELEMENT" }>;
        const el = resolveSelectorPath(m.selectorPath);
        if (!el) return fail("Scrollable element not found", "ELEMENT_MISSING");
        if (!pageState) pageState = snapshotPageState();
        if (!pageState.elementScrolls.some((s) => s.el === el)) {
          pageState.elementScrolls.push({
            el,
            top: el.scrollTop,
            left: el.scrollLeft,
          });
        }
        el.scrollLeft = m.left;
        el.scrollTop = m.top;
        await waitFrames(2);
        return ok(true);
      }
      case "GET_ELEMENT_RECT": {
        const m = message as Extract<ContentCommand, { type: "GET_ELEMENT_RECT" }>;
        const el = resolveSelectorPath(m.selectorPath);
        if (!el) return fail("Element not found", "ELEMENT_MISSING");
        const r = el.getBoundingClientRect();
        return ok({
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
        });
      }
      case "DETECT_LAZY_GROWTH":
        return ok({
          scrollHeight: document.documentElement.scrollHeight,
          images: document.images.length,
        });
      case "LIST_IFRAMES":
        return ok(collectSameOriginIframes());
      case "COLLECT_PAGE_LINKS": {
        const m = message as Extract<ContentCommand, { type: "COLLECT_PAGE_LINKS" }>;
        return ok(collectPageLinks({ clip: m.clip }));
      }
      default:
        return fail(`Unknown content command: ${(message as { type: string }).type}`);
    }
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

void fixedHidden;
