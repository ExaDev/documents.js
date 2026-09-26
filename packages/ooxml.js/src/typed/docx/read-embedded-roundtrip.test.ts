import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentParagraph } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { readDocxContent } from "./read";
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

function asParagraph(block: ContentBlock | undefined): ContentParagraph {
  if (block?.kind !== "paragraph") {
    throw new Error("expected a paragraph block");
  }
  return block;
}

// The two construct-boundary markers have no sourcePath field at all (a boundary is not content), so reading one off an unnarrowed ContentBlock no longer type-checks — this narrows past them for the assertions below, which only ever look at real content blocks.
function paragraphPackage(
  paragraph: XmlElement,
  extraParts: Package["parts"] = {},
): Package {
  const body = el("w:body", {}, [
    paragraph,
    el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      "word/_rels/document.xml.rels": { kind: "xml", nodes: [rels([])] },
      ...extraParts,
    },
  };
}

function textRun(text: string): XmlElement {
  return el("w:r", {}, [el("w:t", { "xml:space": "preserve" }, [txt(text)])]);
}

function firstParagraph(
  doc: ReturnType<typeof readDocxContent>,
): ContentParagraph {
  return asParagraph(doc.sections[0]?.blocks[0]);
}

describe("readDocxContent: w:pBdr (direct paragraph border formatting)", () => {
  it("reads a bottom-only border, the exact shape Word's AutoCorrect horizontal rule produces", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pBdr", {}, [
          el("w:bottom", {
            "w:val": "single",
            "w:sz": "6",
            "w:color": "000000",
          }),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const borders = firstParagraph(doc).borders;
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.75,
      style: "solid",
    });
    expect(borders?.top).toBeUndefined();
    expect(borders?.left).toBeUndefined();
    expect(borders?.right).toBeUndefined();
  });

  it("reads all four edges independently, mapping style keywords and resolving an auto colour to black", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pBdr", {}, [
          el("w:top", { "w:val": "single", "w:sz": "8", "w:color": "00FF00" }),
          el("w:left", { "w:val": "dashed", "w:color": "auto" }),
          el("w:bottom", {
            "w:val": "double",
            "w:sz": "12",
            "w:color": "0000FF",
          }),
          el("w:right", { "w:val": "dotted", "w:color": "FF0000" }),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const borders = firstParagraph(doc).borders;
    expect(borders?.top).toEqual({
      color: { r: 0, g: 1, b: 0 },
      widthPt: 1,
      style: "solid",
    });
    expect(borders?.left).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 0.5,
      style: "dashed",
    });
    expect(borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 1.5,
      style: "double",
    });
    expect(borders?.right).toEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 0.5,
      style: "dotted",
    });
  });

  it("has no w:start/w:end RTL-alias fallback, unlike w:tcBorders — a paragraph carrying only those is read as having no left/right border", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pBdr", {}, [
          el("w:start", {
            "w:val": "single",
            "w:sz": "8",
            "w:color": "000000",
          }),
          el("w:end", { "w:val": "single", "w:sz": "8", "w:color": "000000" }),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).borders).toBeUndefined();
  });

  it("leaves borders undefined when the paragraph carries no w:pBdr at all", () => {
    const paragraph = el("w:p", {}, [textRun("Plain paragraph")]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).borders).toBeUndefined();
  });

  it("leaves borders undefined when w:pBdr's own edges are all nil, matching readCellBorders' identical treatment", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pBdr", {}, [
          el("w:top", { "w:val": "nil" }),
          el("w:bottom", { "w:val": "none" }),
        ]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(firstParagraph(doc).borders).toBeUndefined();
  });
});

describe("readDocxContent: a mid-run page-type w:br splits the paragraph", () => {
  it("splits a paragraph with a page break inside one run's text into [before, pageBreak, after]", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    // The paragraph's own text before the page break, the pageBreak marker block itself, and the paragraph continuing after it.
    const EXPECTED_BLOCK_COUNT = 3;
    expect(blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual(["before"]);
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual(["after"]);
  });

  it("splits across separate runs too, keeping every run entirely on its own side of the break", () => {
    const paragraph = el("w:p", {}, [
      textRun("first run"),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("mid before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("mid after")]),
      ]),
      textRun("last run"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    // The paragraph's own text before the page break, the pageBreak marker block itself, and the paragraph continuing after it.
    const EXPECTED_BLOCK_COUNT = 3;
    expect(blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual([
      "first run",
      "mid before",
    ]);
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual([
      "mid after",
      "last run",
    ]);
  });

  it("both halves inherit the original paragraph's own paragraph-level formatting unchanged", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pStyle", { "w:val": "IntenseQuote" }),
        el("w:jc", { "w:val": "center" }),
      ]),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    const before = asParagraph(blocks[0]);
    const after = asParagraph(blocks[2]);
    expect(before.styleId).toBe("IntenseQuote");
    expect(after.styleId).toBe("IntenseQuote");
    expect(before.alignment).toBe("center");
    expect(after.alignment).toBe("center");
  });

  it("both halves of the split run keep its own bold/italic/colour formatting", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:rPr", {}, [el("w:b"), el("w:i")]),
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    const beforeRun = asParagraph(blocks[0]).runs[0];
    const afterRun = asParagraph(blocks[2]).runs[0];
    expect(beforeRun?.bold).toBe(true);
    expect(beforeRun?.italic).toBe(true);
    expect(afterRun?.bold).toBe(true);
    expect(afterRun?.italic).toBe(true);
  });

  it("does not leave an empty stand-in run when the break sits at the very start of a run's own text", () => {
    const paragraph = el("w:p", {}, [
      textRun("earlier run"),
      el("w:r", {}, [
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual([
      "earlier run",
    ]);
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual(["after"]);
  });

  it("does not leave an empty stand-in run when the break sits at the very end of a run's own text", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
      ]),
      textRun("later run"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[0]).runs.map((r) => r.text)).toEqual(["before"]);
    expect(asParagraph(blocks[2]).runs.map((r) => r.text)).toEqual([
      "later run",
    ]);
  });

  it("does not split on a w:br with no @w:type (textWrapping, the default) — it still reads back as a literal newline", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br"),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(asParagraph(blocks[0]).runs[0]?.text).toBe("before\nafter");
  });

  it('does not split on a column break (@w:type="column") either', () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "column" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(1);
    expect(asParagraph(blocks[0]).runs[0]?.text).toBe("before\nafter");
  });

  it("splits only on the FIRST page-type break in the paragraph — a second one reads back as an ordinary newline in the after-half", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("first")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("second")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("third")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    // The paragraph's own text before the page break, the pageBreak marker block itself, and the paragraph continuing after it.
    const EXPECTED_BLOCK_COUNT = 3;
    expect(blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asParagraph(blocks[0]).runs[0]?.text).toBe("first");
    expect(blocks[1]?.kind).toBe("pageBreak");
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("second\nthird");
  });

  it("keeps a bookmark extent entirely before the split run on the before-half, unchanged", () => {
    const paragraph = el("w:p", {}, [
      el("w:bookmarkStart", { "w:id": "1", "w:name": "early" }),
      textRun("bookmarked"),
      el("w:bookmarkEnd", { "w:id": "1" }),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    const before = asParagraph(blocks[0]);
    expect(before.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "early" },
        startRun: 0,
        endRun: 1,
      },
    ]);
    expect(asParagraph(blocks[2]).constructs).toBeUndefined();
  });

  it("keeps a bookmark extent entirely after the split run on the after-half, re-indexed from zero", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
      el("w:bookmarkStart", { "w:id": "2", "w:name": "late" }),
      textRun("bookmarked"),
      el("w:bookmarkEnd", { "w:id": "2" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asParagraph(blocks[0]).constructs).toBeUndefined();
    const after = asParagraph(blocks[2]);
    expect(after.runs.map((r) => r.text)).toEqual(["after", "bookmarked"]);
    // "bookmarked" is re-indexed run 1 in the after-half's own numbering (afterHalf itself occupies run 0), not run 0 — the after-half's own run array is [afterHalf, ...original runs from pageBreak.runIndex+1 onward].
    expect(after.constructs).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "late" },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("drops a bookmark extent that spans across the split run itself, rather than mis-encoding it onto either half", () => {
    // "lead"/"trail" runs keep both bookmark halves inside the paragraph's own content range (not its very first/last child), so this is a genuine run-scoped extent rather than the whole-paragraph block-scoped shape recordParagraphRangeMarkers encodes separately.
    const paragraph = el("w:p", {}, [
      textRun("lead"),
      el("w:bookmarkStart", { "w:id": "3", "w:name": "spanning" }),
      el("w:r", {}, [
        el("w:t", { "xml:space": "preserve" }, [txt("before")]),
        el("w:br", { "w:type": "page" }),
        el("w:t", { "xml:space": "preserve" }, [txt("after")]),
      ]),
      textRun("tail"),
      el("w:bookmarkEnd", { "w:id": "3" }),
      textRun("trail"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    // The paragraph's own text before the page break, the pageBreak marker block itself, and the paragraph continuing after it.
    const EXPECTED_BLOCK_COUNT = 3;
    expect(blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asParagraph(blocks[0]).constructs).toBeUndefined();
    const after = asParagraph(blocks[2]);
    expect(after.runs.map((r) => r.text)).toEqual(["after", "tail", "trail"]);
    expect(after.constructs).toBeUndefined();
  });
});
