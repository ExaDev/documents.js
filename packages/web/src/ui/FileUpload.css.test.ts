import { describe, expect, it } from "vitest";

import { mountWithClassName } from "../test/cssRule";
import { dropzoneContent } from "./FileUpload.css";

describe("dropzoneContent", () => {
  it("disables pointer events so clicks/drags reach the underlying Dropzone, not this label", () => {
    const { element, cleanup } = mountWithClassName(dropzoneContent);
    expect(getComputedStyle(element).pointerEvents).toBe("none");
    cleanup();
  });
});
