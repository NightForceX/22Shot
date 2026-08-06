const INTERESTING = new Set([
  "IMG",
  "VIDEO",
  "TABLE",
  "FORM",
  "ARTICLE",
  "SECTION",
  "MAIN",
  "NAV",
  "HEADER",
  "FOOTER",
  "ASIDE",
  "FIGURE",
  "UL",
  "OL",
  "LI",
  "BUTTON",
  "A",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "DIV",
  "SPAN",
]);

function area(el: Element): number {
  const r = el.getBoundingClientRect();
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function scoreElement(el: Element): number {
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return -1;
  if (r.width * r.height < 64) return -1;
  let score = 0;
  if (INTERESTING.has(el.tagName)) score += 5;
  if (["ARTICLE", "MAIN", "SECTION", "TABLE", "IMG", "VIDEO"].includes(el.tagName))
    score += 8;
  const role = el.getAttribute("role");
  if (role) score += 3;
  // Prefer mid-sized elements over full-viewport wrappers
  const viewportArea = window.innerWidth * window.innerHeight;
  const ratio = area(el) / Math.max(1, viewportArea);
  if (ratio > 0.95) score -= 10;
  if (ratio > 0.4 && ratio < 0.9) score += 4;
  if (ratio < 0.02) score -= 3;
  return score;
}

export function pickElementAtPoint(x: number, y: number): Element | null {
  const stack = document.elementsFromPoint(x, y).filter((el) => {
    if (!(el instanceof Element)) return false;
    if (el.closest("[data-22shot-ui]")) return false;
    return el !== document.documentElement && el !== document.body;
  });
  if (!stack.length) return null;

  let best: Element | null = null;
  let bestScore = -Infinity;
  for (const el of stack.slice(0, 12)) {
    const s = scoreElement(el);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return best;
}

export function walkParent(el: Element | null): Element | null {
  if (!el) return null;
  let p = el.parentElement;
  while (p && (p === document.body || p === document.documentElement)) {
    return p;
  }
  return p;
}

export function walkChild(el: Element | null, originX: number, originY: number): Element | null {
  if (!el) return null;
  const stack = document.elementsFromPoint(originX, originY);
  const idx = stack.indexOf(el);
  if (idx > 0) return stack[idx - 1] || null;
  // fallback: first interesting child containing point
  for (const child of Array.from(el.children)) {
    const r = child.getBoundingClientRect();
    if (
      originX >= r.left &&
      originX <= r.right &&
      originY >= r.top &&
      originY <= r.bottom
    ) {
      return child;
    }
  }
  return el.firstElementChild;
}

export function rectOf(el: Element): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const r = el.getBoundingClientRect();
  return {
    x: r.left,
    y: r.top,
    width: r.width,
    height: r.height,
  };
}
