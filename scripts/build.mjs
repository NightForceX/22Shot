import * as esbuild from "esbuild";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

/** Hashed ESM split chunks emitted next to the extension root. */
function isRootChunk(name) {
  return (
    /^(chunk|pdf-export|rasterize|indexeddb|image-utils|filename|settings|debug|safe-url|constants|types|messages|message-guard)-.*\.(js|js\.map)$/.test(
      name
    ) || /^[a-z0-9]+-[A-Z0-9]+\.js(\.map)?$/i.test(name)
  );
}

function purgeRootChunks() {
  for (const name of readdirSync(root)) {
    if (isRootChunk(name)) {
      unlinkSync(join(root, name));
    }
  }
}

/**
 * Emit built extension files next to root manifest.json so about:debugging
 * works whether the user selects the project root or dist/.
 */
const extensionDirs = [
  "background",
  "popup",
  "options",
  "content",
  "editor",
  "capture",
  // ESM code-split chunks from background lazy imports (pdf-lib, etc.)
  "document",
  "shared",
  "storage",
];

const shared = {
  bundle: true,
  target: ["firefox128"],
  sourcemap: true,
  logLevel: "info",
  platform: "browser",
  splitting: false,
};

const builds = [
  {
    ...shared,
    format: "esm",
    splitting: true,
    outdir: root,
    outbase: "src",
    entryPoints: [
      "src/background/background.ts",
      "src/editor/editor.ts",
      "src/capture/capture-worker.ts",
    ],
  },
  {
    ...shared,
    format: "iife",
    outdir: root,
    outbase: "src",
    entryPoints: [
      "src/popup/popup.ts",
      "src/options/options.ts",
      "src/content/content-bridge.ts",
    ],
  },
];

function copyStaticTo(targetRoot) {
  const htmlFiles = [
    ["src/popup/popup.html", "popup/popup.html"],
    ["src/popup/popup.css", "popup/popup.css"],
    ["src/popup/popup-boot.js", "popup/popup-boot.js"],
    ["src/options/options.html", "options/options.html"],
    ["src/options/options.css", "options/options.css"],
    ["src/options/options-boot.js", "options/options-boot.js"],
    ["src/editor/editor.html", "editor/editor.html"],
    ["src/editor/editor.css", "editor/editor.css"],
    ["src/capture/capture-worker.html", "capture/capture-worker.html"],
  ];

  for (const [src, dest] of htmlFiles) {
    const from = join(root, src);
    if (!existsSync(from)) continue;
    const to = join(targetRoot, dest);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }

  const iconsDir = join(root, "icons");
  const iconsDest = join(targetRoot, "icons");
  if (existsSync(iconsDir) && iconsDir !== iconsDest) {
    mkdirSync(iconsDest, { recursive: true });
    cpSync(iconsDir, iconsDest, { recursive: true });
  }

  // Root already owns manifest.json; only write when mirroring elsewhere.
  if (targetRoot !== root) {
    const manifest = readFileSync(join(root, "manifest.json"), "utf8");
    writeFileSync(join(targetRoot, "manifest.json"), manifest);
  }
}

function syncDistMirror() {
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist, { recursive: true });

  for (const dir of extensionDirs) {
    const from = join(root, dir);
    if (existsSync(from)) {
      cpSync(from, join(dist, dir), { recursive: true });
    }
  }
  // Shared ESM chunks land at the extension root (chunk-*.js, indexeddb-*.js, …).
  for (const name of readdirSync(root)) {
    if (isRootChunk(name)) {
      cpSync(join(root, name), join(dist, name));
    }
  }
  if (existsSync(join(root, "icons"))) {
    cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });
  }
  cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
}

async function run() {
  // Ensure output dirs exist
  for (const dir of extensionDirs) {
    mkdirSync(join(root, dir), { recursive: true });
  }

  // Drop stale hashed chunks so renames / rebuilds don't leave old brands behind.
  purgeRootChunks();
  copyStaticTo(root);

  if (watch) {
    const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log("Watching…");
  } else {
    await Promise.all(builds.map((b) => esbuild.build(b)));
    copyStaticTo(root);
    syncDistMirror();
    console.log("Build complete → project root + dist/");
    console.log("Load either manifest.json or dist/manifest.json in about:debugging");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
