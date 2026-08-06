/** Display-size helpers: keep bitmap pixels separate from CSS presentation. */
export function setCanvasBitmapSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  cssMaxWidth = 900
): void {
  canvas.width = width;
  canvas.height = height;
  const scale = Math.min(1, cssMaxWidth / Math.max(1, width));
  canvas.style.width = `${Math.round(width * scale)}px`;
  canvas.style.height = `${Math.round(height * scale)}px`;
}

export function eventToBitmapPoint(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * canvas.width,
    y: ((clientY - rect.top) / rect.height) * canvas.height,
  };
}
