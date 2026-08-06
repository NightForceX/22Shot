import {
  pickElementAtPoint,
  rectOf,
  walkChild,
  walkParent,
} from "./element-selector";
import { findScrollableElements, resolveSelectorPath } from "./scrollable-elements";

type Mode = "region" | "element" | null;

/** Selection in document coordinates (region mode) or viewport coords (element mode). */
interface Selection {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HOST_ID = "addon-22shot-overlay-root";
const EDGE_PX = 36;
const MAX_SCROLL_SPEED = 28;

let mode: Mode = null;
let selection: Selection | null = null;
let dragging = false;
let dragKind: "new" | "move" | "resize" | null = null;
let resizeHandle: string | null = null;
let startDocX = 0;
let startDocY = 0;
let originSel: Selection | null = null;
let hoverEl: Element | null = null;
let pointerX = 0;
let pointerY = 0;
let host: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let autoScrollRaf = 0;
let scrollAxisX = 0;
let scrollAxisY = 0;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function docX(clientX: number): number {
  return clientX + window.scrollX;
}

function docY(clientY: number): number {
  return clientY + window.scrollY;
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number): Selection {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  return {
    x,
    y,
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

function pageBounds(): { width: number; height: number } {
  const doc = document.documentElement;
  const body = document.body;
  return {
    width: Math.max(doc.scrollWidth, body?.scrollWidth ?? 0, window.innerWidth),
    height: Math.max(doc.scrollHeight, body?.scrollHeight ?? 0, window.innerHeight),
  };
}

function ensureOverlay(): ShadowRoot {
  if (host && shadow) return shadow;
  host = document.createElement("div");
  host.id = HOST_ID;
  host.setAttribute("data-22shot-ui", "true");
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;";
  // Closed mode: page JS cannot reach into the overlay via host.shadowRoot.
  shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; font-family: system-ui, Segoe UI, sans-serif; }
      .root { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; }
      .dim { position:absolute; inset:0; background: rgba(0,0,0,.45); }
      .hole {
        position:absolute; box-shadow: 0 0 0 9999px rgba(0,0,0,.45);
        outline: 2px solid #0a84ff; background: transparent;
      }
      .size {
        position:absolute; transform: translate(-50%, -120%);
        background:#1c1c1e; color:#fff; font-size:12px; padding:2px 6px;
        border-radius:4px; white-space:nowrap; pointer-events:none;
      }
      .handle {
        position:absolute; width:8px; height:8px; background:#fff;
        border:1px solid #0a84ff; border-radius:1px;
      }
      .handle.nw{left:-4px;top:-4px;cursor:nwse-resize}
      .handle.ne{right:-4px;top:-4px;cursor:nesw-resize}
      .handle.sw{left:-4px;bottom:-4px;cursor:nesw-resize}
      .handle.se{right:-4px;bottom:-4px;cursor:nwse-resize}
      .handle.n{left:50%;top:-4px;transform:translateX(-50%);cursor:ns-resize}
      .handle.s{left:50%;bottom:-4px;transform:translateX(-50%);cursor:ns-resize}
      .handle.w{top:50%;left:-4px;transform:translateY(-50%);cursor:ew-resize}
      .handle.e{top:50%;right:-4px;transform:translateY(-50%);cursor:ew-resize}
      .el-highlight {
        position:absolute; border:2px solid #0a84ff;
        background: rgba(10,132,255,.15); pointer-events:none;
      }
      .toolbar {
        position:fixed; left:50%; bottom:24px; transform:translateX(-50%);
        display:flex; gap:8px; align-items:center;
        background: #2b2a33; color:#fbfbfe; padding:8px 10px;
        border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.35);
        pointer-events:auto; z-index:2;
      }
      .toolbar button {
        appearance:none; border:0; border-radius:6px; padding:6px 10px;
        background:#5b5b66; color:#fff; cursor:pointer; font-size:12px;
      }
      .toolbar button.primary { background:#0a84ff; }
      .toolbar button:disabled { opacity:.45; cursor:default; }
      .hint { font-size:11px; opacity:.8; margin-right:6px; }
    </style>
    <div class="root" id="root">
      <div class="dim" id="dim"></div>
      <div class="hole" id="hole" hidden></div>
      <div class="size" id="size" hidden></div>
      <div class="el-highlight" id="el" hidden></div>
      <div class="toolbar" id="toolbar" role="toolbar" aria-label="22Shot capture">
        <span class="hint" id="hint">Drag to select · Esc cancel</span>
        <button type="button" data-act="capture" class="primary" disabled>Capture</button>
        <button type="button" data-act="copy" disabled>Copy</button>
        <button type="button" data-act="add" disabled>Add to Document</button>
        <button type="button" data-act="scrollable" hidden>Capture full scrollable</button>
        <button type="button" data-act="cancel">Cancel</button>
      </div>
    </div>
  `;
  document.documentElement.appendChild(host);
  bindOverlayEvents();
  return shadow;
}

function ui<T extends HTMLElement>(id: string): T {
  return shadow!.getElementById(id) as T;
}

function bindOverlayEvents(): void {
  const root = ui("root");
  root.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove, true);
  window.addEventListener("mouseup", onPointerUp, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("scroll", onScroll, true);
  ui("toolbar").addEventListener("click", onToolbarClick);
}

function stopAutoScroll(): void {
  scrollAxisX = 0;
  scrollAxisY = 0;
  if (autoScrollRaf) {
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = 0;
  }
}

function edgeScrollSpeed(clientPos: number, size: number): number {
  if (clientPos < EDGE_PX) {
    const t = 1 - clientPos / EDGE_PX;
    return -Math.ceil(MAX_SCROLL_SPEED * t * t);
  }
  if (clientPos > size - EDGE_PX) {
    const t = 1 - (size - clientPos) / EDGE_PX;
    return Math.ceil(MAX_SCROLL_SPEED * t * t);
  }
  return 0;
}

function updateAutoScrollAxes(): void {
  if (!dragging || mode !== "region") {
    stopAutoScroll();
    return;
  }
  // Don't scroll when pointer is over the bottom toolbar
  if (pointerY > window.innerHeight - 70) {
    scrollAxisX = edgeScrollSpeed(pointerX, window.innerWidth);
    scrollAxisY = 0;
  } else {
    scrollAxisX = edgeScrollSpeed(pointerX, window.innerWidth);
    scrollAxisY = edgeScrollSpeed(pointerY, window.innerHeight);
  }
  if ((scrollAxisX || scrollAxisY) && !autoScrollRaf) {
    autoScrollRaf = requestAnimationFrame(autoScrollTick);
  }
}

function autoScrollTick(): void {
  autoScrollRaf = 0;
  if (!dragging || mode !== "region") return;
  if (!scrollAxisX && !scrollAxisY) return;

  const beforeX = window.scrollX;
  const beforeY = window.scrollY;
  window.scrollBy(scrollAxisX, scrollAxisY);
  const dx = window.scrollX - beforeX;
  const dy = window.scrollY - beforeY;

  if (dx || dy) {
    updateSelectionFromPointer();
    render();
  }

  updateAutoScrollAxes();
  if (scrollAxisX || scrollAxisY) {
    autoScrollRaf = requestAnimationFrame(autoScrollTick);
  }
}

function updateSelectionFromPointer(): void {
  if (!dragging || mode !== "region") return;
  const curX = docX(pointerX);
  const curY = docY(pointerY);
  const bounds = pageBounds();

  if (dragKind === "new") {
    selection = normalizeRect(startDocX, startDocY, curX, curY);
  } else if (dragKind === "move" && originSel) {
    selection = {
      ...originSel,
      x: clamp(originSel.x + (curX - startDocX), 0, bounds.width - originSel.width),
      y: clamp(originSel.y + (curY - startDocY), 0, bounds.height - originSel.height),
    };
  } else if (dragKind === "resize" && originSel && resizeHandle) {
    selection = resizeFromHandle(originSel, resizeHandle, curX, curY);
  }

  if (selection) {
    selection.x = clamp(selection.x, 0, Math.max(0, bounds.width - 1));
    selection.y = clamp(selection.y, 0, Math.max(0, bounds.height - 1));
    selection.width = clamp(selection.width, 0, bounds.width - selection.x);
    selection.height = clamp(selection.height, 0, bounds.height - selection.y);
  }
}

function onScroll(): void {
  if (mode === "region" && selection) render();
}

function regionMessageRect(): Selection {
  // Always send document coordinates for region capture
  return { ...(selection as Selection) };
}

function onToolbarClick(e: Event): void {
  const btn = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "cancel") {
    hideOverlay();
    browser.runtime.sendMessage({ type: "OVERLAY_CANCELLED" });
    return;
  }
  if (!selection || selection.width < 2 || selection.height < 2) return;
  if (act === "scrollable" && hoverEl) {
    const info = findScrollableElements().find((s) => {
      const el = resolveSelectorPath(s.selectorPath);
      return el === hoverEl;
    });
    if (info) {
      browser.runtime.sendMessage({
        type: "CAPTURE_SCROLLABLE",
        rect: info.boundingRect,
        scrollWidth: info.scrollWidth,
        scrollHeight: info.scrollHeight,
        selectorPath: info.selectorPath,
      });
      hideOverlay();
      return;
    }
  }
  if (act === "capture" || act === "copy" || act === "add") {
    if (mode === "element") {
      browser.runtime.sendMessage({
        type: "ELEMENT_SELECTED",
        rect: { ...selection },
        tagName: hoverEl?.tagName?.toLowerCase?.() || "region",
        action: act,
      });
    } else {
      browser.runtime.sendMessage({
        type: "REGION_SELECTED",
        rect: regionMessageRect(),
        coordinateSpace: "document",
        action: act,
      });
    }
    setOverlayVisible(false);
  }
}

function setOverlayVisible(visible: boolean): void {
  if (!host) return;
  host.style.display = visible ? "block" : "none";
}

function render(): void {
  if (!shadow) return;
  const hole = ui("hole");
  const size = ui("size");
  const elBox = ui("el");
  const dim = ui("dim");
  const hint = ui("hint");
  const captureBtn = shadow.querySelector('[data-act="capture"]') as HTMLButtonElement;
  const copyBtn = shadow.querySelector('[data-act="copy"]') as HTMLButtonElement;
  const addBtn = shadow.querySelector('[data-act="add"]') as HTMLButtonElement;
  const scrollBtn = shadow.querySelector('[data-act="scrollable"]') as HTMLButtonElement;

  if (mode === "region") {
    hint.textContent =
      "Drag near edges to scroll · arrows nudge · Enter capture · Esc cancel";
    dim.hidden = !!selection;
    if (selection && selection.width >= 1 && selection.height >= 1) {
      const viewX = selection.x - window.scrollX;
      const viewY = selection.y - window.scrollY;
      hole.hidden = false;
      hole.style.left = `${viewX}px`;
      hole.style.top = `${viewY}px`;
      hole.style.width = `${selection.width}px`;
      hole.style.height = `${selection.height}px`;
      hole.style.cursor = "move";
      hole.replaceChildren();
      for (const h of ["nw", "n", "ne", "w", "e", "sw", "s", "se"]) {
        const handle = document.createElement("div");
        handle.className = `handle ${h}`;
        handle.dataset.handle = h;
        hole.appendChild(handle);
      }
      size.hidden = false;
      size.style.left = `${viewX + selection.width / 2}px`;
      size.style.top = `${viewY}px`;
      size.textContent = `${Math.round(selection.width)} × ${Math.round(selection.height)} px`;
    } else {
      hole.hidden = true;
      size.hidden = true;
    }
    elBox.hidden = true;
  } else if (mode === "element") {
    hint.textContent = "Hover element · Alt+↑/↓ hierarchy · click capture · Esc cancel";
    dim.hidden = false;
    hole.hidden = true;
    if (hoverEl) {
      const r = rectOf(hoverEl);
      selection = r;
      elBox.hidden = false;
      elBox.style.left = `${r.x}px`;
      elBox.style.top = `${r.y}px`;
      elBox.style.width = `${r.width}px`;
      elBox.style.height = `${r.height}px`;
      size.hidden = false;
      size.style.left = `${r.x + r.width / 2}px`;
      size.style.top = `${r.y}px`;
      size.textContent = `${hoverEl.tagName.toLowerCase()} · ${Math.round(r.width)} × ${Math.round(r.height)} px`;
      const scrollable = findScrollableElements().some((s) => {
        return resolveSelectorPath(s.selectorPath) === hoverEl;
      });
      scrollBtn.hidden = !scrollable;
    } else {
      elBox.hidden = true;
      size.hidden = true;
      scrollBtn.hidden = true;
    }
  }

  const ready = !!(selection && selection.width >= 2 && selection.height >= 2);
  captureBtn.disabled = !ready;
  copyBtn.disabled = !ready;
  addBtn.disabled = !ready;
}

function onPointerDown(e: MouseEvent): void {
  if ((e.target as HTMLElement).closest?.("#toolbar")) return;
  if (mode === "element") {
    if (!hoverEl || !selection) return;
    browser.runtime.sendMessage({
      type: "ELEMENT_SELECTED",
      rect: { ...selection },
      tagName: hoverEl.tagName.toLowerCase(),
      action: "capture",
    });
    setOverlayVisible(false);
    return;
  }
  if (mode !== "region") return;
  const target = e.target as HTMLElement;
  const handle = target.dataset?.handle;
  pointerX = e.clientX;
  pointerY = e.clientY;
  startDocX = docX(e.clientX);
  startDocY = docY(e.clientY);
  if (handle && selection) {
    dragging = true;
    dragKind = "resize";
    resizeHandle = handle;
    originSel = { ...selection };
  } else if (selection && target.id === "hole") {
    dragging = true;
    dragKind = "move";
    originSel = { ...selection };
  } else {
    dragging = true;
    dragKind = "new";
    selection = { x: startDocX, y: startDocY, width: 0, height: 0 };
  }
  e.preventDefault();
  updateAutoScrollAxes();
  render();
}

function onPointerMove(e: MouseEvent): void {
  pointerX = e.clientX;
  pointerY = e.clientY;
  if (mode === "element" && !dragging) {
    hoverEl = pickElementAtPoint(pointerX, pointerY);
    render();
    return;
  }
  if (!dragging || mode !== "region") return;
  updateSelectionFromPointer();
  updateAutoScrollAxes();
  render();
}

function resizeFromHandle(
  origin: Selection,
  handle: string,
  cx: number,
  cy: number
): Selection {
  let x1 = origin.x;
  let y1 = origin.y;
  let x2 = origin.x + origin.width;
  let y2 = origin.y + origin.height;
  if (handle.includes("w")) x1 = cx;
  if (handle.includes("e")) x2 = cx;
  if (handle.includes("n")) y1 = cy;
  if (handle.includes("s")) y2 = cy;
  return normalizeRect(x1, y1, x2, y2);
}

function onPointerUp(): void {
  dragging = false;
  dragKind = null;
  resizeHandle = null;
  stopAutoScroll();
  render();
}

function nudge(dx: number, dy: number): void {
  if (!selection || mode !== "region") return;
  const bounds = pageBounds();
  selection = {
    ...selection,
    x: clamp(selection.x + dx, 0, bounds.width - selection.width),
    y: clamp(selection.y + dy, 0, bounds.height - selection.height),
  };
  render();
}

function onKeyDown(e: KeyboardEvent): void {
  if (!mode) return;
  if (e.key === "Escape") {
    e.preventDefault();
    hideOverlay();
    browser.runtime.sendMessage({ type: "OVERLAY_CANCELLED" });
    return;
  }
  if (mode === "element") {
    if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      hoverEl = walkParent(hoverEl) || hoverEl;
      render();
    } else if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      hoverEl = walkChild(hoverEl, pointerX, pointerY) || hoverEl;
      render();
    } else if (e.key === "Enter" && selection) {
      e.preventDefault();
      browser.runtime.sendMessage({
        type: "ELEMENT_SELECTED",
        rect: { ...selection },
        tagName: hoverEl?.tagName?.toLowerCase?.() || "element",
        action: "capture",
      });
      setOverlayVisible(false);
    }
    return;
  }
  if (mode === "region") {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      nudge(-step, 0);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      nudge(step, 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      nudge(0, -step);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      nudge(0, step);
    } else if (e.key === "Enter" && selection && selection.width >= 2) {
      e.preventDefault();
      browser.runtime.sendMessage({
        type: "REGION_SELECTED",
        rect: regionMessageRect(),
        coordinateSpace: "document",
        action: "capture",
      });
      setOverlayVisible(false);
    }
  }
}

export function showRegionOverlay(): void {
  ensureOverlay();
  mode = "region";
  selection = null;
  hoverEl = null;
  stopAutoScroll();
  setOverlayVisible(true);
  render();
}

export function showElementOverlay(): void {
  ensureOverlay();
  mode = "element";
  selection = null;
  hoverEl = null;
  stopAutoScroll();
  setOverlayVisible(true);
  render();
}

export function hideOverlay(): void {
  mode = null;
  selection = null;
  hoverEl = null;
  dragging = false;
  stopAutoScroll();
  if (host) {
    host.remove();
    host = null;
    shadow = null;
  }
  window.removeEventListener("mousemove", onPointerMove, true);
  window.removeEventListener("mouseup", onPointerUp, true);
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("scroll", onScroll, true);
}

export function isOverlayActive(): boolean {
  return mode !== null;
}
