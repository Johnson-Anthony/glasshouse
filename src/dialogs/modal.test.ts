import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdModal, isModalOpen } from "./modal";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("modal flag", () => {
  it("is open while any modal holds it", () => {
    expect(isModalOpen()).toBe(false);
    const a = holdModal();
    const b = holdModal();
    expect(isModalOpen()).toBe(true);
    a();
    vi.runAllTimers();
    expect(isModalOpen()).toBe(true);
    b();
    vi.runAllTimers();
    expect(isModalOpen()).toBe(false);
  });

  it("stays open for the rest of the event that closed the modal", async () => {
    const release = holdModal();
    release();
    // React flushes a close in a microtask; later listeners of the same
    // keypress run after it, before any timer.
    await Promise.resolve();
    expect(isModalOpen()).toBe(true);
    vi.runAllTimers();
    expect(isModalOpen()).toBe(false);
  });

  it("ignores a second release", () => {
    const keep = holdModal();
    const release = holdModal();
    release();
    release();
    vi.runAllTimers();
    expect(isModalOpen()).toBe(true);
    keep();
    vi.runAllTimers();
    expect(isModalOpen()).toBe(false);
  });
});
