// @vitest-environment happy-dom
// useLook in a DOM: the theme follows the OS's light/dark and contrast
// settings as they change, the look reaches <html>, and a custom theme's
// draft shows while it's edited.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOOK_DEFAULTS, type LookState } from "./look";
import { THEME_TOKENS, type ThemeToken } from "./themes";
import { resetUserThemesForTest, setDraft } from "./userThemes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A matchMedia whose answers the test sets, firing "change" like a browser.
const os = { dark: false, contrast: false };
const listeners = new Map<string, Set<() => void>>();
const answer = (q: string) => (q.includes("color-scheme: dark") ? os.dark : q.includes("prefers-contrast: more") ? os.contrast : false);
function setOs(next: Partial<typeof os>) {
  const before = { ...os };
  Object.assign(os, next);
  for (const [q, ls] of listeners) if (answer(q) !== (q.includes("dark") ? before.dark : before.contrast)) ls.forEach(l => l());
}
const realMatchMedia = window.matchMedia;
beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    get matches() { return answer(q); },
    media: q,
    addEventListener: (_: string, l: () => void) => { if (!listeners.has(q)) listeners.set(q, new Set()); listeners.get(q)!.add(l); },
    removeEventListener: (_: string, l: () => void) => { listeners.get(q)?.delete(l); },
  })) as unknown as typeof window.matchMedia;
});
afterAll(() => { window.matchMedia = realMatchMedia; });

// Imported after matchMedia is in place (useLook reads it when loaded).
let useLook: typeof import("./useLook").useLook;
beforeAll(async () => { ({ useLook } = await import("./useLook")); });

let host: HTMLDivElement;
let root: Root;
function Probe({ look }: { look: LookState }) {
  useLook(look);
  return null;
}
const render = (look: LookState) => act(() => root.render(<Probe look={look} />));
const html = () => document.documentElement;

beforeEach(() => {
  Object.assign(os, { dark: false, contrast: false });
  resetUserThemesForTest();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("useLook", () => {
  it("follows the OS's light and dark, and asks for more contrast, with System", () => {
    render({ ...LOOK_DEFAULTS, lightTheme: "solarized-light", darkTheme: "nord" });
    expect(html().dataset.theme).toBe("solarized-light");
    expect(html().dataset.scheme).toBe("light");
    act(() => setOs({ dark: true }));
    expect(html().dataset.theme).toBe("nord");
    expect(html().dataset.scheme).toBe("dark");
    act(() => setOs({ contrast: true }));
    expect(html().dataset.theme).toBe("high-contrast-dark");
    act(() => setOs({ dark: false, contrast: false }));
    expect(html().dataset.theme).toBe("solarized-light");
  });

  it("keeps a fixed theme whatever the OS says", () => {
    render({ ...LOOK_DEFAULTS, theme: "dracula" });
    act(() => setOs({ dark: false }));
    expect(html().dataset.theme).toBe("dracula");
  });

  it("sets the look's attributes and properties on <html>, and drops an accent when unset", () => {
    render({ ...LOOK_DEFAULTS, theme: "nord", iconSet: "nerd", zebra: true, fontSize: 15, accent: "#ff8800" });
    expect(html().dataset.icons).toBe("nerd");
    expect(html().dataset.zebra).toBe("on");
    expect(html().style.getPropertyValue("--fs-base")).toBe("15px");
    expect(html().style.getPropertyValue("--accent")).toBe("#ff8800");
    render({ ...LOOK_DEFAULTS, theme: "nord" });
    expect(html().style.getPropertyValue("--accent")).toBe("");
  });

  it("shows the editor's draft while there is one", () => {
    render({ ...LOOK_DEFAULTS, theme: "nord" });
    const colors = Object.fromEntries(THEME_TOKENS.map(k => [k, "#ffffff"])) as Record<ThemeToken, string>;
    act(() => setDraft({ id: "", name: "draft", scheme: "light", colors }));
    expect(html().dataset.theme).toBe("user-draft");
    expect(html().dataset.scheme).toBe("light");
    expect(document.getElementById("glasshouse-user-themes")?.textContent).toContain('[data-theme="user-draft"]');
    act(() => setDraft(null));
    expect(html().dataset.theme).toBe("nord");
  });
});
