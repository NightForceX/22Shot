import { DEFAULT_FILENAME_TEMPLATE } from "./constants";

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface FilenamePreset {
  id: string;
  label: string;
  template: string;
  description: string;
}

/** Built-in ways to name saves / documents. */
export const FILENAME_PRESETS: FilenamePreset[] = [
  {
    id: "title-date-time",
    label: "Title + date + time",
    template: "{title} - {date} {time}",
    description: "Page title with when it was captured",
  },
  {
    id: "website-date-time",
    label: "Website + date + time",
    template: "{website} - {date} {time}",
    description: "Site hostname and capture time",
  },
  {
    id: "website-place-date",
    label: "Website + place + date",
    template: "{website} - {place} - {date}",
    description: "Hostname, page path, and date",
  },
  {
    id: "full",
    label: "Website + place + date + time",
    template: "{website} - {place} - {date} {time}",
    description: "Full location and timestamp",
  },
  {
    id: "title-website",
    label: "Title + website",
    template: "{title} - {website}",
    description: "Page title and hostname",
  },
  {
    id: "place-date-time",
    label: "Place + date + time",
    template: "{place} - {date} {time}",
    description: "Page path with timestamp",
  },
  {
    id: "date-time",
    label: "Date + time only",
    template: "{date}_{time}",
    description: "Timestamp only",
  },
  {
    id: "custom",
    label: "Custom template…",
    template: "",
    description: "Write your own token pattern",
  },
];

export function sanitizeFilename(name: string): string {
  let cleaned = name.replace(ILLEGAL, "_").replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(/[. ]+$/g, "");
  if (!cleaned || RESERVED.test(cleaned)) {
    cleaned = "screenshot";
  }
  if (cleaned.length > 180) {
    cleaned = cleaned.slice(0, 180).trim();
  }
  return cleaned;
}

/**
 * Sanitize a user/client download filename: strip directories, `..`, and illegal chars.
 * Keeps a single safe basename + allowed extension.
 */
export function sanitizeDownloadFilename(
  name: string,
  fallbackExt = "png"
): string {
  const raw = String(name || "").replace(/\\/g, "/");
  const leaf = raw.split("/").filter(Boolean).pop() || `screenshot.${fallbackExt}`;
  const cleanedLeaf = leaf.replace(/^\.+/, "");
  const dot = cleanedLeaf.lastIndexOf(".");
  let stem = cleanedLeaf;
  let ext = fallbackExt.replace(/^\./, "").toLowerCase();
  if (dot > 0) {
    stem = cleanedLeaf.slice(0, dot);
    const maybe = cleanedLeaf.slice(dot + 1).toLowerCase();
    if (/^(png|jpe?g|webp|pdf)$/.test(maybe)) {
      ext = maybe === "jpeg" ? "jpg" : maybe;
    }
  }
  if (ext === "jpeg") ext = "jpg";
  if (!/^(png|jpg|webp|pdf)$/.test(ext)) ext = "png";
  const safeStem = sanitizeFilename(stem) || "screenshot";
  return `${safeStem}.${ext}`;
}

export function formatDateParts(date = new Date()): {
  date: string;
  time: string;
} {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return {
    date: `${y}-${m}-${d}`,
    time: `${hh}-${mm}-${ss}`,
  };
}

export function parseUrlParts(url?: string): {
  website: string;
  place: string;
  path: string;
  urlSafe: string;
} {
  if (!url) {
    return { website: "page", place: "page", path: "page", urlSafe: "page" };
  }
  try {
    const u = new URL(url);
    const website = u.hostname || "page";
    const rawPath = decodeURIComponent(u.pathname || "/");
    const place =
      rawPath
        .replace(/^\/+|\/+$/g, "")
        .replace(/\//g, "_")
        .replace(/[^\w.\-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "") || "home";
    const path = place;
    const urlSafe = sanitizeFilename(`${website}_${place}`);
    return { website, place, path, urlSafe };
  } catch {
    return { website: "page", place: "page", path: "page", urlSafe: "page" };
  }
}

export function presetMatchingTemplate(template: string): string {
  const match = FILENAME_PRESETS.find(
    (p) => p.id !== "custom" && p.template === template
  );
  return match?.id || "custom";
}

export function templateForPreset(
  presetId: string,
  fallback = DEFAULT_FILENAME_TEMPLATE
): string {
  const preset = FILENAME_PRESETS.find((p) => p.id === presetId);
  if (!preset || preset.id === "custom" || !preset.template) return fallback;
  return preset.template;
}

export function buildFilename(options: {
  template?: string;
  title?: string;
  docTitle?: string;
  url?: string;
  width?: number;
  height?: number;
  counter?: number;
  /** Capture timestamp — uses this for {date}/{time} when set. */
  capturedAt?: number | Date;
  extension: string;
}): string {
  const template = options.template || DEFAULT_FILENAME_TEMPLATE;
  const when =
    options.capturedAt instanceof Date
      ? options.capturedAt
      : typeof options.capturedAt === "number"
        ? new Date(options.capturedAt)
        : new Date();
  const { date, time } = formatDateParts(when);
  const { website, place, path, urlSafe } = parseUrlParts(options.url);
  const title = sanitizeFilename(options.title || "Untitled");
  const doc = sanitizeFilename(options.docTitle || options.title || "Document");

  const replaced = template
    .replaceAll("{title}", title)
    .replaceAll("{doc}", doc)
    .replaceAll("{website}", sanitizeFilename(website))
    .replaceAll("{domain}", sanitizeFilename(website))
    .replaceAll("{place}", sanitizeFilename(place))
    .replaceAll("{path}", sanitizeFilename(path))
    .replaceAll("{url}", urlSafe)
    .replaceAll("{date}", date)
    .replaceAll("{time}", time)
    .replaceAll("{width}", String(options.width ?? ""))
    .replaceAll("{height}", String(options.height ?? ""))
    .replaceAll("{counter}", String(options.counter ?? 1));

  const base = sanitizeFilename(replaced);
  const ext = options.extension.replace(/^\./, "");
  return `${base}.${ext}`;
}

/** Filename without extension — useful for document titles. */
export function buildNameBase(
  options: Omit<Parameters<typeof buildFilename>[0], "extension">
): string {
  return buildFilename({ ...options, extension: "tmp" }).replace(/\.tmp$/i, "");
}

export function dataUrlToExtension(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("pdf")) return "pdf";
  return "png";
}
