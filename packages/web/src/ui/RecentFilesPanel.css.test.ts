import { describe, expect, it } from "vitest";

import { mountWithClassName } from "../test/cssRule";
import { recentRow } from "./RecentFilesPanel.css";

describe("recentRow", () => {
  it("rounds each recent-file row so the hover wash reads as a row highlight", () => {
    const { element, cleanup } = mountWithClassName(recentRow);
    expect(getComputedStyle(element).borderRadius).not.toBe("0px");
    cleanup();
  });
});
