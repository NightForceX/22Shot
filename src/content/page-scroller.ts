export function waitFrames(count = 2): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const step = () => {
      left--;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export async function waitForStable(
  getSignature: () => string,
  options?: { checks?: number; intervalMs?: number; timeoutMs?: number }
): Promise<void> {
  const checks = options?.checks ?? 3;
  const intervalMs = options?.intervalMs ?? 50;
  const timeoutMs = options?.timeoutMs ?? 2500;
  const start = performance.now();
  let last = getSignature();
  let stable = 0;
  while (performance.now() - start < timeoutMs) {
    await waitFrames(1);
    await new Promise((r) => setTimeout(r, intervalMs));
    const next = getSignature();
    if (next === last) {
      stable++;
      if (stable >= checks) return;
    } else {
      stable = 0;
      last = next;
    }
  }
}

export async function scrollWindowTo(
  x: number,
  y: number,
  waitForStableRender = true
): Promise<void> {
  window.scrollTo(x, y);
  await waitFrames(2);
  if (waitForStableRender) {
    await waitForStable(
      () =>
        `${window.scrollX}|${window.scrollY}|${document.documentElement.scrollHeight}|${document.images.length}`
    );
    // Nudge lazy loaders
    await waitFrames(1);
  }
}

export function getPageMetrics() {
  const doc = document.documentElement;
  const body = document.body;
  const scrollWidth = Math.max(
    doc.scrollWidth,
    body?.scrollWidth ?? 0,
    doc.offsetWidth
  );
  const scrollHeight = Math.max(
    doc.scrollHeight,
    body?.scrollHeight ?? 0,
    doc.offsetHeight
  );
  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    scrollWidth,
    scrollHeight,
    devicePixelRatio: window.devicePixelRatio || 1,
    zoom: 1,
  };
}
