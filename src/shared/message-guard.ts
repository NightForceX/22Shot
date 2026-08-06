/**
 * Privilege separation for extension messaging.
 * Content scripts may only send an allowlisted subset; privileged actions require an extension page.
 */

/** Messages content scripts are allowed to send. */
export const CONTENT_ALLOWED_TYPES = new Set<string>([
  "CONTENT_READY",
  "REGION_SELECTED",
  "ELEMENT_SELECTED",
  "OVERLAY_CANCELLED",
  "CAPTURE_SCROLLABLE",
  "PAGE_METRICS",
  "SCROLLABLE_FOUND",
  "CAPTURE_PROGRESS",
  "DEBUG_LOG",
  "PING",
]);

export function extensionBaseUrl(): string {
  return browser.runtime.getURL("/");
}

export type MessageSender = browser.runtime.MessageSender;

export function isExtensionPageSender(sender: MessageSender): boolean {
  const url = sender.url;
  if (typeof url !== "string" || !url) return false;
  return url.startsWith(extensionBaseUrl());
}

export function isContentScriptSender(sender: MessageSender): boolean {
  return typeof sender.tab?.id === "number" && !isExtensionPageSender(sender);
}

export function assertSenderAllowed(
  type: string,
  sender: MessageSender | undefined,
  opts?: { internal?: boolean }
): void {
  if (opts?.internal) return;

  if (!sender || sender.id !== browser.runtime.id) {
    throw new Error("Message rejected: untrusted sender");
  }

  if (typeof type !== "string" || !type) {
    throw new Error("Message rejected: missing type");
  }

  if (isExtensionPageSender(sender)) return;

  if (isContentScriptSender(sender)) {
    if (!CONTENT_ALLOWED_TYPES.has(type)) {
      throw new Error(`Message rejected: content scripts cannot send ${type}`);
    }
    return;
  }

  throw new Error("Message rejected: unknown sender context");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isRegionRect(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return (
    isFiniteNumber(v.x) &&
    isFiniteNumber(v.y) &&
    isFiniteNumber(v.width) &&
    isFiniteNumber(v.height)
  );
}

/** Lightweight runtime shape checks for privileged / sensitive payloads. */
export function assertMessageShape(message: unknown): asserts message is {
  type: string;
  [key: string]: unknown;
} {
  if (!isPlainObject(message) || typeof message.type !== "string") {
    throw new Error("Message rejected: invalid envelope");
  }

  const type = message.type;
  switch (type) {
    case "SAVE_IMAGE": {
      const options = message.options;
      if (!isPlainObject(options)) throw new Error("Invalid SAVE_IMAGE options");
      if (typeof options.captureId !== "string" || !options.captureId) {
        throw new Error("Invalid SAVE_IMAGE captureId");
      }
      if (
        options.format !== "png" &&
        options.format !== "jpeg" &&
        options.format !== "webp"
      ) {
        throw new Error("Invalid SAVE_IMAGE format");
      }
      if (typeof options.filename !== "string") {
        throw new Error("Invalid SAVE_IMAGE filename");
      }
      break;
    }
    case "EXPORT_PDF": {
      const options = message.options;
      if (!isPlainObject(options)) throw new Error("Invalid EXPORT_PDF options");
      if (typeof options.documentId !== "string" || !options.documentId) {
        throw new Error("Invalid EXPORT_PDF documentId");
      }
      if (typeof options.filename !== "string") {
        throw new Error("Invalid EXPORT_PDF filename");
      }
      break;
    }
    case "COPY_IMAGE":
    case "GET_CAPTURE":
    case "GET_CAPTURE_BLOB":
    case "DELETE_CAPTURE":
      if (typeof message.captureId !== "string" || !message.captureId) {
        throw new Error(`Invalid ${type} captureId`);
      }
      break;
    case "SET_SETTINGS": {
      if (!isPlainObject(message.settings)) {
        throw new Error("Invalid SET_SETTINGS payload");
      }
      break;
    }
    case "REGION_SELECTED":
    case "ELEMENT_SELECTED":
    case "CAPTURE_REGION":
    case "CAPTURE_ELEMENT":
      if (!isRegionRect(message.rect)) {
        throw new Error(`Invalid ${type} rect`);
      }
      break;
    case "CAPTURE_SCROLLABLE":
      if (!isRegionRect(message.rect)) {
        throw new Error("Invalid CAPTURE_SCROLLABLE rect");
      }
      if (typeof message.selectorPath !== "string") {
        throw new Error("Invalid CAPTURE_SCROLLABLE selectorPath");
      }
      if (!isFiniteNumber(message.scrollWidth) || !isFiniteNumber(message.scrollHeight)) {
        throw new Error("Invalid CAPTURE_SCROLLABLE dimensions");
      }
      break;
    case "STORE_CAPTURE_TEMP":
      if (typeof message.dataUrl !== "string" || !message.dataUrl.startsWith("data:")) {
        throw new Error("Invalid STORE_CAPTURE_TEMP dataUrl");
      }
      break;
    default:
      break;
  }
}

const SETTINGS_KEYS = new Set([
  "filenameTemplate",
  "jpgQuality",
  "webpQuality",
  "webpLossless",
  "fixedElementMode",
  "includeLazyContent",
  "maxCaptureHeightCss",
  "debugMode",
  "defaultPageSize",
  "defaultOrientation",
  "defaultMargins",
  "saveAsDialog",
  "activeDocumentId",
  "preservePdfLinks",
]);

/** Drop unknown keys to reduce prototype-pollution / unexpected writes. */
export function sanitizeSettingsPatch(
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if (!SETTINGS_KEYS.has(key)) continue;
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    out[key] = patch[key];
  }
  return out;
}
