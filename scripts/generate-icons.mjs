/**
 * Build 22Shot icons to match the white-background size grid:
 * solid orange "22" + viewfinder corners on white.
 */
import { writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const iconsDir = join(root, "icons");
const brandDir = join(root, "branding");
mkdirSync(iconsDir, { recursive: true });
mkdirSync(brandDir, { recursive: true });

const ORANGE = "#F5A623";
const BG = "#FFFFFF";

/**
 * @param {number} size
 * @param {{ tiny?: boolean }} [opts]
 */
function svgMark(size, opts = {}) {
  const tiny = !!opts.tiny;
  const pad = size * (tiny ? 0.14 : 0.16);
  const stroke = Math.max(tiny ? 1.75 : 2, size * (tiny ? 0.11 : 0.07));
  const corner = size * (tiny ? 0.3 : 0.24);
  const fontSize = size * (tiny ? 0.52 : 0.46);
  const y = size * (tiny ? 0.56 : 0.55);

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g fill="none" stroke="${ORANGE}" stroke-width="${stroke}"
     stroke-linecap="square" stroke-linejoin="miter">
    <path d="M ${pad + corner} ${pad} H ${pad} V ${pad + corner}"/>
    <path d="M ${size - pad - corner} ${pad} H ${size - pad} V ${pad + corner}"/>
    <path d="M ${pad} ${size - pad - corner} V ${size - pad} H ${pad + corner}"/>
    <path d="M ${size - pad} ${size - pad - corner} V ${size - pad} H ${size - pad - corner}"/>
  </g>
  <text x="50%" y="${y}" text-anchor="middle" dominant-baseline="middle"
    font-family="Arial Black, Impact, Arial, sans-serif" font-weight="900"
    font-size="${fontSize}" fill="${ORANGE}">22</text>
</svg>`);
}

async function writeIcon(size, tiny = false) {
  const svg = svgMark(Math.max(size * 4, 256), { tiny });
  const out = join(iconsDir, `icon-${size}.png`);
  await sharp(svg)
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

async function main() {
  const refSrc =
    "C:\\Users\\Administrator\\.cursor\\projects\\c-Users-Administrator-Projects-PageShot-Studio\\assets\\c__Users_Administrator_AppData_Roaming_Cursor_User_workspaceStorage_f70cf305d2852009f6a5b1cf33812e22_images_2026-08-06_02_47_19-Firefox_Screenshot_Addon_Dev_-_Chromium-cac2a614-982c-4f84-a268-fba5dd9459dc.png";
  if (existsSync(refSrc)) {
    copyFileSync(refSrc, join(brandDir, "icon-size-grid-reference.png"));
  }

  for (const size of [16, 32]) await writeIcon(size, true);
  for (const size of [48, 64, 96, 128, 256, 512]) await writeIcon(size, false);

  writeFileSync(join(brandDir, "22shot-icon.svg"), svgMark(512, false));
  console.log("Icons written: orange 22 + corners on white");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
