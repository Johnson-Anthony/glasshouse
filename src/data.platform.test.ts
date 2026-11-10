import { describe, expect, it } from "vitest";
import {
  CONTEXT_BREADCRUMB,
  CONTEXT_EMPTY,
  CONTEXT_FILE,
  CONTEXT_SIDEBAR,
  CONTEXT_SIDEBAR_DRIVE,
  CONTEXT_SIDEBAR_FOLDER,
  CONTEXT_SIDEBAR_REMOTE,
  CONTEXT_TAB,
  MENUS,
  stripWinOnly,
  type MenuItemDef,
} from "./data";
import { IS_WINDOWS } from "./platform";

const item = (label: string, action?: string): MenuItemDef =>
  action ? { kind: "item", label, action } : { kind: "item", label };
const sep: MenuItemDef = { kind: "sep" };
const sub = (label: string, children: MenuItemDef[]): MenuItemDef => ({ kind: "sub", label, children });

function labels(list: MenuItemDef[]): string[] {
  return list.map(it =>
    it.kind === "sep" ? "—" : it.kind === "sub" ? `${it.label}[${labels(it.children).join(",")}]` : "label" in it ? it.label : it.kind,
  );
}

describe("stripWinOnly", () => {
  it("removes Windows-only items at any depth", () => {
    const menu = [item("Open"), item("Copy as UNC"), sub("Copy →", [item("Copy Path"), item("Copy as WSL Path")])];
    stripWinOnly(menu);
    expect(labels(menu)).toEqual(["Open", "Copy →[Copy Path]"]);
  });

  it("renames Explorer wording but keeps dispatching the original label", () => {
    const menu = [item("Reveal in Explorer")];
    stripWinOnly(menu);
    expect(menu).toEqual([{ kind: "item", label: "Reveal in File Manager", action: "Reveal in Explorer" }]);
    // An item that already has an action keeps it untouched.
    const routed = [item("Reveal in Explorer", "Something Else")];
    stripWinOnly(routed);
    expect(routed).toEqual([{ kind: "item", label: "Reveal in Explorer", action: "Something Else" }]);
  });

  it("drops separators left leading, trailing or doubled", () => {
    const menu = [
      item("Paste as Shortcut"), sep,
      item("A"), sep, item("Verify Signature…"), sep, item("B"),
      sep, item("Go to WSL Distro…"),
    ];
    stripWinOnly(menu);
    expect(labels(menu)).toEqual(["A", "—", "B"]);
    const onlySeps = [sep, item("Copy as UNC"), sep];
    stripWinOnly(onlySeps);
    expect(onlySeps).toEqual([]);
  });

  it("is idempotent", () => {
    const menu = [item("A"), sep, item("Reveal in Explorer"), sub("S", [item("Copy as UNC"), item("B")])];
    stripWinOnly(menu);
    const once = structuredClone(menu);
    stripWinOnly(menu);
    expect(menu).toEqual(once);
  });
});

describe.skipIf(IS_WINDOWS)("menus off Windows", () => {
  const TREES: Record<string, MenuItemDef[]> = {
    ...Object.fromEntries(Object.entries(MENUS).map(([k, v]) => [`menu ${k}`, v])),
    CONTEXT_FILE, CONTEXT_SIDEBAR, CONTEXT_SIDEBAR_FOLDER,
    CONTEXT_SIDEBAR_DRIVE, CONTEXT_SIDEBAR_REMOTE, CONTEXT_TAB, CONTEXT_BREADCRUMB, CONTEXT_EMPTY,
  };

  function walk(list: MenuItemDef[], visit: (list: MenuItemDef[]) => void): void {
    visit(list);
    for (const it of list) if (it.kind === "sub") walk(it.children, visit);
  }

  it("were stripped when data.ts loaded", () => {
    const winOnly = ["Copy Path (WSL)", "Copy as WSL Path", "Copy as UNC", "Go to WSL Distro…", "Paste as Shortcut", "Verify Signature…"];
    for (const [name, tree] of Object.entries(TREES)) {
      walk(tree, list => {
        for (const it of list) {
          if (it.kind === "item" || it.kind === "sub") {
            expect(winOnly, `${name}: ${it.label}`).not.toContain(it.label);
            expect(it.label, name).not.toBe("Reveal in Explorer");
          }
        }
      });
    }
  });

  it("have no stray separators or empty submenus", () => {
    for (const [name, tree] of Object.entries(TREES)) {
      walk(tree, list => {
        list.forEach((it, i) => {
          if (it.kind === "sep") {
            expect(i, `${name}: leading/trailing separator`).toBeGreaterThan(0);
            expect(i, `${name}: leading/trailing separator`).toBeLessThan(list.length - 1);
            expect(list[i - 1].kind, `${name}: doubled separator`).not.toBe("sep");
          }
          if (it.kind === "sub") expect(it.children.length, `${name}: ${it.label}`).toBeGreaterThan(0);
        });
      });
    }
  });
});
