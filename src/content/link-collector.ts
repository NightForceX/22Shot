import { resolveSafeHref } from "../shared/safe-url";

export interface PageLink {
  href: string;
  /** Document CSS coordinates */
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
}

function resolveHref(href: string): string | null {
  return resolveSafeHref(href, location.href);
}

/** Collect clickable links in document coordinates. */
export function collectPageLinks(options?: {
  /** Optional document-space clip rect; only intersecting links are returned */
  clip?: { x: number; y: number; width: number; height: number };
  limit?: number;
}): PageLink[] {
  const limit = options?.limit ?? 400;
  const clip = options?.clip;
  const out: PageLink[] = [];
  const anchors = document.querySelectorAll<HTMLAnchorElement>("a[href]");

  for (const a of anchors) {
    if (out.length >= limit) break;
    if (a.closest("[data-22shot-ui]")) continue;
    const href = resolveHref(a.href || a.getAttribute("href") || "");
    if (!href) continue;

    const r = a.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const x = r.left + window.scrollX;
    const y = r.top + window.scrollY;
    const width = r.width;
    const height = r.height;

    if (clip) {
      const intersects =
        x < clip.x + clip.width &&
        x + width > clip.x &&
        y < clip.y + clip.height &&
        y + height > clip.y;
      if (!intersects) continue;
    }

    out.push({
      href,
      x,
      y,
      width,
      height,
      text: (a.innerText || a.textContent || "").trim().slice(0, 200),
    });
  }

  return out;
}
