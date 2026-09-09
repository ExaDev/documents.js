import { SLIDE_SIZE_WIDESCREEN } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { fixedClock } from "../../ports/clock";
import { createPpt, openPpt } from "./editor";

const FIXED_ISO = "2026-01-01T00:00:00.000Z";

describe("createPpt", () => {
  it("builds an empty presentation with real metadata timestamps", () => {
    const editor = createPpt({ clock: fixedClock(new Date(FIXED_ISO)) });
    expect(editor.slides()).toHaveLength(0);
    expect(editor.metadata.createdIso).toBe(FIXED_ISO);
  });
});

describe("PptEditor slides and shapes", () => {
  it("round-trips a slide with a text box, its frame, and speaker notes", () => {
    const editor = createPpt();
    const slide = editor.addSlide();
    slide.addTextBox({
      frame: { xPt: 40, yPt: 30, widthPt: 640, heightPt: 80 },
      text: "Title",
    });
    slide.notes = "Say something memorable";

    const reread = openPpt(editor.toBytes());
    expect(reread.slides()).toHaveLength(1);
    const rereadSlide = reread.slides()[0]!;
    expect(rereadSlide.size).toEqual(SLIDE_SIZE_WIDESCREEN);
    expect(rereadSlide.notes).toBe("Say something memorable");
    const shape = rereadSlide.shapes()[0]!;
    expect(shape.text).toBe("Title");
    expect(shape.frame).toEqual({
      xPt: 40,
      yPt: 30,
      widthPt: 640,
      heightPt: 80,
    });
  });

  it("round-trips run formatting inside a text box", () => {
    const editor = createPpt();
    const shape = editor.addSlide().addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 50 },
      text: "bold",
    });
    const run = shape.paragraphs()[0]!.runs()[0]!;
    run.bold = true;
    run.sizePt = 24;

    const rereadShape = openPpt(editor.toBytes()).slides()[0]!.shapes()[0]!;
    const rereadRun = rereadShape.paragraphs()[0]!.runs()[0]!;
    expect(rereadRun.text).toBe("bold");
    expect(rereadRun.bold).toBe(true);
    expect(rereadRun.sizePt).toBe(24);
  });

  it("round-trips multiple paragraphs in one shape and multiple shapes on one slide", () => {
    const editor = createPpt();
    const slide = editor.addSlide();
    const box = slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 300, heightPt: 100 },
      text: "one",
    });
    box.appendParagraph({ text: "two" });
    slide.addTextBox({
      frame: { xPt: 0, yPt: 120, widthPt: 300, heightPt: 50 },
      text: "second box",
    });

    const rereadSlide = openPpt(editor.toBytes()).slides()[0]!;
    expect(rereadSlide.shapes()).toHaveLength(2);
    expect(rereadSlide.shapes()[0]!.text).toBe("one\ntwo");
    expect(rereadSlide.shapes()[1]!.text).toBe("second box");
  });

  it("round-trips one shared slide size, and refuses mixed sizes at write time", () => {
    const editor = createPpt();
    editor.addSlide({ widthPt: 720, heightPt: 540 });
    editor.addSlide({ widthPt: 720, heightPt: 540 });

    const reread = openPpt(editor.toBytes());
    expect(reread.slides()[0]!.size).toEqual({ widthPt: 720, heightPt: 540 });
    expect(reread.slides()[1]!.size).toEqual({ widthPt: 720, heightPt: 540 });

    // [MS-PPT]'s DocumentAtom states exactly one slide size for the whole presentation, so a second slide naming a different size is a genuinely unwritable shape -- named by the writer rather than approximated.
    editor.addSlide(SLIDE_SIZE_WIDESCREEN);
    expect(() => editor.toBytes()).toThrow(/both appear/);
  });

  it("removes slides by handle and by index", () => {
    const editor = createPpt();
    editor.addSlide();
    editor.addSlide();
    editor.slides()[1]!.remove();
    expect(editor.slides()).toHaveLength(1);
    editor.removeSlideAt(0);
    expect(editor.slides()).toHaveLength(0);
  });
});

describe("PptEditor presentation-level round trips", () => {
  it("round-trips presentation metadata", () => {
    const editor = createPpt();
    editor.metadata = { ...editor.metadata, title: "Roadmap" };
    expect(openPpt(editor.toBytes()).metadata.title).toBe("Roadmap");
  });

  it("mutating through a removed shape handle throws", () => {
    const slide = createPpt().addSlide();
    const shape = slide.addTextBox({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    });
    shape.remove();
    expect(() => {
      shape.text = "late";
    }).toThrow(/removed/);
  });
});
