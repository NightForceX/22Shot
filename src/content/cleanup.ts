export interface SavedStyle {
  el: Element;
  cssText: string;
  attrStyle: string | null;
}

export interface PageStateSnapshot {
  scrollX: number;
  scrollY: number;
  focused: Element | null;
  modified: SavedStyle[];
  hiddenFixed: SavedStyle[];
  elementScrolls: Array<{ el: Element; top: number; left: number }>;
}

export function snapshotPageState(): PageStateSnapshot {
  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    focused: document.activeElement,
    modified: [],
    hiddenFixed: [],
    elementScrolls: [],
  };
}

export function rememberStyle(state: PageStateSnapshot, el: Element): void {
  if (state.modified.some((m) => m.el === el)) return;
  const htmlEl = el as HTMLElement;
  state.modified.push({
    el,
    cssText: htmlEl.style.cssText,
    attrStyle: el.getAttribute("style"),
  });
}

export function hideElement(state: PageStateSnapshot, el: Element): void {
  rememberStyle(state, el);
  const htmlEl = el as HTMLElement;
  htmlEl.style.setProperty("visibility", "hidden", "important");
  htmlEl.style.setProperty("pointer-events", "none", "important");
  state.hiddenFixed.push({
    el,
    cssText: htmlEl.style.cssText,
    attrStyle: el.getAttribute("style"),
  });
}

export function restorePageState(state: PageStateSnapshot | null): void {
  if (!state) return;
  for (const item of state.modified) {
    const htmlEl = item.el as HTMLElement;
    if (!htmlEl.isConnected) continue;
    if (item.attrStyle === null) htmlEl.removeAttribute("style");
    else htmlEl.setAttribute("style", item.attrStyle);
  }
  for (const s of state.elementScrolls) {
    const el = s.el as HTMLElement;
    if (el.isConnected) {
      el.scrollTop = s.top;
      el.scrollLeft = s.left;
    }
  }
  window.scrollTo(state.scrollX, state.scrollY);
  if (state.focused instanceof HTMLElement) {
    try {
      state.focused.focus({ preventScroll: true });
    } catch {
      // ignore
    }
  }
}

export function findFixedStickyElements(): HTMLElement[] {
  const results: HTMLElement[] = [];
  const all = document.body
    ? document.body.querySelectorAll<HTMLElement>("*")
    : [];
  for (const el of all) {
    if (el.closest("[data-22shot-ui]")) continue;
    const style = getComputedStyle(el);
    const pos = style.position;
    if (pos !== "fixed" && pos !== "sticky") continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) continue;
    if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
    if (rect.right < 0 || rect.left > window.innerWidth) continue;
    results.push(el);
  }
  return results;
}
