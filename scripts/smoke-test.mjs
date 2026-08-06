/**
 * 22Shot smoke tests — no browser required for most checks.
 * Run: node scripts/smoke-test.mjs
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "fs";
import { dirname, join, relative } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? `: ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

function read(p) {
  return readFileSync(p, "utf8");
}

function htmlIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\bid=["']([^"']+)["']/g)) ids.add(m[1]);
  return ids;
}

function jsReferencedIds(ts) {
  const ids = new Set();
  for (const m of ts.matchAll(/\$\(["']([^"']+)["']\)/g)) ids.add(m[1]);
  for (const m of ts.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
    ids.add(m[1]);
  }
  for (const m of ts.matchAll(/querySelector\(\s*["']#([^"']+)["']\s*\)/g)) {
    ids.add(m[1]);
  }
  return ids;
}

function walkJs(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkJs(p, out);
    else if (name.endsWith(".js") && !name.endsWith(".map")) out.push(p);
  }
  return out;
}

// ─── 1. Build artifacts ─────────────────────────────────────────────
section("Build artifacts");
const manifestPath = join(dist, "manifest.json");
ok("dist/manifest.json exists", existsSync(manifestPath));
const manifest = JSON.parse(read(manifestPath));
ok("MV3", manifest.manifest_version === 3);
ok("background type module", manifest.background?.type === "module");
ok(
  "background script listed",
  Array.isArray(manifest.background?.scripts) &&
    manifest.background.scripts.includes("background/background.js")
);

const requiredFiles = [
  "background/background.js",
  "popup/popup.html",
  "popup/popup.js",
  "popup/popup.css",
  "popup/popup-boot.js",
  "options/options.html",
  "options/options.js",
  "options/options.css",
  "editor/editor.html",
  "editor/editor.js",
  "editor/editor.css",
  "content/content-bridge.js",
  "capture/capture-worker.html",
  "capture/capture-worker.js",
  "icons/icon-16.png",
  "icons/icon-48.png",
  "icons/icon-96.png",
];
for (const f of requiredFiles) {
  ok(`file ${f}`, existsSync(join(dist, f)));
}

const bgSrc = read(join(dist, "background/background.js"));
ok("background is ESM (has import)", /^\s*import\s/m.test(bgSrc));
ok(
  "background does not statically import pdf-lib",
  !bgSrc.includes('from "pdf-lib"') && !bgSrc.includes("from 'pdf-lib'")
);
ok(
  "background lazy-loads pdf export",
  bgSrc.includes("pdf-export") || bgSrc.includes("exportDocumentPdf")
);

// Resolve relative imports from background.js
const importRe = /from\s+["'](\.[^"']+)["']/g;
const missingImports = [];
const seen = new Set();
function resolveImports(file) {
  if (seen.has(file) || !existsSync(file)) return;
  seen.add(file);
  const src = read(file);
  let m;
  while ((m = importRe.exec(src))) {
    let spec = m[1];
    if (!spec.endsWith(".js")) spec += ".js";
    const target = join(dirname(file), spec);
    if (!existsSync(target)) missingImports.push(`${relative(dist, file)} → ${spec}`);
    else resolveImports(target);
  }
}
resolveImports(join(dist, "background/background.js"));
ok("background ESM import graph resolves", missingImports.length === 0, missingImports.join("; "));

const rootChunks = readdirSync(dist).filter((n) =>
  /^(chunk|pdf-export)-.*\.js$/.test(n)
);
ok("code-split chunks present in dist", rootChunks.length >= 3, `found ${rootChunks.length}`);

const bgSize = statSync(join(dist, "background/background.js")).size;
ok("background.js stays lean (<120KB)", bgSize < 120_000, `${bgSize} bytes`);

const editorSrc = read(join(dist, "editor/editor.js"));
ok(
  "editor does not dynamic-import a separate indexeddb chunk",
  !/import\(\s*["'][^"']*indexeddb[^"']*["']\s*\)/.test(editorSrc)
);
const distRootJs = readdirSync(dist).filter((n) => n.endsWith(".js"));
ok(
  "dist root has ESM chunks for background",
  distRootJs.some((n) => n.startsWith("chunk-")) ||
    distRootJs.some((n) => n.startsWith("pdf-export-")),
  distRootJs.slice(0, 8).join(", ")
);

// ─── 2. HTML ↔ JS wiring ────────────────────────────────────────────
section("Popup HTML ↔ JS wiring");
const popupHtmlIds = htmlIds(read(join(root, "src/popup/popup.html")));
const popupJsIds = jsReferencedIds(read(join(root, "src/popup/popup.ts")));
const popupRequired = [
  "btn-visible",
  "btn-region",
  "btn-fullpage",
  "btn-element",
  "btn-pdf",
  "btn-workspace",
  "btn-copy",
  "btn-save",
  "btn-add",
  "btn-edit",
  "btn-options",
  "preserve-links",
  "status",
  "result",
  "preview",
  "doc-summary",
];
for (const id of popupRequired) {
  ok(`popup #${id} in HTML`, popupHtmlIds.has(id));
  ok(`popup #${id} in TS`, popupJsIds.has(id));
}

section("Options HTML ↔ JS wiring");
const optionsHtmlIds = htmlIds(read(join(root, "src/options/options.html")));
const optionsJsIds = jsReferencedIds(read(join(root, "src/options/options.ts")));
const optionsRequired = [
  "form",
  "filenamePreset",
  "filenameTemplate",
  "fixedElementMode",
  "includeLazyContent",
  "maxCaptureHeightCss",
  "jpgQuality",
  "webpQuality",
  "webpLossless",
  "saveAsDialog",
  "debugMode",
  "preservePdfLinks",
  "btn-hosts",
  "status",
];
for (const id of optionsRequired) {
  ok(`options #${id} in HTML`, optionsHtmlIds.has(id));
  ok(`options #${id} in TS`, optionsJsIds.has(id));
}

section("Editor HTML ↔ JS wiring");
const editorHtmlIds = htmlIds(read(join(root, "src/editor/editor.html")));
const editorJsIds = jsReferencedIds(read(join(root, "src/editor/editor.ts")));
const editorRequired = [
  "canvas",
  "btn-undo",
  "btn-redo",
  "btn-zoom-in",
  "btn-zoom-out",
  "btn-zoom-fit",
  "btn-zoom-label",
  "btn-copy",
  "btn-save",
  "btn-export-pdf",
  "btn-nav-save",
  "btn-new-doc",
  "btn-apply-name",
  "btn-delete-selected",
  "btn-delete-all",
  "select-all-pages",
  "page-list",
  "doc-title",
  "name-preset",
  "export-dialog",
  "export-form",
  "export-format",
  "export-filename",
  "page-size",
  "orientation",
  "margins",
  "image-fit",
  "image-align",
  "show-page-breaks",
  "preserve-pdf-links",
  "nav-resizer",
  "empty",
  "dims",
  "status",
];
for (const id of editorRequired) {
  ok(`editor #${id} in HTML`, editorHtmlIds.has(id));
  ok(`editor #${id} in TS`, editorJsIds.has(id));
}

// Tool buttons use data-tool
const toolButtons = [
  ...read(join(root, "src/editor/editor.html")).matchAll(
    /data-tool=["']([^"']+)["']/g
  ),
].map((m) => m[1]);
ok("editor has tool buttons", toolButtons.length >= 8, toolButtons.join(","));
ok(
  "editor binds .tool clicks",
  read(join(root, "src/editor/editor.ts")).includes('querySelectorAll(".tool")') ||
    read(join(root, "src/editor/editor.ts")).includes("data-tool")
);

// ─── 3. Message handler coverage ────────────────────────────────────
section("Background + content message handlers");
const messagesTs = read(join(root, "src/shared/messages.ts"));
const bgTs = read(join(root, "src/background/background.ts"));
const contentTs = read(join(root, "src/content/content-bridge.ts"));

// Split RequestMessage vs ContentCommand by section markers in messages.ts
const reqPart = messagesTs.slice(
  0,
  messagesTs.indexOf("export type ContentCommand")
);
const cmdPart = messagesTs.slice(messagesTs.indexOf("export type ContentCommand"));
const requestTypes = [
  ...new Set([...reqPart.matchAll(/type:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1])),
];
const contentCommands = [
  ...new Set([...cmdPart.matchAll(/type:\s*"([A-Z0-9_]+)"/g)].map((m) => m[1])),
];
const bgHandled = new Set(
  [...bgTs.matchAll(/case\s+"([A-Z0-9_]+)"/g)].map((m) => m[1])
);
// Fire-and-forget / no-op content→bg types that need no background work
const bgOptional = new Set([
  "CONTENT_READY",
  "PAGE_METRICS",
  "SCROLLABLE_FOUND",
  "CAPTURE_PROGRESS",
]);
for (const t of requestTypes) {
  if (bgOptional.has(t)) continue;
  ok(`background handles ${t}`, bgHandled.has(t));
}
for (const t of contentCommands) {
  ok(
    `content handles ${t}`,
    contentTs.includes(`"${t}"`) || contentTs.includes(`'${t}'`)
  );
}

// ─── 4. Pure unit tests (dynamic import from src via esbuild bundle) ─
section("Unit: filename / safe-url / stitch helpers");

async function loadModules() {
  const esbuild = await import("esbuild");
  const outfile = join(root, "artifacts", "smoke-bundle.mjs");
  const { mkdirSync } = await import("fs");
  mkdirSync(join(root, "artifacts"), { recursive: true });

  // Minimal browser shim for modules that touch it at import time
  const shim = `
    globalThis.browser = globalThis.browser || {
      runtime: { id: "22shot@nightforcex", getURL: (p) => "moz-extension://test/" + p },
      storage: {
        local: {
          _data: {},
          async get(key) {
            if (typeof key === "string") return { [key]: this._data[key] };
            return { ...this._data };
          },
          async set(obj) { Object.assign(this._data, obj); },
        },
        onChanged: { addListener() {} },
      },
    };
  `;
  await esbuild.build({
    stdin: {
      contents: `
        ${shim}
        export { buildFilename, sanitizeDownloadFilename, FILENAME_PRESETS, sanitizeFilename } from ${JSON.stringify(join(root, "src/shared/filename.ts").replace(/\\/g, "/"))};
        export { isSafeHref, resolveSafeHref } from ${JSON.stringify(join(root, "src/shared/safe-url.ts").replace(/\\/g, "/"))};
        export { computeScrollStops } from ${JSON.stringify(join(root, "src/capture/stitcher.ts").replace(/\\/g, "/"))};
        export { assertMessageShape, assertSenderAllowed, CONTENT_ALLOWED_TYPES, sanitizeSettingsPatch } from ${JSON.stringify(join(root, "src/shared/message-guard.ts").replace(/\\/g, "/"))};
        export { getSettings, setSettings, peekSettings } from ${JSON.stringify(join(root, "src/storage/settings.ts").replace(/\\/g, "/"))};
        export { blobDimensions } from ${JSON.stringify(join(root, "src/capture/image-utils.ts").replace(/\\/g, "/"))};
      `,
      resolveDir: root,
      sourcefile: "smoke-entry.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    write: true,
  });
  return import(pathToFileURL(outfile).href + `?t=${Date.now()}`);
}

const mod = await loadModules();

{
  const name = mod.buildFilename({
    template: "{website} - {place} - {date}",
    title: "Hello/World?",
    url: "https://example.com/docs/guide",
    width: 100,
    height: 200,
    extension: "png",
    when: new Date("2026-08-05T15:30:00Z"),
  });
  ok("buildFilename produces .png", name.endsWith(".png"));
  ok("buildFilename sanitizes illegal chars", !/[<>:"/\\|?*]/.test(name.replace(/\.png$/, "")));
  ok("buildFilename includes website token", /example\.com/i.test(name));
}

{
  const safe = mod.sanitizeDownloadFilename("../evil/../../x.png", "png");
  ok("sanitizeDownloadFilename strips path", !safe.includes("..") && !safe.includes("/"));
  ok("sanitizeDownloadFilename keeps ext", safe.toLowerCase().endsWith(".png"));
}

ok("FILENAME_PRESETS non-empty", mod.FILENAME_PRESETS.length >= 5);

ok("isSafeHref http", mod.isSafeHref("https://example.com/a"));
ok("isSafeHref mailto", mod.isSafeHref("mailto:a@b.com"));
ok("rejects javascript:", !mod.isSafeHref("javascript:alert(1)"));
ok("rejects data:", !mod.isSafeHref("data:text/html,hi"));
ok("rejects protocol-relative", !mod.isSafeHref("//evil.com"));
ok(
  "resolveSafeHref relative",
  mod.resolveSafeHref("/path", "https://example.com") === "https://example.com/path"
);

{
  const stops = mod.computeScrollStops(3000, 800, 80);
  ok("computeScrollStops starts at 0", stops[0] === 0);
  ok("computeScrollStops ends near bottom", stops[stops.length - 1] === 3000 - 800);
  ok("computeScrollStops multiple stops", stops.length >= 3);
}

{
  let threw = false;
  try {
    mod.assertMessageShape({ type: "SAVE_IMAGE", options: { captureId: "x", format: "png", quality: 90, scale: 100, filename: "a.png", saveAs: true } });
  } catch {
    threw = true;
  }
  ok("assertMessageShape accepts valid SAVE_IMAGE", !threw);

  threw = false;
  try {
    mod.assertMessageShape({ type: "SAVE_IMAGE", options: { format: "png" } });
  } catch {
    threw = true;
  }
  ok("assertMessageShape rejects bad SAVE_IMAGE", threw);

  threw = false;
  try {
    mod.assertSenderAllowed("CAPTURE_VISIBLE", {
      id: "22shot@nightforcex",
      url: "https://example.com/",
      tab: { id: 1 },
    });
  } catch {
    threw = true;
  }
  ok("content cannot send CAPTURE_VISIBLE", threw);

  threw = false;
  try {
    mod.assertSenderAllowed("REGION_SELECTED", {
      id: "22shot@nightforcex",
      url: "https://example.com/",
      tab: { id: 1 },
    });
  } catch {
    threw = true;
  }
  ok("content can send REGION_SELECTED", !threw);
}

{
  const s1 = await mod.getSettings();
  ok("getSettings returns defaults", s1.preservePdfLinks === true);
  ok("peekSettings warm", mod.peekSettings()?.preservePdfLinks === true);
  const s2 = await mod.setSettings({ debugMode: true, jpgQuality: 80 });
  ok("setSettings patch", s2.debugMode === true && s2.jpgQuality === 80);
  const s3 = await mod.getSettings();
  ok("settings cache hit", s3.jpgQuality === 80);
  await mod.setSettings({ debugMode: false, jpgQuality: 95 });
}

{
  // Minimal 1×1 PNG
  const png = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00,
    0x0c, 0x49, 0x44, 0x41, 0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
    0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe, 0xd4, 0xef, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  const dims = await mod.blobDimensions(new Blob([png], { type: "image/png" }));
  ok("blobDimensions reads PNG IHDR", dims.width === 1 && dims.height === 1);
}

// ─── 5. Popup/options/editor boot scripts parse ─────────────────────
section("Built scripts parse");
const require = createRequire(import.meta.url);
void require;
for (const file of [
  "popup/popup.js",
  "options/options.js",
  "content/content-bridge.js",
]) {
  const p = join(dist, file);
  try {
    // Syntax check via Function for IIFE bundles (don't execute)
    const src = read(p);
    // eslint-disable-next-line no-new-func
    new Function(src);
    ok(`${file} parses`, true);
  } catch (err) {
    ok(`${file} parses`, false, err instanceof Error ? err.message : String(err));
  }
}

// Editor + background are ESM — check via dynamic import of background graph entry
try {
  // Importing background would register listeners; just parse with node --check via child
  const { spawnSync } = await import("child_process");
  const r = spawnSync(process.execPath, ["--check", join(dist, "background/background.js")], {
    encoding: "utf8",
  });
  ok("background.js --check", r.status === 0, r.stderr || r.stdout);
  const r2 = spawnSync(process.execPath, ["--check", join(dist, "editor/editor.js")], {
    encoding: "utf8",
  });
  ok("editor.js --check", r2.status === 0, r2.stderr || r2.stdout);
} catch (err) {
  ok("ESM syntax check", false, err instanceof Error ? err.message : String(err));
}

// ─── Summary ────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log("All smoke checks passed.");
