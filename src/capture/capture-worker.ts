/**
 * Extension page used for heavy stitch jobs when the event page may suspend.
 * Full-page capture currently stitches in the background via OffscreenCanvas;
 * this page can be opened to keep a living context and run stitchVertical.
 */
import { stitchVertical, type StitchSegment } from "./stitcher";

browser.runtime.onMessage.addListener((message: {
  type: string;
  segments?: StitchSegment[];
  width?: number;
  height?: number;
}) => {
  if (message.type !== "WORKER_STITCH") return;
  return (async () => {
    const result = await stitchVertical(
      message.segments || [],
      message.width || 1,
      message.height || 1
    );
    return {
      ok: true,
      data: { width: result.width, height: result.height, byteLength: result.blob.size },
    };
  })();
});
