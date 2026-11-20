import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import type { MenuItemDef } from "./data";
import { CONTEXT_FILE } from "./data";
import {
  CHOOSE_PROGRAM, MENU_APPS_MAX, chooseApp, launchApp, openFile, openWithMenuItems, withOpenWithPath,
} from "./openWith";

vi.mock("./api");
const dialogs = vi.hoisted(() => ({
  showPrompt: vi.fn(async (): Promise<string | null> => null),
  showAlert: vi.fn(async (_o: { title?: string; message: string; variant?: string }) => {}),
  showConfirm: vi.fn(async () => false),
  showChoice: vi.fn(async (_o: { message: string; choices: Array<{ id: string; label: string }> }): Promise<string | null> => null),
  showPick: vi.fn(async (_o: { message?: string; items: string[] }): Promise<number | null> => null),
  showToast: vi.fn(),
}));
vi.mock("./dialogs/DialogHost", () => ({ dialogs }));

const P = "/w/notes.md";
const APPS: api.AppChoice[] = [
  { id: "editor.desktop", name: "Editor", is_default: true },
  { id: "codium.desktop", name: "VSCodium", is_default: false },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("openFile", () => {
  it("opens with the default app and asks nothing", async () => {
    vi.mocked(api.openWithDefaultStrict).mockResolvedValueOnce({ opened: true, file_type: "text/markdown" });
    await openFile(P);
    expect(api.openWithDefaultStrict).toHaveBeenCalledWith(P, false);
    expect(dialogs.showChoice).not.toHaveBeenCalled();
    // The demo answers null: nothing more to say.
    vi.mocked(api.openWithDefaultStrict).mockResolvedValueOnce(null);
    await openFile(P);
    expect(dialogs.showChoice).not.toHaveBeenCalled();
  });

  it("asks for the plain-text app when told to", async () => {
    vi.mocked(api.openWithDefaultStrict).mockResolvedValueOnce({ opened: true, file_type: "text/plain" });
    await openFile(P, { asText: true });
    expect(api.openWithDefaultStrict).toHaveBeenCalledWith(P, true);
  });

  it("says when no app opens the type, and offers Choose App…", async () => {
    vi.mocked(api.openWithDefaultStrict).mockResolvedValueOnce({ opened: false, file_type: "application/x-thing" });
    await openFile("/w/a.thing");
    const [opts] = dialogs.showChoice.mock.calls[0];
    expect(opts.message).toBe(`No app is set to open "a.thing" (application/x-thing).`);
    expect(opts.choices.map(c => c.label)).toEqual(["Choose App…"]);
    expect(api.openWithApps).not.toHaveBeenCalled();

    vi.mocked(api.openWithDefaultStrict).mockResolvedValueOnce({ opened: false, file_type: "" });
    dialogs.showChoice.mockResolvedValueOnce("choose");
    vi.mocked(api.openWithApps).mockResolvedValueOnce(APPS);
    dialogs.showPick.mockResolvedValueOnce(1);
    await openFile("/w/a.thing");
    expect(dialogs.showChoice.mock.calls[1][0].message).toBe(`No app is set to open "a.thing".`);
    expect(api.openWithApp).toHaveBeenCalledWith("codium.desktop", ["/w/a.thing"]);
  });

  it("shows why an app won't start, with Choose App…", async () => {
    vi.mocked(api.openWithDefaultStrict).mockRejectedValueOnce("Editor: edit isn't on PATH");
    await openFile(P);
    expect(dialogs.showChoice.mock.calls[0][0].message).toBe(`Couldn't open "notes.md": Editor: edit isn't on PATH`);
  });
});

describe("chooseApp", () => {
  it("lists the apps, the default marked, then Choose a program…", async () => {
    vi.mocked(api.openWithApps).mockResolvedValueOnce(APPS);
    dialogs.showPick.mockResolvedValueOnce(0);
    await chooseApp(P);
    const [opts] = dialogs.showPick.mock.calls[0];
    expect(opts.items).toEqual(["Editor (default)", "VSCodium", CHOOSE_PROGRAM]);
    expect(opts.message).toBe(`Open "notes.md" with:`);
    expect(api.openWithApp).toHaveBeenCalledWith("editor.desktop", [P]);
  });

  it("browses for a program, and opens the file with it", async () => {
    vi.mocked(api.openWithApps).mockResolvedValueOnce([]);
    dialogs.showPick.mockResolvedValueOnce(0);
    vi.mocked(api.pickFile).mockResolvedValueOnce("/opt/tool/run");
    await chooseApp(P);
    expect(dialogs.showPick.mock.calls[0][0].items).toEqual([CHOOSE_PROGRAM]);
    expect(dialogs.showPick.mock.calls[0][0].message).toContain("No installed app says it opens");
    expect(api.openWithProgram).toHaveBeenCalledWith("/opt/tool/run", [P]);

    // Cancelling the file dialog opens nothing.
    vi.mocked(api.openWithApps).mockResolvedValueOnce([]);
    dialogs.showPick.mockResolvedValueOnce(0);
    vi.mocked(api.pickFile).mockResolvedValueOnce(null);
    await chooseApp(P);
    expect(api.openWithProgram).toHaveBeenCalledTimes(1);
  });

  it("still offers a program when the list fails, and shows a program's failure", async () => {
    vi.mocked(api.openWithApps).mockRejectedValueOnce(new Error("HOME isn't set"));
    dialogs.showPick.mockResolvedValueOnce(0);
    vi.mocked(api.pickFile).mockResolvedValueOnce("/opt/tool/run");
    vi.mocked(api.openWithProgram).mockRejectedValueOnce("Permission denied (os error 13)");
    await chooseApp(P);
    expect(dialogs.showPick.mock.calls[0][0].message).toBe(`Couldn't list the apps for "notes.md": HOME isn't set`);
    expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({
      title: "couldn't start run", message: "Permission denied (os error 13)", variant: "error",
    }));
  });

  it("does nothing when cancelled", async () => {
    vi.mocked(api.openWithApps).mockResolvedValueOnce(APPS);
    await chooseApp(P);
    expect(api.openWithApp).not.toHaveBeenCalled();
    expect(api.pickFile).not.toHaveBeenCalled();
  });
});

it("launchApp shows why an app didn't start", async () => {
  vi.mocked(api.openWithApp).mockRejectedValueOnce("Editor: its Exec line has a field code inside quotes");
  await launchApp({ id: "editor.desktop", name: "Editor" }, [P]);
  expect(dialogs.showAlert).toHaveBeenCalledWith(expect.objectContaining({ title: "couldn't start Editor", variant: "error" }));
});

describe("the Open With submenu", () => {
  const openWith = (items: MenuItemDef[]) =>
    items.find((it): it is Extract<MenuItemDef, { kind: "sub" }> => it.kind === "sub" && it.label === "Open With →")!;

  it("lists the file's apps after Default App, then Choose App…", () => {
    const labels = openWith(CONTEXT_FILE).children.map(it => (it.kind === "item" ? it.label : it.kind));
    expect(labels.slice(0, 3)).toEqual(["Default App", "dynamic", "Choose App…"]);
  });

  it("points the list at the context menu's file, or drops it", () => {
    const filled = openWith(withOpenWithPath(CONTEXT_FILE, P)).children;
    expect(filled).toContainEqual({ kind: "dynamic", source: "open-with-apps", path: P });
    const none = openWith(withOpenWithPath(CONTEXT_FILE, undefined)).children;
    expect(none.some(it => it.kind === "dynamic")).toBe(false);
    // Nothing else changes.
    expect(withOpenWithPath(CONTEXT_FILE, P).length).toBe(CONTEXT_FILE.length);
  });

  it("turns apps into one-click rows, at most MENU_APPS_MAX", () => {
    expect(openWithMenuItems(APPS, P)).toEqual([
      { kind: "item", label: "Editor (default)", payload: { type: "open-with-app", app: { id: "editor.desktop", name: "Editor" }, path: P } },
      { kind: "item", label: "VSCodium", payload: { type: "open-with-app", app: { id: "codium.desktop", name: "VSCodium" }, path: P } },
    ]);
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `${i}.desktop`, name: `App ${i}`, is_default: false }));
    expect(openWithMenuItems(many, P)).toHaveLength(MENU_APPS_MAX);
  });
});
