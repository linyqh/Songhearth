/** Platform differences the UI has to know about (shortcuts, window chrome). */

export const isWindows = /Windows/i.test(navigator.userAgent);

/** True when the platform's primary shortcut modifier (⌘ on macOS, Ctrl on Windows) is the only one held. */
export function isMod(e: KeyboardEvent): boolean {
  return isWindows ? e.ctrlKey && !e.metaKey : e.metaKey && !e.ctrlKey;
}

export const MOD_LABEL = isWindows ? "Ctrl+" : "⌘";
export const ENTER_LABEL = isWindows ? "↵" : "↩";

/** Lets CSS target the platform (opaque window background, title-bar spacing on Windows). */
export function applyPlatformAttribute(): void {
  document.documentElement.dataset.platform = isWindows ? "windows" : "macos";
}
