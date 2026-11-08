import { describe, expect, it } from "vitest";
import { isAlreadyExists } from "./api";
import { nameProblem, NameSet } from "./names";
import { unlessTaken } from "./transferUi";

// The backend's wording for a taken target (`no_clobber_err` in commands.rs).
// Tauri rejects with the bare string.
const taken = '"notes.txt" already exists in /home/me/docs';

describe("isAlreadyExists", () => {
  it("recognizes the backend's refusal, as a string or an Error", () => {
    expect(isAlreadyExists(taken)).toBe(true);
    expect(isAlreadyExists(new Error(taken))).toBe(true);
    expect(isAlreadyExists('"a\nb" already exists in C:\\Users\\me')).toBe(true);
  });

  it("ignores other errors", () => {
    expect(isAlreadyExists("Permission denied (os error 13)")).toBe(false);
    expect(isAlreadyExists("File exists (os error 17)")).toBe(false);
    expect(isAlreadyExists("copy failed: \"x\" already exists in /d")).toBe(false);
    expect(isAlreadyExists(undefined)).toBe(false);
  });
});

describe("unlessTaken", () => {
  it("returns null once the write succeeds", async () => {
    let ran = false;
    expect(await unlessTaken("notes.txt", async () => { ran = true; })).toBeNull();
    expect(ran).toBe(true);
  });

  it("turns the backend's refusal into the prompt's own message", async () => {
    const problem = await unlessTaken("notes.txt", () => Promise.reject(taken));
    expect(problem).toBe(nameProblem("notes.txt", new NameSet(["notes.txt"], false)));
  });

  it("lets other errors through", async () => {
    await expect(unlessTaken("x", () => Promise.reject(new Error("disk full")))).rejects.toThrow("disk full");
  });
});
