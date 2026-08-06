import type { ScrollableElementInfo } from "../shared/types";

function cssPath(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && parts.length < 8) {
    let part = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === node!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(node) + 1;
        part += `:nth-of-type(${index})`;
      }
    }
    parts.unshift(part);
    node = parent;
    if (node === document.body || node === document.documentElement) break;
  }
  return parts.join(" > ");
}

export function findScrollableElements(): ScrollableElementInfo[] {
  const out: ScrollableElementInfo[] = [];
  const nodes = document.querySelectorAll<HTMLElement>("body *");
  for (const el of nodes) {
    if (el.closest("[data-22shot-ui]")) continue;
    const style = getComputedStyle(el);
    const ox = style.overflowX;
    const oy = style.overflowY;
    const canY =
      (oy === "auto" || oy === "scroll" || oy === "overlay") &&
      el.scrollHeight > el.clientHeight + 4;
    const canX =
      (ox === "auto" || ox === "scroll" || ox === "overlay") &&
      el.scrollWidth > el.clientWidth + 4;
    if (!canX && !canY) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 20 || rect.height < 20) continue;
    out.push({
      selectorPath: cssPath(el),
      tagName: el.tagName.toLowerCase(),
      boundingRect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      overflowX: ox,
      overflowY: oy,
    });
  }
  return out.slice(0, 50);
}

export function resolveSelectorPath(path: string): HTMLElement | null {
  try {
    return document.querySelector(path);
  } catch {
    return null;
  }
}
