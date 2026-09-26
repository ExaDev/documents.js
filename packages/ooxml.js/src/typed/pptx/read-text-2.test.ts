import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { PptxDocumentSchema, readPptxContent } from "./read";
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
function outlineLevelFixturePackage(): Package {
  const para = (
    pPrAttrs: Record<string, string> | undefined,
    text: string,
  ): XmlElement =>
    el("a:p", {}, [
      ...(pPrAttrs === undefined ? [] : [el("a:pPr", pPrAttrs)]),
      el("a:r", {}, [el("a:t", {}, [txt(text)])]),
    ]);

  const outlineShape = el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "2", name: "Outline Body" }),
      el("p:cNvSpPr"),
      el("p:nvPr"),
    ]),
    el("p:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "914400", y: "914400" }),
        el("a:ext", { cx: "4572000", cy: "4572000" }),
      ]),
    ]),
    el("p:txBody", {}, [
      para(undefined, "no pPr"),
      para({}, "pPr without lvl"),
      para({ lvl: "0" }, "explicit zero"),
      para({ lvl: "2" }, "level two"),
      para({ lvl: "two" }, "non-numeric"),
      para({ lvl: "-1" }, "negative"),
      para({ lvl: "1.5" }, "fractional"),
      para({ lvl: "" }, "empty string"),
    ]),
  ]);

  const slide = el("p:sld", {}, [
    el("p:cSld", {}, [el("p:spTree", {}, [outlineShape])]),
  ]);
  const presentation = el("p:presentation", {}, [
    el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rId1" })]),
  ]);
  const presentationRels = rels([
    { id: "rId1", type: SLIDE_REL, target: "slides/slide1.xml" },
  ]);

  return {
    parts: {
      "ppt/presentation.xml": { kind: "xml", nodes: [presentation] },
      "ppt/_rels/presentation.xml.rels": {
        kind: "xml",
        nodes: [presentationRels],
      },
      "ppt/slides/slide1.xml": { kind: "xml", nodes: [slide] },
    },
  };
}

function outlineParagraph(text: string): ContentParagraph {
  const doc = readPptxContent(outlineLevelFixturePackage());
  const shape = doc.slides[0]?.shapes.find((s) => s.name === "Outline Body");
  return asParagraph(
    shape?.blocks.find(
      (b) => b.kind === "paragraph" && asParagraph(b).runs[0]?.text === text,
    ),
  );
}

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

describe("readPptxContent: paragraph outline levels", () => {
  it("reads a:pPr/@lvl into list.level, with no numId — DrawingML paragraphs carry no numbering identity", () => {
    const para = outlineParagraph("level two");
    expect(para.list).toEqual({ level: 2 });
    expect(para.list?.numId).toBeUndefined();
  });

  it("emits list membership that validates against ContentListMembershipSchema with numId optional (document-schema.js 3.3.0)", () => {
    const doc = readPptxContent(outlineLevelFixturePackage());
    expect(() => PptxDocumentSchema.parse(doc)).not.toThrow();
  });

  it("emits no list when @lvl is absent, whether a:pPr exists or not", () => {
    expect(outlineParagraph("no pPr").list).toBeUndefined();
    expect(outlineParagraph("pPr without lvl").list).toBeUndefined();
  });

  it('emits { level: 0 } for an explicit lvl="0" — present-and-valid, unlike the absent default', () => {
    expect(outlineParagraph("explicit zero").list).toEqual({ level: 0 });
  });

  it("degrades malformed @lvl values to no list while keeping the paragraph readable", () => {
    for (const text of ["non-numeric", "negative", "fractional"]) {
      const para = outlineParagraph(text);
      expect(para.list).toBeUndefined();
      expect(para.runs[0]?.text).toBe(text);
    }
  });

  // Number("") coerces to 0, a valid non-negative integer, so an explicit empty @lvl needs its own check distinct from the malformed spellings above — it cannot degrade to no list merely by failing Number.isInteger the way "two"/"-1"/"1.5" do.
  it('degrades an explicit lvl="" to no list too, rather than reading it as level 0', () => {
    const para = outlineParagraph("empty string");
    expect(para.list).toBeUndefined();
    expect(para.runs[0]?.text).toBe("empty string");
  });

  it("reads a slide of mixed levels back in document order", () => {
    const doc = readPptxContent(outlineLevelFixturePackage());
    const shape = doc.slides[0]?.shapes.find((s) => s.name === "Outline Body");
    const read = (shape?.blocks ?? []).map((b) => {
      const para = asParagraph(b);
      return { text: para.runs[0]?.text, list: para.list };
    });
    expect(read).toEqual([
      { text: "no pPr", list: undefined },
      { text: "pPr without lvl", list: undefined },
      { text: "explicit zero", list: { level: 0 } },
      { text: "level two", list: { level: 2 } },
      { text: "non-numeric", list: undefined },
      { text: "negative", list: undefined },
      { text: "fractional", list: undefined },
      { text: "empty string", list: undefined },
    ]);
  });
});

// A single-slide deck with no layout/master/theme at all — readSlide tolerates a slide whose own relationships name no slideLayout, simply resolving no cascade/geometry inheritance, so these minimal packages isolate one shape's own paragraph/run/table-cell properties without needing the full cascade chain buildFixturePackage sets up.
describe("readPptxContent: slide size falls back to the widescreen default when cx/cy is missing", () => {
  it("reads the widescreen default (960x540pt), not the real sldSz value, when p:sldSz carries no cx", () => {
    const pkg = minimalSlidePackage([
      textShape(el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("x")])])])),
    ]);
    // Overwrite the presentation part with one whose sldSz has no cx, after construction, to isolate exactly this one field — a real cx of 9144000 EMU (720pt) would be observably different from the 960pt default this missing-cx case must fall back to.
    const presentation = el("p:presentation", {}, [
      el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rIdSlide1" })]),
      el("p:sldSz", { cy: "6858000" }),
    ]);
    pkg.parts["ppt/presentation.xml"] = { kind: "xml", nodes: [presentation] };
    const result = readPptxContent(pkg);
    expect(result.slides[0]?.size).toEqual({ widthPt: 960, heightPt: 540 });
  });

  it("reads the widescreen default (960x540pt), not the real sldSz value, when p:sldSz carries no cy", () => {
    const pkg = minimalSlidePackage([
      textShape(el("a:p", {}, [el("a:r", {}, [el("a:t", {}, [txt("x")])])])),
    ]);
    // The mirror image of the cx-missing case above: a real cy of 6858000 EMU (540pt) would be observably identical to the widescreen default's own height, so cx is given a DIFFERENT value (9144000 EMU, 720pt, not the default's 960pt) to isolate exactly this one field's own effect on the fallback.
    const presentation = el("p:presentation", {}, [
      el("p:sldIdLst", {}, [el("p:sldId", { id: "256", "r:id": "rIdSlide1" })]),
      el("p:sldSz", { cx: "9144000" }),
    ]);
    pkg.parts["ppt/presentation.xml"] = { kind: "xml", nodes: [presentation] };
    const result = readPptxContent(pkg);
    expect(result.slides[0]?.size).toEqual({ widthPt: 960, heightPt: 540 });
  });
});
