// @vitest-environment happy-dom
// Backend errors (error.rs `AppError`): the sentence shows, the raw error
// is kept for "Show details", and the kind answers "is it taken?" and "was
// it cancelled?" without matching text.
import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => {
  // api.ts only calls the backend inside the app.
  (window as unknown as { __TAURI_INTERNALS__: object }).__TAURI_INTERNALS__ = {};
  return { invoke: vi.fn() };
});
vi.mock("@tauri-apps/api/core", () => core);

import { copyEntry, isAlreadyExists } from "./api";
import { BackendError, errDetail, errKind, errText, fromBackend } from "./errors";
import { isCancelled } from "./opStore";

const missing = {
  kind: "notFound",
  path: "/home/me/notes.txt",
  message: "Couldn't copy “notes.txt” because it isn't there anymore.",
  detail: "/home/me/notes.txt -> /tmp/notes.txt: No such file or directory (os error 2)",
};

beforeEach(() => vi.resetAllMocks());

describe("backend errors", () => {
  it("reject as an Error with the sentence for its message", async () => {
    core.invoke.mockRejectedValue(missing);
    const err = await copyEntry("/home/me/notes.txt", "/tmp/notes.txt").catch(e => e);
    expect(err).toBeInstanceOf(BackendError);
    expect(errText(err)).toBe(missing.message);
    expect(errDetail(err)).toBe(missing.detail);
    expect(errKind(err)).toBe("notFound");
    expect((err as BackendError).path).toBe("/home/me/notes.txt");
  });

  it("leave errors not converted yet as they were", async () => {
    core.invoke.mockRejectedValue("git: not a repository");
    const err = await copyEntry("/a", "/b").catch(e => e);
    expect(err).toBe("git: not a repository");
    expect(errKind(err)).toBeNull();
    expect(errDetail(err)).toBe("");
    expect(fromBackend({ message: "no kind" })).toEqual({ message: "no kind" });
  });

  it("have no details when the detail says nothing more", () => {
    expect(errDetail(new BackendError({ ...missing, detail: missing.message }))).toBe("");
  });

  it("say by kind that a name is taken or an operation was cancelled", () => {
    const taken = new BackendError({ kind: "exists", path: "/d/a", message: "“a” is already there.", detail: "" });
    expect(isAlreadyExists(taken)).toBe(true);
    expect(isAlreadyExists(new BackendError(missing))).toBe(false);
    expect(isCancelled(new BackendError({ kind: "cancelled", path: null, message: "cancelled", detail: "cancelled" }))).toBe(true);
    expect(isCancelled(new BackendError(missing))).toBe(false);
  });
});
