import { describe, expect, it } from "vitest";
import { findStatusText } from "./findStatus";

describe("findStatusText", () => {
  it("never says searching for an empty query", () => {
    // Clearing the query mid-search cancels that search, which then never
    // clears busy itself.
    expect(findStatusText("", true, false, 0)).toBe("esc/click to close");
    expect(findStatusText("   ", true, true, 3)).toBe("esc/click to close");
  });

  it("shows searching, then the match count", () => {
    expect(findStatusText("todo", true, false, 0)).toBe("searching…");
    expect(findStatusText("todo", false, true, 1)).toBe("1 match");
    expect(findStatusText("todo", false, true, 4)).toBe("4 matches");
    expect(findStatusText("todo", false, false, 0)).toBe("esc/click to close");
  });
});
