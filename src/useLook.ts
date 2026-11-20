// The look's hooks for App: the OS's light/dark and contrast preference, the
// window theme kept in step, the maximized flag, and the attributes on
// <html>. The rules are in look.ts.

import { useEffect, useState, useSyncExternalStore } from "react";
import { onWinMaximized, winSetTheme, winTheme } from "./api";
import { LOOK_APPLIED, applyLookAttrs, lookAttrs, migrateLook, resolveTheme, themeScheme, type LookState, type OsLook } from "./look";
import { IS_WINDOWS } from "./platform";
import { getUserThemes, installUserThemeStyles, isKnownTheme, userThemeScheme, useUserThemes, DRAFT_ID } from "./userThemes";

const DARK_Q = "(prefers-color-scheme: dark)";
const CONTRAST_Q = "(prefers-contrast: more)";

// One MediaQueryList per query, kept: a list nothing holds can be garbage
// collected, and its change listener with it.
const lists = new Map<string, MediaQueryList | null>();
function media(q: string): MediaQueryList | null {
  if (!lists.has(q)) lists.set(q, typeof matchMedia === "function" ? matchMedia(q) : null);
  return lists.get(q)!;
}

// While the window theme is being handed back to the OS (below), the
// webview's prefers-color-scheme passes through light for a moment; the
// System theme mustn't follow that.
let settling = false;
const osListeners = new Set<() => void>();
let osSnap: OsLook = readOs();

function readOs(): OsLook {
  return { dark: !!media(DARK_Q)?.matches, contrast: !!media(CONTRAST_Q)?.matches };
}

function refreshOs() {
  if (settling) return;
  const next = readOs();
  if (next.dark !== osSnap.dark || next.contrast !== osSnap.contrast) {
    osSnap = next;
    osListeners.forEach(l => l());
  }
}

function subscribeOs(l: () => void) {
  if (osListeners.size === 0) {
    media(DARK_Q)?.addEventListener?.("change", refreshOs);
    media(CONTRAST_Q)?.addEventListener?.("change", refreshOs);
  }
  osListeners.add(l);
  return () => {
    osListeners.delete(l);
    if (osListeners.size === 0) {
      media(DARK_Q)?.removeEventListener?.("change", refreshOs);
      media(CONTRAST_Q)?.removeEventListener?.("change", refreshOs);
    }
  };
}

/** The OS's light/dark and contrast preference, as the webview reports it. */
export function useOsLook(): OsLook {
  return useSyncExternalStore(subscribeOs, () => osSnap, () => osSnap);
}

/** Whether this process has set the window's theme to a fixed one. */
let windowPinned = false;

/** Keeps the window's own theme (what GTK or Windows draws for it, and the
 *  webview's prefers-color-scheme) in step: the theme's scheme for a fixed
 *  theme, the OS's for System.
 *  - Windows: setTheme(null) follows the OS, and the webview with it.
 *  - Linux: tao sets GTK's dark preference from the desktop portal when the
 *    window opens and on each change, so System needs nothing unless a fixed
 *    theme was set first. Then setTheme(null) (which clears the preference)
 *    and theme(), which asks the portal, puts the OS's back. */
async function syncWindowTheme(system: boolean, scheme: "dark" | "light") {
  if (!system) {
    windowPinned = true;
    await winSetTheme(scheme);
    return;
  }
  if (!windowPinned) return;
  windowPinned = false;
  if (IS_WINDOWS) { await winSetTheme(null); return; }
  settling = true;
  try {
    await winSetTheme(null);
    const os = await winTheme();
    if (os === "dark") await winSetTheme("dark");
  } finally {
    // The webview applies the GTK change on its next turn.
    setTimeout(() => { settling = false; refreshOs(); }, 50);
  }
}

/** Applies the look to <html> and the window; returns the theme shown. */
export function useLook(look: LookState): string {
  const os = useOsLook();
  const users = useUserThemes();
  useEffect(() => installUserThemeStyles(), []);

  const themeId = users.draft ? DRAFT_ID : resolveTheme(look, os, id => isKnownTheme(id, users));
  const scheme = themeScheme(themeId, id => userThemeScheme(id, users));
  const system = look.theme === "system" && !users.draft;

  useEffect(() => {
    applyLookAttrs(document.documentElement, lookAttrs(look, themeId, scheme, IS_WINDOWS));
    window.dispatchEvent(new Event(LOOK_APPLIED));
  }, [look, themeId, scheme]);

  useEffect(() => { void syncWindowTheme(system, scheme); }, [system, scheme]);

  const [maximized, setMaximized] = useState(false);
  useEffect(() => onWinMaximized(setMaximized), []);
  useEffect(() => {
    document.documentElement.setAttribute("data-maximized", maximized ? "on" : "off");
  }, [maximized]);

  return themeId;
}

/** The saved look on <html> at once, before React's first commit. */
export function applySavedLook(): void {
  try {
    const saved = JSON.parse(localStorage.getItem("glasshouse.tweaks") || "null") as Record<string, unknown> | null;
    const look = migrateLook(saved && typeof saved === "object" ? saved : null);
    const store = { themes: getUserThemes(), draft: null };
    const id = resolveTheme(look, readOs(), x => isKnownTheme(x, store));
    applyLookAttrs(document.documentElement, lookAttrs(look, id, themeScheme(id, x => userThemeScheme(x, store)), IS_WINDOWS));
  } catch { /* App applies it on its first render */ }
}
