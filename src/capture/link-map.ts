import type { CaptureLink } from "../shared/types";

export interface DocLink {
  href: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert document-space links into image-pixel space for a capture. */
export function linksToImageSpace(
  links: DocLink[],
  origin: { x: number; y: number },
  dpr: number
): CaptureLink[] {
  return links.map((l) => ({
    href: l.href,
    x: Math.round((l.x - origin.x) * dpr),
    y: Math.round((l.y - origin.y) * dpr),
    width: Math.max(1, Math.round(l.width * dpr)),
    height: Math.max(1, Math.round(l.height * dpr)),
  }));
}
