import { debugLogSync } from "../shared/debug";
import { blobDimensions, dataUrlToBlobAsync } from "./image-utils";

export async function captureVisibleTabPng(
  windowId?: number
): Promise<{ dataUrl: string; blob: Blob; width: number; height: number }> {
  debugLogSync("captureVisibleTab start", { windowId });
  const dataUrl =
    windowId === undefined
      ? await browser.tabs.captureVisibleTab({ format: "png" })
      : await browser.tabs.captureVisibleTab(windowId, { format: "png" });
  const blob = await dataUrlToBlobAsync(dataUrl);
  const { width, height } = await blobDimensions(blob);
  debugLogSync("captureVisibleTab complete", { width, height });
  return { dataUrl, blob, width, height };
}
