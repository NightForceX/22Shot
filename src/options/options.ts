import { sendMessage } from "../shared/messages";
import {
  FILENAME_PRESETS,
  presetMatchingTemplate,
  templateForPreset,
} from "../shared/filename";
import type { Settings } from "../shared/types";

const form = document.getElementById("form") as HTMLFormElement | null;
const statusEl = document.getElementById("status");
const hostStatus = document.getElementById("host-status");
const presetEl = document.getElementById(
  "filenamePreset"
) as HTMLSelectElement | null;
const templateEl = document.getElementById(
  "filenameTemplate"
) as HTMLInputElement | null;
const templateWrap = document.getElementById("filenameTemplateWrap");

function setStatus(text: string, isError = false): void {
  if (!statusEl) return;
  statusEl.textContent = text;
  statusEl.style.color = isError ? "#c50042" : "";
}

function fillPresets(): void {
  if (!presetEl) return;
  presetEl.innerHTML = "";
  for (const p of FILENAME_PRESETS) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.label;
    opt.title = p.description;
    presetEl.appendChild(opt);
  }
}

function syncTemplateVisibility(): void {
  if (!presetEl || !templateWrap) return;
  templateWrap.hidden = presetEl.value !== "custom";
}

function setForm(settings: Settings): void {
  if (templateEl) templateEl.value = settings.filenameTemplate;
  if (presetEl) {
    presetEl.value = presetMatchingTemplate(settings.filenameTemplate);
  }
  syncTemplateVisibility();
  (document.getElementById("fixedElementMode") as HTMLSelectElement).value =
    settings.fixedElementMode;
  (document.getElementById("includeLazyContent") as HTMLInputElement).checked =
    settings.includeLazyContent;
  (document.getElementById("maxCaptureHeightCss") as HTMLInputElement).value =
    String(settings.maxCaptureHeightCss);
  (document.getElementById("jpgQuality") as HTMLInputElement).value = String(
    settings.jpgQuality
  );
  (document.getElementById("webpQuality") as HTMLInputElement).value = String(
    settings.webpQuality
  );
  (document.getElementById("webpLossless") as HTMLInputElement).checked =
    settings.webpLossless;
  (document.getElementById("saveAsDialog") as HTMLInputElement).checked =
    settings.saveAsDialog;
  (document.getElementById("debugMode") as HTMLInputElement).checked =
    settings.debugMode;
  (document.getElementById("preservePdfLinks") as HTMLInputElement).checked =
    settings.preservePdfLinks !== false;
}

async function load(): Promise<void> {
  if (typeof browser === "undefined") {
    setStatus(
      "Firefox extension API unavailable. Reload the add-on from dist/manifest.json.",
      true
    );
    return;
  }

  try {
    const data = await sendMessage<{ settings: Settings }>({
      type: "GET_SETTINGS",
    });
    setForm(data.settings);
    const allowed = await browser.permissions.contains({
      origins: ["<all_urls>"],
    });
    if (hostStatus) {
      hostStatus.textContent = allowed
        ? "Optional host permission granted."
        : "Optional host permission not granted.";
    }
    setStatus("Ready");
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

function currentTemplate(): string {
  const presetId = presetEl?.value || "title-date-time";
  if (presetId === "custom") {
    return templateEl?.value || "{title} - {date} {time}";
  }
  return templateForPreset(presetId, templateEl?.value);
}

function bind(): void {
  if (!form) {
    setStatus("Options form missing from page.", true);
    return;
  }

  fillPresets();

  presetEl?.addEventListener("change", () => {
    const id = presetEl.value;
    if (id !== "custom" && templateEl) {
      templateEl.value = templateForPreset(id, templateEl.value);
    }
    syncTemplateVisibility();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const settings: Partial<Settings> = {
      filenameTemplate: currentTemplate(),
      fixedElementMode: (
        document.getElementById("fixedElementMode") as HTMLSelectElement
      ).value as Settings["fixedElementMode"],
      includeLazyContent: (
        document.getElementById("includeLazyContent") as HTMLInputElement
      ).checked,
      maxCaptureHeightCss: Number(
        (document.getElementById("maxCaptureHeightCss") as HTMLInputElement)
          .value
      ),
      jpgQuality: Number(
        (document.getElementById("jpgQuality") as HTMLInputElement).value
      ),
      webpQuality: Number(
        (document.getElementById("webpQuality") as HTMLInputElement).value
      ),
      webpLossless: (
        document.getElementById("webpLossless") as HTMLInputElement
      ).checked,
      saveAsDialog: (
        document.getElementById("saveAsDialog") as HTMLInputElement
      ).checked,
      debugMode: (document.getElementById("debugMode") as HTMLInputElement)
        .checked,
      preservePdfLinks: (
        document.getElementById("preservePdfLinks") as HTMLInputElement
      ).checked,
    };
    try {
      await sendMessage({ type: "SET_SETTINGS", settings });
      setStatus("Saved");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  });

  document.getElementById("btn-hosts")?.addEventListener("click", async () => {
    try {
      const granted = await browser.permissions.request({
        origins: ["<all_urls>"],
      });
      if (hostStatus) {
        hostStatus.textContent = granted
          ? "Optional host permission granted."
          : "Permission denied.";
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), true);
    }
  });

  void load();
}

try {
  (window as unknown as { __PS_BOOT?: boolean }).__PS_BOOT = true;
  bind();
} catch (err) {
  document.body.textContent =
    "22Shot options failed to start: " +
    (err instanceof Error ? err.message : String(err));
}
