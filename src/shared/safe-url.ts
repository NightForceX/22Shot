/** Schemes allowed in PDF link annotations / collected page links. */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

export function isSafeHref(href: string): boolean {
  if (!href || typeof href !== "string") return false;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith("//")) return false;
  try {
    const u = new URL(trimmed);
    return SAFE_SCHEMES.has(u.protocol);
  } catch {
    return false;
  }
}

/** Resolve relative href against a base; return null if unsafe. */
export function resolveSafeHref(href: string, base?: string): string | null {
  if (!href || typeof href !== "string") return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.toLowerCase().startsWith("javascript:")) return null;
  try {
    const absolute = base ? new URL(trimmed, base).href : new URL(trimmed).href;
    return isSafeHref(absolute) ? absolute : null;
  } catch {
    return null;
  }
}
