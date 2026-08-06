import { getSettings, peekSettings } from "../storage/settings";

let forcedDebug = false;

export function setDebugForced(value: boolean): void {
  forcedDebug = value;
}

function write(message: string, data?: unknown): void {
  if (data !== undefined) {
    console.debug(`[22Shot] ${message}`, data);
  } else {
    console.debug(`[22Shot] ${message}`);
  }
}

export async function debugLog(message: string, data?: unknown): Promise<void> {
  if (forcedDebug) {
    write(message, data);
    return;
  }
  const peeked = peekSettings();
  if (peeked) {
    if (peeked.debugMode) write(message, data);
    return;
  }
  try {
    const settings = await getSettings();
    if (settings.debugMode) write(message, data);
  } catch {
    // ignore
  }
}

/** Prefer on hot loops — no await when settings are warm and debug is off. */
export function debugLogSync(message: string, data?: unknown): void {
  if (forcedDebug) {
    write(message, data);
    return;
  }
  const peeked = peekSettings();
  if (peeked) {
    if (peeked.debugMode) write(message, data);
    return;
  }
  void debugLog(message, data);
}
