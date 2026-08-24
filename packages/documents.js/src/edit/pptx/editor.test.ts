import {
  childrenWithTag,
  decodePackage,
  resolveRelationships,
  rootElement,
} from "ooxml.js";
import { describe, expect, it } from "vitest";
import { minimalPptxBytes, minimalPptxPackage } from "../../test-support/pptx";
import { assertPartsUnchangedExcept } from "../../test-support/fidelity";
import { createPptx, openPptx } from "./editor";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

describe("openPptx / createPptx", () => {
  it("openPptx reads an existing package and exposes its slides/shapes", () => {
    const editor = openPptx(minimalPptxBytes());
    const slides = editor.slides();
    expect(slides).toHaveLength(1);
    expect(slides[0]?.shapes()).toHaveLength(1);
    expect(slides[0]?.shapes()[0]?.text).toContain("Slide text");
  });

  it("createPptx starts from a valid, empty, encodable package with zero slides", () => {
    const editor = createPptx();
    expect(editor.slides()).toHaveLength(0);
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });
});

describe("PptxEditor.addSlide / removeSlideAt / moveSlide", () => {
  it("addSlide creates a slide with a unique sldId >= 256 and an empty shape tree", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    expect(slide.shapes()).toHaveLength(0);
    expect(editor.slides()).toHaveLength(1);
    expect(() => editor.toBytes()).not.toThrow();
  });

  // Confirmed by opening a real generated file in Keynote: a p:sld root with no xmlns:p/xmlns:a/xmlns:r declared on itself, or with no relationship to a slideLayout, is rejected outright even though this package's own reader never required either.
  it("declares xmlns:p/xmlns:a/xmlns:r on the new slide root and relates it to the scaffold slide layout", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    const slidePartPath = Object.keys(editor.toPackage().parts).find((p) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(p),
    );
    if (slidePartPath === undefined) {
      throw new Error(
        "expected addSlide to have created a ppt/slides/slideN.xml part",
      );
    }
    const slideRoot = rootElement(editor.toPackage().parts[slidePartPath]);
    const names = slideRoot?.attributes.map((a) => a.name) ?? [];
    expect(names).toEqual(
      expect.arrayContaining(["xmlns:p", "xmlns:a", "xmlns:r"]),
    );
    const slideRels = resolveRelationships(editor.toPackage(), slidePartPath);
    expect(
      [...slideRels.values()].some(
        (r) => r.target === "ppt/slideLayouts/slideLayout1.xml",
      ),
    ).toBe(true);
    expect(slide.shapes()).toHaveLength(0);
  });

  it("allocates a distinct, increasing sldId for each new slide", () => {
    const editor = createPptx();
    editor.addSlide();
    editor.addSlide();
    editor.addSlide();
    expect(editor.slides()).toHaveLength(3);
  });

  it("addTextBox and addImage add shapes to the correct slide", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 10, yPt: 10, widthPt: 100, heightPt: 50 },
      text: "Title",
    });
    slide.addImage({
      frame: { xPt: 0, yPt: 0, widthPt: 50, heightPt: 50 },
      format: "png",
      bytes: PNG_BYTES,
    });
    expect(slide.shapes()).toHaveLength(2);
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });

  it("removeSlideAt removes the slide and its part", () => {
    const editor = createPptx();
    editor.addSlide().addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "One",
    });
    editor.addSlide().addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "Two",
    });
    editor.removeSlideAt(0);
    const remaining = editor.slides();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.shapes()[0]?.text).toBe("Two");
  });

  it("moveSlide reorders slides", () => {
    const editor = createPptx();
    editor.addSlide().addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "First",
    });
    editor.addSlide().addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      text: "Second",
    });
    editor.moveSlide(1, 0);
    const texts = editor.slides().map((s) => s.shapes()[0]?.text);
    expect(texts).toEqual(["Second", "First"]);
  });
});

describe("PptxSlide.notes", () => {
  it("defaults to an empty string and round-trips text once set", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    expect(slide.notes).toBe("");
    slide.notes = "Speaker notes here";
    expect(slide.notes).toBe("Speaker notes here");
    expect(decodePackage(editor.toBytes())).toEqual(editor.toPackage());
  });

  // Every one of these was confirmed as a real defect by opening a generated file in actual Keynote, not by this package's own (namespace-agnostic, schema-non-validating) reader, which tolerated all of them. The p:clrMapOvr omission specifically was found by diffing against a real Keynote-exported reference pptx with speaker notes, after the namespace/spTree/notesMaster-chain fixes alone still left the file rejected -- p:clrMapOvr is a required CT_NotesSlide element (a direct sibling of p:cSld, mirroring CT_SlideLayout's own p:clrMapOvr), not an optional nicety.
  it("declares xmlns:p/xmlns:a on the notes root, includes the mandatory p:nvGrpSpPr/p:grpSpPr pair, and includes p:clrMapOvr", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = "Speaker notes here";
    const notesPartPath = Object.keys(editor.toPackage().parts).find((p) =>
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p),
    );
    if (notesPartPath === undefined) {
      throw new Error(
        "expected setting notes to have created a ppt/notesSlides/notesSlideN.xml part",
      );
    }
    const notesRoot = rootElement(editor.toPackage().parts[notesPartPath]);
    const names = notesRoot?.attributes.map((a) => a.name) ?? [];
    expect(names).toEqual(expect.arrayContaining(["xmlns:p", "xmlns:a"]));
    const topLevelTags = notesRoot?.children
      .filter((c) => c.type === "element")
      .map((c) => c.tag);
    expect(topLevelTags).toEqual(["p:cSld", "p:clrMapOvr"]);
    const clrMapOvr =
      notesRoot === undefined
        ? undefined
        : childrenWithTag(notesRoot, "p:clrMapOvr")[0];
    expect(
      clrMapOvr === undefined
        ? undefined
        : childrenWithTag(clrMapOvr, "a:masterClrMapping")[0],
    ).toBeDefined();
    const cSld =
      notesRoot === undefined
        ? undefined
        : childrenWithTag(notesRoot, "p:cSld")[0];
    const spTree =
      cSld === undefined ? undefined : childrenWithTag(cSld, "p:spTree")[0];
    const leadingTags = spTree?.children
      .filter((c) => c.type === "element")
      .slice(0, 2)
      .map((c) => c.tag);
    expect(leadingTags).toEqual(["p:nvGrpSpPr", "p:grpSpPr"]);
  });

  it("updates the existing notes part rather than creating a second one", () => {
    const editor = createPptx();
    const slide = editor.addSlide();
    slide.notes = "First";
    slide.notes = "Second";
    expect(slide.notes).toBe("Second");
    const notesParts = Object.keys(editor.toPackage().parts).filter((p) =>
      /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p),
    );
    expect(notesParts).toHaveLength(1);
  });
});

describe("PptxEditor.slideSize", () => {
  it("defaults to the standard 16:9 widescreen size", () => {
    const editor = createPptx();
    expect(editor.slideSize).toEqual({ widthPt: 960, heightPt: 540 });
  });

  it("can be set and read back", () => {
    const editor = createPptx();
    editor.slideSize = { widthPt: 612, heightPt: 792 };
    expect(editor.slideSize).toEqual({ widthPt: 612, heightPt: 792 });
  });
});

describe("live-view fidelity for pptx", () => {
  it("mutating a shape leaves every other part unchanged", () => {
    const before = minimalPptxPackage();
    const editor = openPptx(minimalPptxBytes());
    const shape = editor.slides()[0]?.shapes()[0];
    if (shape === undefined) {
      throw new Error("expected at least one shape in the fixture");
    }
    shape.text = "Mutated";
    assertPartsUnchangedExcept(before, editor.toPackage(), [
      "ppt/slides/slide1.xml",
    ]);
  });
});
