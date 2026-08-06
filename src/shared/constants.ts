export const EXTENSION_NAME = "22Shot";

export const DEFAULT_FILENAME_TEMPLATE = "{title} - {date} {time}";

export const MAX_SAFE_CANVAS_PIXELS = 268_435_456; // ~16384²
export const MAX_SAFE_DIMENSION = 32_767;
export const MAX_CAPTURE_HEIGHT_CSS = 100_000;
export const LAZY_STABLE_CHECKS = 3;
export const SEGMENT_OVERLAP_PX = 40;

export const FIXED_ELEMENT_MODE = {
  AUTO: "auto",
  KEEP: "keep",
  HIDE: "hide",
} as const;

export type FixedElementMode =
  (typeof FIXED_ELEMENT_MODE)[keyof typeof FIXED_ELEMENT_MODE];

export const PAGE_SIZES = {
  letter: { widthIn: 8.5, heightIn: 11, label: "Letter" },
  legal: { widthIn: 8.5, heightIn: 14, label: "Legal" },
  a4: { widthIn: 8.27, heightIn: 11.69, label: "A4" },
  a3: { widthIn: 11.69, heightIn: 16.54, label: "A3" },
  tabloid: { widthIn: 11, heightIn: 17, label: "Tabloid" },
} as const;

export type PageSizeKey = keyof typeof PAGE_SIZES | "automatic" | "image";

export const MARGIN_PRESETS = {
  none: 0,
  small: 0.25,
  medium: 0.5,
  large: 1,
} as const;

export type MarginPreset = keyof typeof MARGIN_PRESETS | "custom";
