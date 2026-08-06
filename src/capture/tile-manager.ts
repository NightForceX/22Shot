import { canAllocateBitmap } from "./image-utils";
import { computeScrollStops } from "./stitcher";

export interface TilePlan {
  xStops: number[];
  yStops: number[];
  totalWidthCss: number;
  totalHeightCss: number;
  viewportWidth: number;
  viewportHeight: number;
  estimatedDeviceWidth: number;
  estimatedDeviceHeight: number;
  tooLarge: boolean;
  reason?: string;
  bytes: number;
}

export function planTiles(options: {
  scrollWidth: number;
  scrollHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  maxHeightCss?: number;
}): TilePlan {
  const totalHeightCss = Math.min(
    options.scrollHeight,
    options.maxHeightCss ?? options.scrollHeight
  );
  const totalWidthCss = options.scrollWidth;
  const xStops = computeScrollStops(totalWidthCss, options.viewportWidth);
  const yStops = computeScrollStops(totalHeightCss, options.viewportHeight);
  const dpr = options.devicePixelRatio || 1;
  const estimatedDeviceWidth = Math.round(totalWidthCss * dpr);
  const estimatedDeviceHeight = Math.round(totalHeightCss * dpr);
  const check = canAllocateBitmap(
    estimatedDeviceWidth,
    estimatedDeviceHeight
  );
  return {
    xStops,
    yStops,
    totalWidthCss,
    totalHeightCss,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
    estimatedDeviceWidth,
    estimatedDeviceHeight,
    tooLarge: !check.ok,
    reason: check.reason,
    bytes: check.bytes,
  };
}
