import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { readPptxContent } from "./read";
function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block;
}

const SLIDE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
function rels(
  entries: readonly {
    id: string;
    type: string;
    target: string;
    external?: boolean;
  }[],
): XmlElement {
  return el(
    "Relationships",
    {},
    entries.map((e) =>
      el(
        "Relationship",
        e.external === true
          ? { Id: e.id, Type: e.type, Target: e.target, TargetMode: "External" }
          : { Id: e.id, Type: e.type, Target: e.target },
      ),
    ),
  );
}

// Only the PNG magic-byte signature matters to sniffImageFormat — the rest is arbitrary filler, not a real encoded image.
function minimalSlidePackage(
  shapes: readonly ReturnType<typeof el>[],
): Package {
  const slide = el("p:sld", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, shapes)]),
  ]);
  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rIdSlide1" })]),
    el("p:sldSz", { cx: "9144000", cy: "6858000" }),
  ]);
  const presentationRels = rels([
    { id: "rIdSlide1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);
  return {
    parts: {
      "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      "ppt/_rels/presentation.xml.rels": {
        kind: "xml",
        nodes: [presentationRels],
      },
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
      "ppt/slides/_rels/slide1.xml.rels": {
        kind: "xml",
        nodes: [rels([])],
      },
    },
  };
}

function firstShapeParagraph(
  shapes: readonly ReturnType<typeof el>[],
): ContentParagraph {
  const doc = readPptxContent(minimalSlidePackage(shapes));
  return asParagraph(doc.slides[0]?.shapes[0]?.blocks[0]);
}

function textShape(paragraph: ReturnType<typeof el>): ReturnType<typeof el> {
  return el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "2", name: "Shape 1" }),
      el("p:cNvSpPr"),
      el("p:nvPr"),
    ]),
    // An explicit xfrm, not inherited placeholder geometry: this minimal package has no layout/master chain for resolveShapeFrame to inherit from, so a shape with no own frame at all resolves to no frame and is dropped from the slide entirely.
    el("p:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "0", y: "0" }),
        el("a:ext", { cx: "914400", cy: "914400" }),
      ]),
    ]),
    el("p:txBody", {}, [paragraph]),
  ]);
}

describe("readPptxContent: paragraph alignment, every token distinctly", () => {
  function alignmentOf(algn: string): string | undefined {
    const para = firstShapeParagraph([
      textShape(
        el("a:p", {}, [
          el("a:pPr", { algn }),
          el("a:r", {}, [el("a:t", {}, [txt("x")])]),
        ]),
      ),
    ]);
    return para.alignment;
  }

  it('reads algn="l" as "left"', () => {
    expect(alignmentOf("l")).toBe("left");
  });

  it('reads algn="ctr" as "center"', () => {
    expect(alignmentOf("ctr")).toBe("center");
  });

  it('reads algn="r" as "right"', () => {
    expect(alignmentOf("r")).toBe("right");
  });

  it('reads algn="just" as "justify"', () => {
    expect(alignmentOf("just")).toBe("justify");
  });

  it('reads algn="justLow" as "justify" too', () => {
    expect(alignmentOf("justLow")).toBe("justify");
  });

  it("reads no alignment at all for an unrecognised token", () => {
    expect(alignmentOf("dist")).toBeUndefined();
  });
});

describe("readPptxContent: run underline/strikethrough exact val tokens", () => {
  function runProps(rPrAttrs: Readonly<Record<string, string>>) {
    const para = firstShapeParagraph([
      textShape(
        el("a:p", {}, [
          el("a:r", {}, [el("a:rPr", rPrAttrs), el("a:t", {}, [txt("x")])]),
        ]),
      ),
    ]);
    return para.runs[0];
  }

  it('reads u="none" as underline: false, not true', () => {
    expect(runProps({ u: "none" })?.underline).toBe(false);
  });

  it("reads no u attribute at all as underline: undefined", () => {
    expect(runProps({})?.underline).toBeUndefined();
  });

  it('reads u="sng" as underline: true', () => {
    expect(runProps({ u: "sng" })?.underline).toBe(true);
  });

  it('reads strike="noStrike" as strike: false, not true', () => {
    expect(runProps({ strike: "noStrike" })?.strike).toBe(false);
  });

  it("reads no strike attribute at all as strike: undefined", () => {
    expect(runProps({})?.strike).toBeUndefined();
  });
});

describe("readPptxContent: an unreachable presentation part reads as an empty deck, not a crash", () => {
  it("reads no slides when the package carries no presentation part at all", () => {
    const doc = readPptxContent({ parts: {} });
    expect(doc.slides).toEqual([]);
  });

  it("reads no slides when the presentation part carries no p:sldIdLst", () => {
    const presentation = el("p:presentation", {}, [
      el("p:sldSz", { cx: "9144000", cy: "6858000" }),
    ]);
    const doc = readPptxContent({
      parts: {
        "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      },
    });
    expect(doc.slides).toEqual([]);
  });
});

describe("readPptxContent: a run with no a:t child at all", () => {
  it('reads text: "" for an a:r carrying no a:t', () => {
    const para = firstShapeParagraph([
      textShape(el("a:p", {}, [el("a:r", {})])),
    ]);
    expect(para.runs[0]?.text).toBe("");
  });
});
