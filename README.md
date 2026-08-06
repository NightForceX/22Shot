# 22Shot

**22Shot** is a Firefox extension for capturing screenshots, editing them, building multi-page documents, and exporting PDFs — entirely on your device.

**Privacy first:** 100% local processing. No accounts, no cloud upload, no telemetry, no ads, no remote scripts, no external APIs.

<p align="center">
  <img src="icons/icon-96.png" alt="22Shot" width="96" height="96" />
</p>

## Features

- **Capture** — visible area, drag-to-select region, smart element picker, and full-page stitch
- **Sticky/fixed handling** — Auto / Keep / Hide modes so headers don’t duplicate on long pages
- **Scrollables & iframes** — inner scroll capture; best-effort iframe capture (optional host access)
- **Workspace editor** — blur, redact, arrows, lines, shapes, text, highlight, freehand draw
- **Documents** — multi-page docs with naming presets, page layout, and page breaks
- **Export** — PNG / JPEG / WebP, clipboard copy, and screenshot-document PDF (optional clickable links)
- **Save Webpage as PDF** — Firefox native print-to-PDF with real hyperlinks (not available on macOS)

## Requirements

- Desktop **Firefox 128+**
- **Node.js 20+** to build from source

## Quick start

```bash
npm install
npm run build
```

Then load the add-on in Firefox:

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Select **`manifest.json`** in the project root (or `dist/manifest.json`)
4. Click **Reload** on the add-on after every rebuild
5. Open an `http(s)` page and use the toolbar button

`npm run build` emits the loadable extension next to the root `manifest.json` (`background/`, `popup/`, `options/`, `editor/`, …) and mirrors it into `dist/`.

### Useful scripts

| Command | What it does |
|---|---|
| `npm run build` | Generate icons + bundle the extension |
| `npm start` | Build and run with `web-ext` |
| `npm run package` | Build a distributable zip under `artifacts/` |
| `npm run typecheck` | TypeScript check |
| `npm test` | Build + smoke tests + live Firefox UI tests |
| `npm run test:smoke` | Fast static/unit smoke suite |
| `npm run test:live` | Headless Firefox Selenium UI tests |

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Capture / inject the current tab after a user gesture |
| `tabs` | Titles, URLs for filenames, target the active tab |
| `scripting` | Overlay, scroll helpers, element selection |
| `downloads` | Save images and PDFs |
| `clipboardWrite` | Copy screenshots |
| `menus` | Context-menu capture commands |
| `storage` / `unlimitedStorage` | Settings + large screenshot blobs in IndexedDB |
| optional `<all_urls>` | Deeper iframe access when you grant it in Options |

## Architecture

- **Manifest V3** Firefox event page (`background.scripts`, ESM)
- Typed message protocol in `src/shared/messages.ts`
- Captures in **IndexedDB**; settings in `browser.storage.local`
- Full page: scroll → `captureVisibleTab` → crop → stitch (`OffscreenCanvas`)
- Editor stores the original bitmap + a list of edit ops; export rasterizes permanently
- Heavy PDF code (`pdf-lib`) is **lazy-loaded** so cold start stays snappy

## Capture modes

1. **Visible area** — native device pixels via `tabs.captureVisibleTab`
2. **Select area** — dimmed overlay, drag / resize / move
3. **Select element** — hover highlight, Alt+↑/↓ hierarchy
4. **Full page** — segmented scroll + stitch
5. **Scrollable element** — when the highlighted node scrolls internally
6. **Webpage PDF** — native Firefox PDF (separate from screenshot PDF)

## Test pages

Fixtures for long pages, sticky chrome, lazy load, iframes, HiDPI, etc.:

```bash
npx --yes serve test-pages -p 4173
```

See also `CHECKLIST.md` for a manual QA list.

## Firefox limitations

- Cannot reuse Firefox’s private built-in Screenshot engine
- Cross-origin / sandboxed iframes may stay inaccessible
- `tabs.saveAsPDF` is unavailable on macOS
- Restricted pages (`about:`, AMO, some privileged UI) cannot be captured
- Extremely large pages may hit canvas limits; 22Shot offers split/export options instead of crashing

## Project layout

```
src/
  background/   # messaging, capture orchestration, menus
  capture/      # visible / region / full-page / stitch
  content/      # overlay, element picker, scroll helpers
  editor/       # workspace UI + tools
  document/     # PDF layout & export
  popup/        # toolbar popup
  options/      # settings page
  shared/       # types, messages, filename, security helpers
  storage/      # IndexedDB + settings
```

## License

Source is provided as-is for local use and development.
