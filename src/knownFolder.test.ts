// @vitest-environment happy-dom
// knownFolder: Go → Desktop, Documents, Downloads and Pictures ask Tauri's path
// API where the OS keeps them (OneDrive on Windows, localised XDG folders on
// Linux), and fall back to home + the English name when it has none.
import { beforeEach, describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => {
  // api.ts only calls the backend inside the app.
  (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
  return { desktopDir: vi.fn(), documentDir: vi.fn(), downloadDir: vi.fn(), pictureDir: vi.fn() };
});
vi.mock("@tauri-apps/api/path", () => path);
const core = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => core);

import { knownFolder } from "./api";

beforeEach(() => {
  vi.resetAllMocks();
  core.invoke.mockImplementation(async (cmd: string) => (cmd === "home_dir" ? "/home/me" : null));
});

describe("knownFolder", () => {
  it("asks Tauri where each folder is", async () => {
    path.desktopDir.mockResolvedValue("/home/me/Schreibtisch");
    path.documentDir.mockResolvedValue("C:\\Users\\me\\OneDrive\\Documents");
    path.downloadDir.mockResolvedValue("/home/me/Téléchargements");
    path.pictureDir.mockResolvedValue("/home/me/Bilder");
    expect(await knownFolder("Desktop")).toBe("/home/me/Schreibtisch");
    expect(await knownFolder("Documents")).toBe("C:\\Users\\me\\OneDrive\\Documents");
    expect(await knownFolder("Downloads")).toBe("/home/me/Téléchargements");
    expect(await knownFolder("Pictures")).toBe("/home/me/Bilder");
  });

  it("falls back to home + the English name when the OS has none set", async () => {
    path.desktopDir.mockRejectedValue("unknown path");
    expect(await knownFolder("Desktop")).toBe("/home/me/Desktop");
  });

  it("is null with no home folder either", async () => {
    path.pictureDir.mockRejectedValue("unknown path");
    core.invoke.mockResolvedValue(null);
    expect(await knownFolder("Pictures")).toBeNull();
  });
});
