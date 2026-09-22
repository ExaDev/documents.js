import { decodePackage, resolveRelationships } from "ooxml.js";
import { describe, expect, it } from "vitest";
import {
  minimalPptxBytes,
  renamedMainPartPptxBytes,
} from "../../test-support/pptx";
import { openPptx } from "./editor";

// openPptx on a package whose presentation part is not at ppt/presentation.xml — the pptx half of ExaDev/documents.js#1339, the same gap the docx editor had. The fixture carries the identical deck minimalPptxBytes does, so these assertions are the conventional fixture's own behaviour rather than a weaker substitute.

describe("openPptx: main part named by the officeDocument relationship", () => {
  it("opens a package whose presentation is at ppt/presentation2.xml", () => {
    const editor = openPptx(renamedMainPartPptxBytes());
    expect(editor.slides()).toHaveLength(1);
  });

  it("reads the same slide size from the renamed presentation as from the conventional one", () => {
    expect(openPptx(renamedMainPartPptxBytes()).slideSize).toEqual(
      openPptx(minimalPptxBytes()).slideSize,
    );
  });

  it("adds a slide through the renamed presentation's own relationships and writes it back", () => {
    const editor = openPptx(renamedMainPartPptxBytes());
    editor.addSlide();
    const written = decodePackage(editor.toBytes());
    expect(Object.hasOwn(written.parts, "ppt/presentation2.xml")).toBe(true);
    expect(Object.hasOwn(written.parts, "ppt/presentation.xml")).toBe(false);
    expect(Object.hasOwn(written.parts, "ppt/slides/slide2.xml")).toBe(true);
    // The new slide is reachable from the part the package's own relationship names, which is what makes it a slide of this deck rather than an orphaned part.
    const rels = resolveRelationships(written, "ppt/presentation2.xml");
    expect(
      [...rels.values()].some((rel) => rel.target === "ppt/slides/slide2.xml"),
    ).toBe(true);
    expect(openPptx(editor.toBytes()).slides()).toHaveLength(2);
  });

  it("keeps the renamed presentation's own relationships part intact across a write-back", () => {
    const editor = openPptx(renamedMainPartPptxBytes());
    editor.addSlide();
    const written = decodePackage(editor.toBytes());
    expect(
      Object.hasOwn(written.parts, "ppt/_rels/presentation2.xml.rels"),
    ).toBe(true);
  });

  it("removes a slide resolved through the renamed presentation's relationships", () => {
    const editor = openPptx(renamedMainPartPptxBytes());
    const [slide] = editor.slides();
    if (slide === undefined) {
      throw new Error("expected the fixture deck to carry a slide");
    }
    slide.remove();
    const reopened = openPptx(editor.toBytes());
    expect(reopened.slides()).toHaveLength(0);
    expect(
      Object.hasOwn(
        decodePackage(editor.toBytes()).parts,
        "ppt/slides/slide1.xml",
      ),
    ).toBe(false);
  });
});
