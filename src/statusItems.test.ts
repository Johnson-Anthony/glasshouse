// The status bar's items as a setting: a lean bar for new users, every
// item they had for settings saved before the setting, and what each item
// needs fetched.
import { describe, expect, it } from "vitest";
import { STATUS_DEFAULTS, STATUS_ITEMS, STATUS_LEGACY, loadStatusItems, ordered, statusNeeds, withItem } from "./statusItems";

describe("loadStatusItems", () => {
  it("gives new users items, size and free space", () => {
    expect(loadStatusItems(null)).toEqual(["items", "size", "free"]);
    expect(STATUS_DEFAULTS).toEqual(["items", "size", "free"]);
  });

  it("keeps everything the bar had for settings saved before it, without the fake ones", () => {
    const items = loadStatusItems({ theme: "gruvbox-dark" });
    expect(items).toEqual(STATUS_LEGACY);
    expect(items).toEqual(["path", "git", "items", "size", "fs", "mem", "cpu", "net", "term", "uptime", "clock"]);
  });

  it("reads saved items in the bar's order, dropping unknown and repeated ones", () => {
    expect(loadStatusItems({ statusItems: ["clock", "io", "items", 3, "clock", "free"] })).toEqual(["items", "free", "clock"]);
    expect(loadStatusItems({ statusItems: [] })).toEqual([]);
  });
});

describe("withItem", () => {
  it("shows or hides one item, keeping the order", () => {
    expect(withItem(["items", "free"], "path", true)).toEqual(["path", "items", "free"]);
    expect(withItem(["items", "free"], "free", false)).toEqual(["items"]);
    expect(withItem(["items"], "items", true)).toEqual(["items"]);
    expect(ordered(STATUS_ITEMS.map(i => i.id).reverse())).toEqual(STATUS_ITEMS.map(i => i.id));
  });
});

describe("statusNeeds", () => {
  it("polls only for the items shown", () => {
    expect(statusNeeds(STATUS_DEFAULTS)).toEqual({ system: false, net: false, clock: false });
    expect(statusNeeds(["uptime"])).toEqual({ system: true, net: false, clock: false });
    expect(statusNeeds(["mem", "net", "clock"])).toEqual({ system: true, net: true, clock: true });
  });
});
