import { describe, expect, it } from "vitest";
import { createOdg } from "./editor";

describe("OdgPage.remove", () => {
  it("splices the page out of the drawing's own document so it no longer appears in pages()", () => {
    const editor = createOdg();
    editor.addPage();
    editor.addPage();
    expect(editor.pages()).toHaveLength(2);

    const [first] = editor.pages();
    first?.remove();

    expect(editor.pages()).toHaveLength(1);
  });

  it("marks the handle removed, so any further use throws rather than silently operating on a detached element", () => {
    const editor = createOdg();
    const page = editor.addPage();
    page.remove();

    expect(() => page.shapes()).toThrow(
      "this OdgPage has been removed from the drawing and can no longer be used",
    );
    expect(() =>
      page.addRect({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 } }),
    ).toThrow(/removed/);
  });
});
