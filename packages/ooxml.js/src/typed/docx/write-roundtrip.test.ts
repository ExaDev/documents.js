import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentSection,
  ContentTable,
} from "document-schema.js";
import { findConstructMarkerImbalance } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import { readDocxContent } from "./read";
import { buildDocxPackageFromContent } from "./write";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const HYPERLINK_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const PICTURE_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";

function docxPackage(
  bodyChildren: readonly XmlNode[],
  extraParts: Package["parts"] = {},
): Package {
  const body = el("w:body", {}, [
    ...bodyChildren,
    el("w:sectPr", {}, [
      el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
      el("w:pgMar", {
        "w:top": "1440",
        "w:right": "1440",
        "w:bottom": "1440",
        "w:left": "1440",
      }),
    ]),
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      ...extraParts,
    },
  };
}

function para(text: string, ...extra: readonly XmlNode[]): XmlNode {
  return el("w:p", {}, [...extra, el("w:r", {}, [el("w:t", {}, [txt(text)])])]);
}

// Read, write, read: the second read's sections are what every assertion compares against the first's.
function roundTrip(source: Package): {
  before: ContentSection[];
  after: ContentSection[];
  written: Package;
} {
  const before = readDocxContent(source);
  const written = buildDocxPackageFromContent(before);
  return {
    before: before.sections,
    after: readDocxContent(written).sections,
    written,
  };
}

function expectStableRoundTrip(source: Package): ContentSection[] {
  const { before, after } = roundTrip(source);
  expect(after).toEqual(before);
  return after;
}

// The extras round trip: unlike `roundTrip` above, this carries the WHOLE DocxDocument — comments, footnotes, endnotes, header/footer parts, and numbering, not only sections — through buildDocxPackageFromContent, since DocxContent's own optional fields are a superset of what `roundTrip` exercises.
function emptyBodySection(): ContentSection {
  return {
    pageSize: { widthPt: 612, heightPt: 792 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: [],
  };
}

describe("buildDocxPackageFromContent: content round trip", () => {
  it("round-trips paragraph properties, run formatting, headings, lists, and page breaks", () => {
    const styled = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pStyle", { "w:val": "Heading2" }),
        el("w:numPr", {}, [
          el("w:ilvl", { "w:val": "2" }),
          el("w:numId", { "w:val": "7" }),
        ]),
        el("w:spacing", {
          "w:before": "240",
          "w:after": "120",
          "w:line": "360",
          "w:lineRule": "auto",
        }),
        el("w:ind", { "w:left": "720", "w:hanging": "360" }),
        el("w:jc", { "w:val": "both" }),
        el("w:outlineLvl", { "w:val": "1" }),
      ]),
      el("w:r", {}, [
        el("w:rPr", {}, [
          el("w:b"),
          el("w:i"),
          el("w:u", { "w:val": "single" }),
          el("w:strike"),
          el("w:rFonts", { "w:ascii": "Georgia" }),
          el("w:sz", { "w:val": "28" }),
          el("w:color", { "w:val": "ff0000" }),
        ]),
        el("w:t", {}, [txt("styled")]),
      ]),
      el("w:r", {}, [
        el("w:t", {}, [txt("a")]),
        el("w:tab"),
        el("w:t", {}, [txt("b")]),
        el("w:br"),
        el("w:t", {}, [txt("c")]),
      ]),
    ]);
    const pageBreak = el("w:p", {}, [
      el("w:pPr", {}, [el("w:pageBreakBefore")]),
      el("w:r", {}, [el("w:t", {}, [txt("next page")])]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([styled, pageBreak]));
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "pageBreak",
      "paragraph",
    ]);
  });

  // A heading with a page break before it and Word's own _Toc bookmark around it — one of the commonest shapes in a real document with a table of contents. collectParagraph pushes the pageBreak block before the paragraph it belongs to, so a construct whose extent starts at that same paragraph opens one block later: the page break and the construct are siblings in the flat list, not nested. The page break must still land immediately before the paragraph that carries it, not at the end of the section with a spurious empty paragraph appended.
  it("keeps a page break immediately before the paragraph that opens a construct there, instead of moving it to the end of the flow", () => {
    const source = docxPackage([
      para("before"),
      el("w:p", {}, [
        el("w:pPr", {}, [el("w:pageBreakBefore")]),
        el("w:bookmarkStart", { "w:id": "3", "w:name": "_Toc9" }),
        el("w:r", {}, [el("w:t", {}, [txt("Chapter 1")])]),
        el("w:bookmarkEnd", { "w:id": "3" }),
      ]),
    ]);
    const before = readDocxContent(source);
    expect(before.sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "pageBreak",
      "constructStart",
      "paragraph",
      "constructEnd",
    ]);
    const after =
      readDocxContent(buildDocxPackageFromContent(before)).sections[0]
        ?.blocks ?? [];
    expect(findConstructMarkerImbalance(after)).toBeUndefined();
    const paragraphs = after.flatMap((block) =>
      block.kind === "paragraph" ? [block] : [],
    );
    // No spurious paragraph gained on the way out, and "Chapter 1" is not displaced to the end of the flow.
    expect(
      paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(""),
      ),
    ).toEqual(["before", "Chapter 1"]);
    const kinds = after.map((block) => block.kind);
    expect(kinds.filter((kind) => kind === "pageBreak")).toHaveLength(1);
    expect(kinds.indexOf("pageBreak")).toBeLessThan(
      kinds.lastIndexOf("paragraph"),
    );
  });

  // A ContentDocument from another codec (markdown-codec, odf.js, pdf-codec) can hand this writer a page break directly followed by a table, a shape readDocxContent itself never produces but buildDocxPackageFromContent still has to honour: WordprocessingML has no page-break element for a table to carry, so the break becomes its own empty paragraph immediately before the table, not displaced after it.
  it("keeps a page break immediately before a table rather than displacing it after the table", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "before" }] },
      { kind: "pageBreak" },
      {
        kind: "table",
        columns: [{ widthPt: 72 }],
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "cell" }] }] },
            ],
          },
        ],
      },
    ];
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks,
        },
      ],
    });
    const after = readDocxContent(written).sections[0]?.blocks ?? [];
    const kinds = after.map((block) => block.kind);
    expect(kinds.indexOf("pageBreak")).toBeGreaterThan(-1);
    expect(kinds.indexOf("pageBreak")).toBeLessThan(kinds.indexOf("table"));
  });

  // The source relationship spells its query separator as the XML entity '&amp;'; the projection decodes it, and the writer re-encodes it once — the whole point of the pair being that a target survives the trip spelled the same way, not doubly encoded.
  it("round-trips an external hyperlink through a freshly minted relationship, sharing one relationship per target", () => {
    const link = (text: string): XmlNode =>
      el("w:p", {}, [
        el("w:hyperlink", { "r:id": "rIdHlink" }, [
          el("w:r", {}, [el("w:t", {}, [txt(text)])]),
        ]),
      ]);
    const source = docxPackage([link("first"), link("second")], {
      "word/_rels/document.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            el("Relationship", {
              Id: "rIdHlink",
              Type: HYPERLINK_REL,
              Target: "https://example.com/a?x=1&amp;y=2",
              TargetMode: "External",
            }),
          ]),
        ],
      },
    });
    const { after, written } = roundTrip(source);
    const paragraph = after[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs[0]?.hyperlink
        : undefined,
    ).toBe("https://example.com/a?x=1&y=2");
    // Filtered to the hyperlink relationship specifically — document.xml.rels also always carries a styles.xml relationship now (buildStylesPart is unconditional), which this test's own "one relationship per target" claim was never about.
    const rels = rootElement(written.parts["word/_rels/document.xml.rels"]);
    const hyperlinkRels = elementsWithTag(
      rels === undefined ? [] : [rels],
      "Relationship",
    ).filter((rel) => attr(rel, "Type") === HYPERLINK_REL);
    expect(hyperlinkRels).toHaveLength(1);
  });

  it("round-trips a table's grid, spans, shading, borders, and row heights", () => {
    const borders = el("w:tcBorders", {}, [
      el("w:top", { "w:val": "single", "w:sz": "8", "w:color": "00ff00" }),
      el("w:bottom", { "w:val": "dashed", "w:color": "auto" }),
    ]);
    const spanned = el("w:tc", {}, [
      el("w:tcPr", {}, [
        el("w:gridSpan", { "w:val": "2" }),
        el("w:shd", { "w:fill": "ff0000" }),
        borders,
      ]),
      para("merged"),
    ]);
    const anchor = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
      para("top"),
    ]);
    const continuation = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge")]),
      el("w:p"),
    ]);
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "2880" }),
        el("w:gridCol", { "w:w": "1440" }),
      ]),
      el("w:tr", {}, [
        el("w:trPr", {}, [el("w:trHeight", { "w:val": "560" })]),
        spanned,
      ]),
      el("w:tr", {}, [anchor, el("w:tc", {}, [para("right one")])]),
      el("w:tr", {}, [continuation, el("w:tc", {}, [para("right two")])]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([table]));
    const written = sections[0]?.blocks[0];
    if (written?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(written.rows[1]?.cells[0]?.rowSpan).toBe(2);
    expect(written.rows[0]?.cells[0]?.colSpan).toBe(2);
  });

  describe("a table breaking the grid rule", () => {
    const paragraphOf = (text: string): ContentBlock => ({
      kind: "paragraph",
      runs: [{ text }],
    });
    // A merged header whose covered position carries a second copy of the anchor's content, which a w:tc with a gridSpan has no cell to hold.
    const coveredContentTable: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        {
          cells: [
            { blocks: [paragraphOf("anchor")], colSpan: 2 },
            { blocks: [paragraphOf("copy")] },
          ],
        },
      ],
    };

    function buildWith(table: ContentTable): unknown {
      return buildDocxPackageFromContent({
        sections: [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [table],
          },
        ],
      });
    }

    it("refuses a table whose covered position carries content, naming the entry point and the fault", () => {
      expect(() => buildWith(coveredContentTable)).toThrow(
        "buildDocxPackageFromContent: table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor)",
      );
    });

    it("refuses a table whose rows differ in length", () => {
      expect(() =>
        buildWith({
          kind: "table",
          columns: [{ widthPt: 100 }, { widthPt: 100 }],
          rows: [
            { cells: [{ blocks: [paragraphOf("a")] }, { blocks: [] }] },
            { cells: [{ blocks: [paragraphOf("b")] }] },
          ],
        }),
      ).toThrow(
        /^buildDocxPackageFromContent: table breaks the grid rule \(row 1 holds 1 cells/,
      );
    });

    it("refuses a table nested inside a cell", () => {
      expect(() =>
        buildWith({
          kind: "table",
          columns: [{ widthPt: 100 }],
          rows: [{ cells: [{ blocks: [coveredContentTable] }] }],
        }),
      ).toThrow(/^buildDocxPackageFromContent: table breaks the grid rule/);
    });
  });

  it("writes a table's exact tblPr, tblGrid, gridSpan, vMerge, and trHeight XML, not just a round-trippable one", () => {
    // A round trip through readTable can mask a writer defect the reader happens to tolerate (a wrong tag name it still recognises, a swapped constant it still parses back the same way), so this asserts the actual written XML shape directly rather than only the read-back content.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "table" as const,
              columns: [{ widthPt: 100 }, { widthPt: 50 }],
              rows: [
                {
                  heightPt: 30,
                  cells: [
                    {
                      blocks: [
                        { kind: "paragraph" as const, runs: [{ text: "top" }] },
                      ],
                      colSpan: 2,
                    },
                    { blocks: [] },
                  ],
                },
                {
                  cells: [
                    {
                      blocks: [
                        {
                          kind: "paragraph" as const,
                          runs: [{ text: "left" }],
                        },
                      ],
                      rowSpan: 2,
                    },
                    {
                      blocks: [
                        {
                          kind: "paragraph" as const,
                          runs: [{ text: "right1" }],
                        },
                      ],
                    },
                  ],
                },
                {
                  cells: [
                    { blocks: [] },
                    {
                      blocks: [
                        {
                          kind: "paragraph" as const,
                          runs: [{ text: "right2" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const table = elementsWithTag(
      document === undefined ? [] : [document],
      "w:tbl",
    )[0];
    if (table === undefined) {
      throw new Error("expected a w:tbl element");
    }
    expect(table.children[0]).toEqual(
      el("w:tblPr", {}, [el("w:tblW", { "w:w": "0", "w:type": "auto" })]),
    );
    expect(table.children[1]).toEqual(
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "2000" }),
        el("w:gridCol", { "w:w": "1000" }),
      ]),
    );
    const rows = childrenWithTag(table, "w:tr");
    // The fixture above defines exactly three `rows` entries.
    const FIXTURE_ROW_COUNT = 3;
    expect(rows).toHaveLength(FIXTURE_ROW_COUNT);
    expect(childrenWithTag(rows[0]!, "w:trPr")[0]).toEqual(
      el("w:trPr", {}, [el("w:trHeight", { "w:val": "600" })]),
    );
    const row0Cells = childrenWithTag(rows[0]!, "w:tc");
    expect(row0Cells).toHaveLength(1);
    expect(childrenWithTag(row0Cells[0]!, "w:tcPr")[0]).toEqual(
      el("w:tcPr", {}, [el("w:gridSpan", { "w:val": "2" })]),
    );
    const row1Cells = childrenWithTag(rows[1]!, "w:tc");
    expect(row1Cells).toHaveLength(2);
    expect(childrenWithTag(row1Cells[0]!, "w:tcPr")[0]).toEqual(
      el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
    );
    expect(childrenWithTag(row1Cells[1]!, "w:tcPr")).toHaveLength(0);
    const row2Cells = childrenWithTag(rows[2]!, "w:tc");
    expect(row2Cells).toHaveLength(2);
    expect(childrenWithTag(row2Cells[0]!, "w:tcPr")[0]).toEqual(
      el("w:tcPr", {}, [el("w:vMerge", {})]),
    );
    // The vMerge continuation cell carries no blocks of its own, but ECMA-376 still requires a trailing block-level element, so it still gets the empty paragraph every genuinely empty cell gets.
    expect(row2Cells[0]!.children.filter((c) => c.type === "element")).toEqual([
      el("w:tcPr", {}, [el("w:vMerge", {})]),
      el("w:p"),
    ]);
  });

  it("round-trips a genuine two-colour pattern fill instead of dropping it (ExaDev/documents.js#951)", () => {
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "2880" })]),
      el("w:tr", {}, [
        el("w:tc", {}, [
          el("w:tcPr", {}, [
            el("w:shd", {
              "w:val": "pct20",
              "w:color": "000000",
              "w:fill": "ffffff",
            }),
          ]),
          para("percentage grey"),
        ]),
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [
          el("w:tcPr", {}, [
            el("w:shd", { "w:val": "diagCross", "w:color": "ff0000" }),
          ]),
          para("crosshatch"),
        ]),
      ]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([table]));
    const written = sections[0]?.blocks[0];
    if (written?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(written.rows[0]?.cells[0]?.background).toEqual({
      kind: "pattern",
      patternType: "percent20",
      foregroundColor: { r: 0, g: 0, b: 0 },
      backgroundColor: { r: 1, g: 1, b: 1 },
    });
    expect(written.rows[1]?.cells[0]?.background).toEqual({
      kind: "pattern",
      patternType: "diagonalCross",
      foregroundColor: { r: 1, g: 0, b: 0 },
    });
  });

  it("round-trips an image back into the run it was lifted out of, rather than adding a paragraph for it", () => {
    const drawing = (rId: string, alt: string): XmlNode =>
      el("w:drawing", {}, [
        el("wp:inline", {}, [
          el("wp:extent", { cx: "914400", cy: "457200" }),
          el("wp:docPr", { id: "1", name: "Picture 1", descr: alt }),
          el("a:graphic", {}, [
            el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
              el("pic:pic", {}, [
                el("pic:blipFill", {}, [el("a:blip", { "r:embed": rId })]),
              ]),
            ]),
          ]),
        ]),
      ]);
    const source = docxPackage(
      [
        el("w:p", {}, [el("w:r", {}, [drawing("rIdImg", "alone")])]),
        el("w:p", {}, [
          el("w:r", {}, [el("w:t", {}, [txt("caption")])]),
          el("w:r", {}, [drawing("rIdImg", "after text")]),
        ]),
      ],
      {
        "word/_rels/document.xml.rels": {
          kind: "xml",
          nodes: [
            el("Relationships", {}, [
              el("Relationship", {
                Id: "rIdImg",
                Type: IMAGE_REL,
                Target: "media/image1.png",
              }),
            ]),
          ],
        },
        "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
      },
    );
    const sections = expectStableRoundTrip(source);
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
      "image",
    ]);
  });

  it("round-trips several sections, keeping each break on the paragraph that carries it", () => {
    const firstBreak = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:sectPr", {}, [
          el("w:pgSz", { "w:w": "11906", "w:h": "16838" }),
          el("w:pgMar", {
            "w:top": "720",
            "w:right": "720",
            "w:bottom": "720",
            "w:left": "720",
          }),
        ]),
      ]),
    ]);
    const sections = expectStableRoundTrip(
      docxPackage([para("first"), firstBreak, para("second")]),
    );
    expect(sections).toHaveLength(2);
    // 11906 twips (the w:pgSz w:w above) converted to points at 20 twips per point (ECMA-376's own twip definition).
    const EXPECTED_PAGE_WIDTH_PT = 595.3;
    expect(sections[0]?.pageSize.widthPt).toBeCloseTo(
      EXPECTED_PAGE_WIDTH_PT,
      1,
    );
  });

  it("round-trips a section break kind, re-emitting w:sectPr/w:type for a section that spells one and none for a section that does not", () => {
    const continuousBreak = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:sectPr", {}, [
          el("w:type", { "w:val": "continuous" }),
          el("w:pgSz", { "w:w": "11906", "w:h": "16838" }),
          el("w:pgMar", {
            "w:top": "720",
            "w:right": "720",
            "w:bottom": "720",
            "w:left": "720",
          }),
        ]),
      ]),
    ]);
    const sections = expectStableRoundTrip(
      docxPackage([para("first"), continuousBreak, para("second")]),
    );
    expect(sections[0]?.breakType).toBe("continuous");
    expect(sections[1]?.breakType).toBeUndefined();
  });

  // A bookmark closing exactly where a section ends: the section's own flow ends in a childless w:bookmarkEnd marker, not a w:p, so attachSectionBreak has to descend into the construct to find the paragraph the break actually belongs to, the same way buildFieldNodes' own findParagraph already does for a field.
  it("attaches a mid-document section break to the true last paragraph even when a construct closes at the end of the section", () => {
    const closingParagraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:sectPr", {}, [
          el("w:pgSz", { "w:w": "11906", "w:h": "16838" }),
          el("w:pgMar", {
            "w:top": "720",
            "w:right": "720",
            "w:bottom": "720",
            "w:left": "720",
          }),
        ]),
      ]),
      el("w:r", {}, [el("w:t", {}, [txt("end of section one")])]),
    ]);
    const source = docxPackage([
      el("w:bookmarkStart", { "w:id": "1", "w:name": "closing" }),
      closingParagraph,
      el("w:bookmarkEnd", { "w:id": "1" }),
      para("second"),
    ]);
    const sections = expectStableRoundTrip(source);
    expect(sections).toHaveLength(2);
    // No spurious empty paragraph gained on the way out to carry the break.
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "constructEnd",
    ]);
  });
});

describe("buildDocxPackageFromContent: internal link wrap precedence and guards", () => {
  function internalHyperlinks(
    written: Package,
  ): { anchor: string | undefined; runCount: number }[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    return elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:hyperlink",
    )
      .filter((hyperlink) =>
        hyperlink.attributes.some((a) => a.name === "w:anchor"),
      )
      .map((hyperlink) => ({
        anchor: hyperlink.attributes.find((a) => a.name === "w:anchor")?.value,
        runCount: hyperlink.children.filter(
          (child) => child.type === "element" && child.tag === "w:r",
        ).length,
      }));
  }

  it("resolves two internal links sharing one start run in favour of the longer extent", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "short" },
                  },
                  startRun: 0,
                  endRun: 2,
                },
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "long" },
                  },
                  startRun: 0,
                  endRun: 3,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(internalHyperlinks(written)).toEqual([
      { anchor: "long", runCount: 3 },
    ]);
  });

  it("leaves an internal link plain when its own runs already carry an external hyperlink", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "outside" },
                { text: "linked", hyperlink: "https://example.com/target" },
              ],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "internal" },
                  },
                  startRun: 0,
                  endRun: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    // No w:anchor wrapper at all: the slice carries the external hyperlink's own w:hyperlink element, so the internal wrap is refused.
    expect(internalHyperlinks(written)).toEqual([]);
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const external = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:hyperlink",
    ).filter((hyperlink) =>
      hyperlink.attributes.some((a) => a.name === "r:id"),
    );
    expect(external).toHaveLength(1);
  });
});

describe("buildDocxPackageFromContent: internal link wrap boundary shapes", () => {
  function paragraphWithLinks(
    runs: readonly { text: string; hyperlink?: string }[],
    constructs: readonly {
      anchor: string;
      startRun: number;
      endRun: number;
    }[],
  ): Package {
    return buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [...runs],
              constructs: constructs.map((extent) => ({
                descriptor: {
                  kind: "link" as const,
                  target: { kind: "internal" as const, anchor: extent.anchor },
                },
                startRun: extent.startRun,
                endRun: extent.endRun,
              })),
            },
          ],
        },
      ],
    });
  }

  function anchorHyperlinks(
    written: Package,
  ): { anchor: string; runs: string }[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    return elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:hyperlink",
    )
      .filter((hyperlink) =>
        hyperlink.attributes.some((a) => a.name === "w:anchor"),
      )
      .map((hyperlink) => ({
        anchor:
          hyperlink.attributes.find((a) => a.name === "w:anchor")?.value ?? "",
        runs: hyperlink.children
          .filter(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:r",
          )
          .map((run) =>
            run.children
              .filter(
                (c): c is XmlElement => c.type === "element" && c.tag === "w:t",
              )
              .map((t) =>
                t.children
                  .map((x) => (x.type === "text" ? x.value : ""))
                  .join(""),
              )
              .join(""),
          )
          .join(","),
      }));
  }

  const runs4 = [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }];

  it("wraps each of two adjacent internal links, losing neither descriptor", () => {
    const written = paragraphWithLinks(runs4, [
      { anchor: "one", startRun: 0, endRun: 2 },
      { anchor: "two", startRun: 2, endRun: 4 },
    ]);
    expect(anchorHyperlinks(written)).toEqual([
      { anchor: "one", runs: "a,b" },
      { anchor: "two", runs: "c,d" },
    ]);
  });

  it("leaves a crossing internal link plain while the earlier-starting extent wraps", () => {
    const written = paragraphWithLinks(runs4, [
      { anchor: "one", startRun: 0, endRun: 2 },
      { anchor: "crosses", startRun: 1, endRun: 3 },
    ]);
    expect(anchorHyperlinks(written)).toEqual([{ anchor: "one", runs: "a,b" }]);
  });

  it("writes a zero-width internal link plain, both at a run boundary and at the paragraph's start", () => {
    // A zero-width extent covers no run at all: at startRun 0 its end's position lookup (endRun - 1) names no run, and at startRun 1 its end resolves to the run BEFORE its own start, so either way there is no slice to wrap and the descriptor alone is lost.
    const atStart = paragraphWithLinks(
      [{ text: "a" }, { text: "b" }],
      [{ anchor: "zero-at-start", startRun: 0, endRun: 0 }],
    );
    expect(anchorHyperlinks(atStart)).toEqual([]);
    const betweenRuns = paragraphWithLinks(
      [{ text: "a" }, { text: "b" }],
      [{ anchor: "zero-between", startRun: 1, endRun: 1 }],
    );
    expect(anchorHyperlinks(betweenRuns)).toEqual([]);
  });

  it("writes an internal link whose start names no run plain rather than wrapping the tail", () => {
    // startRun === endRun === runs.length passes the extent contract (only endRun > runs.length is beyond it), so the start's lookup finds no element and the link is dropped rather than wrapping a tail slice it never named.
    const written = paragraphWithLinks(
      [{ text: "a" }, { text: "b" }],
      [{ anchor: "past-the-end", startRun: 2, endRun: 2 }],
    );
    expect(anchorHyperlinks(written)).toEqual([]);
  });

  it("wraps an internal link covering exactly one run", () => {
    const written = paragraphWithLinks(
      [{ text: "a" }, { text: "b" }],
      [{ anchor: "solo", startRun: 1, endRun: 2 }],
    );
    expect(anchorHyperlinks(written)).toEqual([{ anchor: "solo", runs: "b" }]);
  });
});
