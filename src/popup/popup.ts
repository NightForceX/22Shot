import { sendMessage } from "../shared/messages";
import type { CaptureResult } from "../shared/types";
import { buildFilename } from "../shared/filename";

let lastCapture: CaptureResult | null = null;

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

const statusEl = $("status");
const resultEl = $("result");
const previewEl = $("preview") as HTMLImageElement;
const docSummary = $("doc-summary");

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function showCapture(capture: CaptureResult): void {
  lastCapture = capture;
  resultEl.hidden = false;
  if (capture.previewDataUrl) {
    previewEl.src = capture.previewDataUrl;
  }
  setStatus(`${capture.width} × ${capture.height}`);
}

async function refreshDocSummary(): Promise<void> {
  try {
    const summary = await sendMessage<{
      documentId: string | null;
      title: string | null;
      captureCount: number;
    }>({ type: "GET_ACTIVE_DOCUMENT_SUMMARY" });
    if (!summary.documentId) {
      docSummary.textContent = "No active document";
    } else {
      docSummary.textContent = `${summary.title || "Document"} · ${summary.captureCount} capture${summary.captureCount === 1 ? "" : "s"}`;
    }
  } catch (err) {
    docSummary.textContent = "Background unavailable";
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function run(label: string, fn: () => Promise<void>): Promise<void> {
  setStatus(label);
  try {
    await fn();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

function bind(): void {
  if (typeof browser === "undefined") {
    setStatus("Firefox extension API unavailable. Reload the add-on from dist/manifest.json.", true);
    return;
  }

  $("btn-visible").addEventListener("click", () =>
    run("Capturing visible area…", async () => {
      const data = await sendMessage<{ capture: CaptureResult }>({
        type: "CAPTURE_VISIBLE",
      });
      showCapture(data.capture);
      await refreshDocSummary();
    })
  );

  $("btn-region").addEventListener("click", () => {
    setStatus("Starting region capture…");
    void sendMessage({ type: "START_REGION_CAPTURE" }).catch((err) => {
      setStatus(err instanceof Error ? err.message : String(err), true);
    });
    window.close();
  });

  $("btn-element").addEventListener("click", () => {
    setStatus("Starting element capture…");
    void sendMessage({ type: "START_ELEMENT_CAPTURE" }).catch((err) => {
      setStatus(err instanceof Error ? err.message : String(err), true);
    });
    window.close();
  });

  $("btn-fullpage").addEventListener("click", () =>
    run("Capturing full page…", async () => {
      const data = await sendMessage<{ capture: CaptureResult }>({
        type: "START_FULLPAGE_CAPTURE",
      });
      showCapture(data.capture);
      await refreshDocSummary();
    })
  );

  const preserveLinksEl = document.getElementById(
    "preserve-links"
  ) as HTMLInputElement | null;

  void sendMessage<{ settings: { preservePdfLinks: boolean } }>({
    type: "GET_SETTINGS",
  })
    .then((data) => {
      if (preserveLinksEl) {
        preserveLinksEl.checked = data.settings.preservePdfLinks !== false;
      }
    })
    .catch(() => undefined);

  preserveLinksEl?.addEventListener("change", () => {
    void sendMessage({
      type: "SET_SETTINGS",
      settings: { preservePdfLinks: preserveLinksEl.checked },
    });
  });

  $("btn-pdf").addEventListener("click", () =>
    run("Saving webpage as PDF…", async () => {
      const preserveLinks = preserveLinksEl?.checked !== false;
      const result = await sendMessage<{ status: string; preserveLinks: boolean }>({
        type: "SAVE_WEBPAGE_PDF",
        preserveLinks,
      });
      setStatus(
        preserveLinks
          ? `Webpage PDF (${result.status}) — links preserved`
          : `Webpage PDF: ${result.status}`
      );
    })
  );

  $("btn-workspace").addEventListener("click", () => {
    setStatus("Opening workspace…");
    void sendMessage({ type: "OPEN_EDITOR" });
    window.close();
  });

  $("btn-copy").addEventListener("click", () =>
    run("Copying…", async () => {
      if (!lastCapture) return;
      await sendMessage({ type: "COPY_IMAGE", captureId: lastCapture.captureId });
      setStatus("Copied to clipboard");
    })
  );

  $("btn-save").addEventListener("click", () =>
    run("Saving…", async () => {
      if (!lastCapture) return;
      const settings = await sendMessage<{
        settings: {
          saveAsDialog: boolean;
          filenameTemplate: string;
        };
      }>({ type: "GET_SETTINGS" });
      const filename = buildFilename({
        template: settings.settings.filenameTemplate,
        title: lastCapture.pageTitle,
        url: lastCapture.url,
        width: lastCapture.width,
        height: lastCapture.height,
        extension: "png",
      });
      await sendMessage({
        type: "SAVE_IMAGE",
        options: {
          captureId: lastCapture.captureId,
          format: "png",
          quality: 100,
          scale: 100,
          filename,
          saveAs: settings.settings.saveAsDialog,
          includeMetadata: false,
        },
      });
      setStatus("Saved");
    })
  );

  $("btn-add").addEventListener("click", () =>
    run("Adding to document…", async () => {
      if (!lastCapture) return;
      const summary = await sendMessage<{
        documentId: string;
        title: string;
        captureCount: number;
      }>({
        type: "ADD_TO_DOCUMENT",
        captureId: lastCapture.captureId,
      });
      setStatus(`Added to ${summary.title}`);
      await refreshDocSummary();
    })
  );

  $("btn-edit").addEventListener("click", () => {
    if (!lastCapture) return;
    setStatus("Opening editor…");
    void sendMessage({
      type: "OPEN_EDITOR",
      captureId: lastCapture.captureId,
    });
    window.close();
  });

  $("btn-options").addEventListener("click", () => {
    void browser.runtime.openOptionsPage();
  });

  void refreshDocSummary();
}

try {
  (window as unknown as { __PS_BOOT?: boolean }).__PS_BOOT = true;
  bind();
} catch (err) {
  document.body.textContent =
    "22Shot popup failed to start: " +
    (err instanceof Error ? err.message : String(err));
}
