import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentConstructStart,
  ContentParagraph,
  ContentTable,
} from "document-schema.js";
import { rgbHexToColor } from "document-schema.js";
import { el, txt } from "../../xml/fragment";
import { POINTS_PER_INCH } from "../shared/units";
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
function asConstructStart(
  block: ContentBlock | undefined,
): ContentConstructStart {
  if (block?.kind !== "constructStart") {
    throw new Error("expected a constructStart marker");
  }
  return block;
}

function asTable(block: ContentBlock | undefined): ContentTable {
  if (block?.kind !== "table") {
    throw new Error("expected a table block");
  }
  return block;
}

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

describe("readDocxContent: complex-field instruction accumulation", () => {
  it("stops the instruction at the field's separate, ignoring instrText in the result half", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" A ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
      el("w:r", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" B ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "field",
      instruction: " A ",
    });
  });

  it("keeps instruction text nested directly inside a hyperlink out of a whole-paragraph field's instruction", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
      el("w:hyperlink", {}, [
        el("w:instrText", { "xml:space": "preserve" }, [txt(" POLLUTE ")]),
      ]),
      el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "field",
      instruction: "",
    });
  });
});

describe("readDocxContent: discovery-order tie-breaks between constructs sharing one extent range", () => {
  // Several constructs can bracket the identical block range (two bookmarks around one paragraph, a bookmark around a content control, a content control around a tracked paragraph). Their emission order at the shared boundary is the source's own discovery order, carried by the walk's order counter — these tests pin that order exactly, because a marker pair emitted in the wrong order decodes to the wrong nesting.
  function flowDoc(
    children: readonly XmlElement[],
  ): ReturnType<typeof readDocxContent> {
    const body = el("w:body", {}, [
      ...children,
      el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
    ]);
    return readDocxContent({
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
      },
    });
  }

  it("opens two paragraph-scoped bookmarks over one paragraph in source order", () => {
    const paragraph = el("w:p", {}, [
      el("w:bookmarkStart", { "w:id": "1", "w:name": "First" }),
      el("w:bookmarkStart", { "w:id": "2", "w:name": "Second" }),
      textRun("Bookmarked"),
      el("w:bookmarkEnd", { "w:id": "1" }),
      el("w:bookmarkEnd", { "w:id": "2" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "First",
    });
    expect(asConstructStart(blocks[1]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Second",
    });
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("Bookmarked");
    expect(blocks[3]?.kind).toBe("constructEnd");
    expect(blocks[4]?.kind).toBe("constructEnd");
  });

  it("opens a whole-paragraph tracked change before the paragraph's own bookmark pair", () => {
    const paragraph = el("w:p", {}, [
      el("w:bookmarkStart", { "w:id": "3", "w:name": "Marked" }),
      el(
        "w:ins",
        { "w:id": "9", "w:author": "Ed", "w:date": "2024-01-01T00:00:00Z" },
        [textRun("Inserted")],
      ),
      el("w:bookmarkEnd", { "w:id": "3" }),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
      author: "Ed",
      dateIso: "2024-01-01T00:00:00Z",
    });
    expect(asConstructStart(blocks[1]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Marked",
    });
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("Inserted");
    expect(blocks[3]?.kind).toBe("constructEnd");
    expect(blocks[4]?.kind).toBe("constructEnd");
  });

  it("opens a content control before the tracked-change extent of the paragraph it wraps", () => {
    const doc = readDocxContent(
      paragraphPackage(
        el("w:sdt", {}, [
          el("w:sdtContent", {}, [
            el("w:p", {}, [
              el(
                "w:ins",
                {
                  "w:id": "9",
                  "w:author": "Ed",
                  "w:date": "2024-01-01T00:00:00Z",
                },
                [textRun("Drafted")],
              ),
            ]),
          ]),
        ]),
      ),
    );
    const blocks = doc.sections[0]?.blocks ?? [];
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "contentControl",
      controlType: "richText",
    });
    expect(asConstructStart(blocks[1]).descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
      author: "Ed",
      dateIso: "2024-01-01T00:00:00Z",
    });
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("Drafted");
    expect(blocks[3]?.kind).toBe("constructEnd");
    expect(blocks[4]?.kind).toBe("constructEnd");
  });

  it("opens a block-level bookmark before a content control sharing its extent", () => {
    const doc = flowDoc([
      el("w:bookmarkStart", { "w:id": "7", "w:name": "Wrapped" }),
      el("w:sdt", {}, [
        el("w:sdtContent", {}, [el("w:p", {}, [textRun("Controlled")])]),
      ]),
      el("w:bookmarkEnd", { "w:id": "7" }),
    ]);
    const blocks = doc.sections[0]?.blocks ?? [];
    // constructStart for the bookmark, constructStart for the content control, the paragraph it wraps, and the two matching constructEnds, in that open/close order.
    const EXPECTED_BLOCK_COUNT = 5;
    expect(blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Wrapped",
    });
    expect(asConstructStart(blocks[1]).descriptor).toEqual({
      kind: "contentControl",
      controlType: "richText",
    });
    expect(asParagraph(blocks[2]).runs[0]?.text).toBe("Controlled");
    expect(blocks[3]?.kind).toBe("constructEnd");
    expect(blocks[4]?.kind).toBe("constructEnd");
  });

  it("opens point bookmarks sharing one block position in source order after an intervening wide bookmark close", () => {
    const doc = flowDoc([
      el("w:bookmarkStart", { "w:id": "8", "w:name": "Wide" }),
      el("w:p", {}, [textRun("One")]),
      el("w:bookmarkStart", { "w:id": "9", "w:name": "FirstPoint" }),
      el("w:bookmarkEnd", { "w:id": "9" }),
      el("w:bookmarkEnd", { "w:id": "8" }),
      el("w:bookmarkStart", { "w:id": "10", "w:name": "SecondPoint" }),
      el("w:bookmarkEnd", { "w:id": "10" }),
    ]);
    const blocks = doc.sections[0]?.blocks ?? [];
    // constructStart(Wide), the "One" paragraph, constructStart(FirstPoint), constructEnd(FirstPoint), constructEnd(Wide), constructStart(SecondPoint), constructEnd(SecondPoint).
    const EXPECTED_BLOCK_COUNT = 7;
    expect(blocks).toHaveLength(EXPECTED_BLOCK_COUNT);
    expect(asConstructStart(blocks[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "Wide",
    });
    expect(asParagraph(blocks[1]).runs[0]?.text).toBe("One");
    expect(blocks[2]?.kind).toBe("constructEnd");
    expect(asConstructStart(blocks[3]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "FirstPoint",
    });
    expect(blocks[4]?.kind).toBe("constructEnd");
    expect(asConstructStart(blocks[5]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "SecondPoint",
    });
    expect(blocks[6]?.kind).toBe("constructEnd");
  });

  it("treats a body-level bookmark as content, never as a section break", () => {
    const doc = flowDoc([
      el("w:bookmarkStart", { "w:id": "12", "w:name": "Only" }),
      el("w:p", {}, [textRun("Solo")]),
      el("w:bookmarkEnd", { "w:id": "12" }),
    ]);
    expect(doc.sections).toHaveLength(1);
  });
});

describe("readDocxContent: section-split extent re-indexing and final-section handling", () => {
  function twoSectionDoc(
    trailingBodySectPr: boolean,
  ): ReturnType<typeof readDocxContent> {
    const bodyChildren: XmlElement[] = [
      el("w:p", {}, [textRun("First section")]),
      el("w:p", {}, [
        el("w:pPr", {}, [
          el("w:sectPr", {}, [
            el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
          ]),
        ]),
        textRun("Break paragraph"),
      ]),
      el("w:bookmarkStart", { "w:id": "20", "w:name": "SecondHalf" }),
      el("w:p", {}, [textRun("Second section")]),
      el("w:bookmarkEnd", { "w:id": "20" }),
    ];
    if (trailingBodySectPr) {
      bodyChildren.push(
        el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
      );
    }
    const body = el("w:body", {}, bodyChildren);
    return readDocxContent({
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
      },
    });
  }

  it("re-indexes a construct into the second section's own coordinates and keeps it out of the first", () => {
    const doc = twoSectionDoc(true);
    expect(doc.sections).toHaveLength(2);
    const first = doc.sections[0]?.blocks ?? [];
    const second = doc.sections[1]?.blocks ?? [];
    expect(first.every((b) => b.kind !== "constructStart")).toBe(true);
    expect(
      first.map((b) => (b.kind === "paragraph" ? b.runs[0]?.text : b.kind)),
    ).toEqual(["First section", "Break paragraph"]);
    expect(asConstructStart(second[0]).descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "SecondHalf",
    });
    expect(asParagraph(second[1]).runs[0]?.text).toBe("Second section");
    expect(second[2]?.kind).toBe("constructEnd");
  });

  it("keeps the trailing section after a mid-document break even with no body-level sectPr", () => {
    const doc = twoSectionDoc(false);
    expect(doc.sections).toHaveLength(2);
    expect(asParagraph(doc.sections[1]?.blocks[1]).runs[0]?.text).toBe(
      "Second section",
    );
    expect(doc.sectionHeaderFooters).toStrictEqual([{}, {}]);
  });

  it("leaves breakType absent as a key on a section whose sectPr spells no w:type", () => {
    const doc = twoSectionDoc(false);
    expect(Object.hasOwn(doc.sections[1]!, "breakType")).toBe(false);
  });
});

describe("readDocxContent: table column and merge arithmetic", () => {
  function vMergeTable(
    topRestart: XmlElement,
    bottomContinue: XmlElement,
  ): XmlElement {
    return el("w:tbl", {}, [
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "1440" }),
        el("w:gridCol", { "w:w": "2880" }),
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [el("w:p", {}, [textRun("left top")])]),
        topRestart,
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [el("w:p", {}, [textRun("left bottom")])]),
        bottomContinue,
      ]),
    ]);
  }

  it("derives a vertical merge's rowSpan on the second column from grid-column indices with plain unspanned cells", () => {
    const restart = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
      el("w:p", {}, [textRun("merged")]),
    ]);
    const continuation = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge")]),
      el("w:p", {}, [textRun("hidden")]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(vMergeTable(restart, continuation)),
    );
    const rows = asTable(doc.sections[0]?.blocks[0]).rows;
    expect(rows[0]?.cells[1]?.rowSpan).toBe(2);
    expect(rows[1]?.cells[1]).toStrictEqual({
      blocks: [],
      background: undefined,
      borders: undefined,
    });
  });

  it("keeps a vertical continuation's own shading rather than discarding the covered cell", () => {
    const restart = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
      el("w:p", {}, [textRun("merged")]),
    ]);
    const continuation = el("w:tc", {}, [
      el("w:tcPr", {}, [
        el("w:vMerge"),
        el("w:shd", { "w:val": "clear", "w:fill": "FF0000" }),
      ]),
      el("w:p", {}, [textRun("hidden")]),
    ]);
    const doc = readDocxContent(
      paragraphPackage(vMergeTable(restart, continuation)),
    );
    const rows = asTable(doc.sections[0]?.blocks[0]).rows;
    expect(rows[1]?.cells[1]?.background).toEqual({
      kind: "solid",
      color: rgbHexToColor("FF0000"),
    });
    expect(rows[1]?.cells[1]?.blocks).toEqual([]);
  });

  it("supplies a cell at every column a w:gridSpan covers, so array index is grid column", () => {
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "1440" }),
        el("w:gridCol", { "w:w": "1440" }),
        el("w:gridCol", { "w:w": "1440" }),
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [
          el("w:tcPr", {}, [el("w:gridSpan", { "w:val": "2" })]),
          el("w:p", {}, [textRun("Region")]),
        ]),
        el("w:tc", {}, [el("w:p", {}, [textRun("Revenue")])]),
      ]),
    ]);
    const rows = asTable(
      readDocxContent(paragraphPackage(table)).sections[0]?.blocks[0],
    ).rows;
    // 3 w:gridCol entries: the gridSpan="2" cell counts as itself plus one placeholder continuation cell, plus the trailing plain cell.
    const GRID_COLUMN_COUNT = 3;
    expect(rows[0]?.cells.length).toBe(GRID_COLUMN_COUNT);
    expect(rows[0]?.cells[0]?.colSpan).toBe(2);
    expect(rows[0]?.cells[1]?.blocks).toEqual([]);
    expect(rows[0]?.cells[2]?.colSpan).toBeUndefined();
  });

  it("reads a grid column with no @w:w as zero width", () => {
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "1440" }),
        el("w:gridCol", {}),
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [el("w:p", {}, [textRun("a")])]),
        el("w:tc", {}, [el("w:p", {}, [textRun("b")])]),
      ]),
    ]);
    const doc = readDocxContent(paragraphPackage(table));
    // The first gridCol's 1440 twips is exactly 1 inch (POINTS_PER_INCH); the second has no @w:w at all, hence zero.
    expect(
      asTable(doc.sections[0]?.blocks[0]).columns.map((c) => c.widthPt),
    ).toEqual([POINTS_PER_INCH, 0]);
  });
});

describe("readDocxContent: range-marker pairing and tracked-paragraph qualification", () => {
  it("drops a bookmark pair whose id has two end halves", () => {
    const body = el("w:body", {}, [
      el("w:bookmarkStart", { "w:id": "1", "w:name": "Ambiguous" }),
      el("w:p", {}, [textRun("Bracketed")]),
      el("w:bookmarkEnd", { "w:id": "1" }),
      el("w:bookmarkEnd", { "w:id": "1" }),
      el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" })]),
    ]);
    const doc = readDocxContent({
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
      },
    });
    expect(
      doc.sections[0]?.blocks.every((b) => b.kind !== "constructStart"),
    ).toBe(true);
  });

  it("emits no provenance extent for a paragraph mixing tracked and untracked children", () => {
    const paragraph = el("w:p", {}, [
      el(
        "w:ins",
        { "w:id": "1", "w:author": "Ed", "w:date": "2024-01-01T00:00:00Z" },
        [textRun("tracked")],
      ),
      textRun("untracked"),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(
      doc.sections[0]?.blocks.every((b) => b.kind !== "constructStart"),
    ).toBe(true);
    expect(
      asParagraph(doc.sections[0]?.blocks[0]).runs.map((r) => r.text),
    ).toEqual(["tracked", "untracked"]);
  });

  it("emits a provenance extent for a paragraph whose every content child is the same insertion", () => {
    const paragraph = el("w:p", {}, [
      el(
        "w:ins",
        { "w:id": "1", "w:author": "Ann", "w:date": "2024-01-01T00:00:00Z" },
        [textRun("first")],
      ),
      el(
        "w:ins",
        { "w:id": "2", "w:author": "Ann", "w:date": "2024-01-01T00:00:00Z" },
        [textRun("second")],
      ),
    ]);
    const doc = readDocxContent(paragraphPackage(paragraph));
    expect(asConstructStart(doc.sections[0]?.blocks[0]).descriptor).toEqual({
      kind: "provenance",
      change: "insertion",
      author: "Ann",
      dateIso: "2024-01-01T00:00:00Z",
    });
    expect(
      asParagraph(doc.sections[0]?.blocks[1]).runs.map((r) => r.text),
    ).toEqual(["first", "second"]);
    expect(doc.sections[0]?.blocks[2]?.kind).toBe("constructEnd");
  });
});
