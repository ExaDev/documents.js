import { describe, expect, it } from "vitest";

import { mountWithClassName } from "../test/cssRule";
import { editorRow } from "./EditorPanel.css";

describe("editorRow", () => {
  it("rounds each paragraph row so the hover wash reads as a row highlight", () => {
    const { element, cleanup } = mountWithClassName(editorRow);
    expect(getComputedStyle(element).borderRadius).not.toBe("0px");
    cleanup();
  });
});
