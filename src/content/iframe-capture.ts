import type { FrameInfo } from "../shared/types";

export function collectSameOriginIframes(): FrameInfo[] {
  const frames: FrameInfo[] = [];
  const list = document.querySelectorAll("iframe");
  list.forEach((iframe, index) => {
    const rect = iframe.getBoundingClientRect();
    let accessible = false;
    let scrollWidth = Math.round(rect.width);
    let scrollHeight = Math.round(rect.height);
    let scrollX = 0;
    let scrollY = 0;
    let viewportWidth = Math.round(rect.width);
    let viewportHeight = Math.round(rect.height);
    let dpr = window.devicePixelRatio || 1;
    try {
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (doc && win) {
        accessible = true;
        scrollWidth = Math.max(
          doc.documentElement.scrollWidth,
          doc.body?.scrollWidth || 0
        );
        scrollHeight = Math.max(
          doc.documentElement.scrollHeight,
          doc.body?.scrollHeight || 0
        );
        scrollX = win.scrollX;
        scrollY = win.scrollY;
        viewportWidth = win.innerWidth;
        viewportHeight = win.innerHeight;
        dpr = win.devicePixelRatio || dpr;
      }
    } catch {
      accessible = false;
    }
    frames.push({
      frameId: index,
      parentFrameId: -1,
      url: iframe.src || "",
      sameOrigin: accessible,
      accessible,
      boundingRect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      scrollWidth,
      scrollHeight,
      scrollX,
      scrollY,
      viewportWidth,
      viewportHeight,
      devicePixelRatio: dpr,
    });
  });
  return frames;
}

export function iframeAccessMessage(accessible: boolean): string {
  if (accessible) {
    return "Iframe contents are accessible for full capture.";
  }
  return "Full iframe capture is unavailable for this frame because Firefox does not permit the extension to access its contents. The visible portion can still be captured.";
}
