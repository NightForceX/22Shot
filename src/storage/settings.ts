import {
  DEFAULT_FILENAME_TEMPLATE,
  FIXED_ELEMENT_MODE,
  MAX_CAPTURE_HEIGHT_CSS,
} from "../shared/constants";
import type { Settings } from "../shared/types";

const DEFAULTS: Settings = {
  filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
  jpgQuality: 95,
  webpQuality: 95,
  webpLossless: false,
  fixedElementMode: FIXED_ELEMENT_MODE.AUTO,
  includeLazyContent: false,
  maxCaptureHeightCss: MAX_CAPTURE_HEIGHT_CSS,
  debugMode: false,
  defaultPageSize: "letter",
  defaultOrientation: "portrait",
  defaultMargins: "medium",
  saveAsDialog: true,
  activeDocumentId: null,
  preservePdfLinks: true,
};

let cached: Settings | null = null;
let loadPromise: Promise<Settings> | null = null;
let listening = false;

function ensureListener(): void {
  if (listening || typeof browser === "undefined") return;
  listening = true;
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.settings) return;
    const next = changes.settings.newValue as Partial<Settings> | undefined;
    cached = next ? { ...DEFAULTS, ...next } : { ...DEFAULTS };
  });
}

async function readSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get("settings");
  return { ...DEFAULTS, ...(stored.settings as Partial<Settings> | undefined) };
}

export async function getSettings(): Promise<Settings> {
  ensureListener();
  if (cached) return cached;
  if (!loadPromise) {
    loadPromise = readSettings()
      .then((s) => {
        cached = s;
        return s;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

/** Sync peek after a prior getSettings(); undefined until warmed. */
export function peekSettings(): Settings | undefined {
  return cached ?? undefined;
}

export async function setSettings(
  patch: Partial<Settings>
): Promise<Settings> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  cached = next;
  await browser.storage.local.set({ settings: next });
  return next;
}

export { DEFAULTS as DEFAULT_SETTINGS };
