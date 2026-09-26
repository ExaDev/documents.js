import { describe, expect, it } from "vitest";
import type {
  ConstructDescriptor,
  ContentBlock,
  ContentSection,
} from "document-schema.js";
import { findConstructMarkerImbalance } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { elementsWithTag, rootElement } from "../util";
import { readDocxContent } from "./read";
import { buildDocxPackageFromContent } from "./write";
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
describe("buildDocxPackageFromContent: construct round trip", () => {
  it("writes a non-writable run-level construct extent as its paragraph's own content, with no markers", () => {
    // The kinds readDocxContent produces at run level that this writer has no spelling for: a run-scoped content control (a legacy w:ffData form field) would need its control payload rebuilt from the descriptor, and a comment or note reference points into parts this writer does not emit. Its runs write as ordinary content and only the descriptor is lost — the same content-preserving policy the block-level foreign constructs above follow.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "plain " }, { text: "controlled" }],
              constructs: [
                {
                  descriptor: {
                    kind: "contentControl",
                    controlType: "checkbox",
                    checked: true,
                  },
                  startRun: 1,
                  endRun: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    expect(
      elementsWithTag(
        document === undefined ? [] : [document],
        "w:bookmarkStart",
      ),
    ).toHaveLength(0);
    expect(
      elementsWithTag(document === undefined ? [] : [document], "w:ffData"),
    ).toHaveLength(0);
    const roundTripped = readDocxContent(written).sections[0]?.blocks[0];
    expect(
      roundTripped?.kind === "paragraph"
        ? roundTripped.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("plain controlled");
  });

  it("round-trips a mid-paragraph complex field as a field run extent, re-emitting its fldChar characters between the runs the range names", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("Page ")])]),
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
        el("w:r", {}, [
          el("w:instrText", { "xml:space": "preserve" }, [txt(" NUMPAGES ")]),
        ]),
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
        el("w:r", {}, [el("w:t", {}, [txt("10")])]),
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
        el("w:r", {}, [el("w:t", {}, [txt(" of pages")])]),
      ]),
    ]);
    const { before, after } = roundTrip(source);
    expect(after).toEqual(before);
    const paragraph = before[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "field", instruction: " NUMPAGES " },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("round-trips a mid-paragraph w:fldSimple's field extent through the writer's own fldChar spelling, which reads back as the same extent", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("Today is ")])]),
        el("w:fldSimple", { "w:instr": " DATE " }, [
          el("w:r", {}, [el("w:t", {}, [txt("2026-08-20")])]),
        ]),
        el("w:r", {}, [el("w:t", {}, [txt(".")])]),
      ]),
    ]);
    const { before, after } = roundTrip(source);
    expect(after).toEqual(before);
    const paragraph = before[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "field", instruction: " DATE " },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("round-trips an internal @w:anchor link extent, wrapping exactly the runs the range names in one w:hyperlink", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("See ")])]),
        el("w:hyperlink", { "w:anchor": "target" }, [
          el("w:r", {}, [el("w:t", {}, [txt("the section")])]),
          el("w:r", {}, [el("w:t", {}, [txt(" below")])]),
        ]),
        el("w:r", {}, [el("w:t", {}, [txt(" for details")])]),
      ]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const paragraph = before[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: {
          kind: "link",
          target: { kind: "internal", anchor: "target" },
        },
        startRun: 1,
        endRun: 3,
      },
    ]);
    // The wrap covers exactly the link's own two runs, never the text either side.
    const document = rootElement(written.parts["word/document.xml"]);
    const hyperlinks = elementsWithTag(
      document === undefined ? [] : [document],
      "w:hyperlink",
    );
    expect(hyperlinks).toHaveLength(1);
    expect(
      hyperlinks[0]?.type === "element"
        ? hyperlinks[0].attributes.find((a) => a.name === "w:anchor")?.value
        : undefined,
    ).toBe("target");
    expect(
      hyperlinks[0]?.type === "element"
        ? hyperlinks[0].children.filter(
            (child) => child.type === "element" && child.tag === "w:r",
          ).length
        : 0,
    ).toBe(2);
  });

  it("writes a crossing internal link extent's runs as plain content rather than a mis-nested wrap", () => {
    // Two internal links whose ranges cross cannot both wrap (nesting w:hyperlink inside w:hyperlink is not WordprocessingML), and Word itself cannot produce the shape — only a hand-built ContentDocument can. The earlier link wraps; the crossing one's runs stay plain and only its descriptor is lost, the same content-preserving policy an unwritable construct kind follows.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "first" },
                  },
                  startRun: 0,
                  endRun: 3,
                },
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "second" },
                  },
                  startRun: 1,
                  endRun: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const hyperlinks = elementsWithTag(
      document === undefined ? [] : [document],
      "w:hyperlink",
    );
    expect(hyperlinks).toHaveLength(1);
    const roundTripped = readDocxContent(written).sections[0]?.blocks[0];
    expect(
      roundTripped?.kind === "paragraph"
        ? roundTripped.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("abc");
  });

  it("resolves two overlapping internal links by the earliest-starting extent, regardless of the constructs array's own order", () => {
    // The winner is decided by sorting the extents by startRun (ties broken by the LONGER extent first), never by the order they happen to appear in `constructs` — this paragraph lists the later-starting, shorter link FIRST specifically to prove the sort, not the array order, decides the winner.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "later-shorter" },
                  },
                  startRun: 1,
                  endRun: 3,
                },
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "earlier-longer" },
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
    const document = rootElement(written.parts["word/document.xml"]);
    const hyperlinks = elementsWithTag(
      document === undefined ? [] : [document],
      "w:hyperlink",
    );
    expect(hyperlinks).toHaveLength(1);
    expect(
      hyperlinks[0]?.type === "element"
        ? hyperlinks[0].attributes.find((a) => a.name === "w:anchor")?.value
        : undefined,
    ).toBe("earlier-longer");
  });

  it("wraps two non-overlapping internal links independently, without one's own wrap falsely blocking the other", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "a" },
                { text: "b" },
                { text: "between" },
                { text: "c" },
                { text: "d" },
              ],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "first-pair" },
                  },
                  startRun: 0,
                  endRun: 2,
                },
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "second-pair" },
                  },
                  startRun: 3,
                  endRun: 5,
                },
              ],
            },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const hyperlinks = elementsWithTag(
      document === undefined ? [] : [document],
      "w:hyperlink",
    );
    expect(hyperlinks).toHaveLength(2);
    expect(
      hyperlinks.map(
        (h) => h.attributes.find((a) => a.name === "w:anchor")?.value,
      ),
    ).toEqual(["first-pair", "second-pair"]);
    expect(
      hyperlinks.map(
        (h) =>
          h.children.filter(
            (child) => child.type === "element" && child.tag === "w:r",
          ).length,
      ),
    ).toEqual([2, 2]);
  });

  it("refuses a run-level extent whose range does not name real runs, rather than writing markers at a made-up position", () => {
    const faulty = {
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph" as const,
              runs: [{ text: "x" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor" as const,
                    anchorType: "bookmark" as const,
                    name: "beyond",
                  },
                  startRun: 0,
                  endRun: 5,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => buildDocxPackageFromContent(faulty)).toThrow(
      /run-level construct extent/,
    );
  });

  it("round-trips a multi-paragraph complex field, putting its characters back inside the extent's own paragraphs", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
        el("w:r", {}, [el("w:instrText", {}, [txt(' TOC \\o "1-3" \\h ')])]),
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
        el("w:r", {}, [el("w:t", {}, [txt("Chapter 1")])]),
      ]),
      para("Chapter 2"),
      el("w:p", {}, [
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
      ]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const start = after[0]?.blocks[0];
    expect(
      start?.kind === "constructStart" ? start.descriptor : undefined,
    ).toEqual({ kind: "field", instruction: ' TOC \\o "1-3" \\h ' });
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    // The field's own characters live inside the extent's paragraphs, so the body gains no paragraph of its own for them: the source above defines exactly three top-level w:p elements (the field-begin paragraph, "Chapter 2", and the field-end paragraph).
    const SOURCE_PARAGRAPH_COUNT = 3;
    expect(
      body?.type === "element"
        ? body.children.filter(
            (child) => child.type === "element" && child.tag === "w:p",
          ).length
        : undefined,
    ).toBe(SOURCE_PARAGRAPH_COUNT);
  });

  it("round-trips a simple field that is a paragraph's whole content", () => {
    const sections = expectStableRoundTrip(
      docxPackage([
        el("w:p", {}, [
          el("w:fldSimple", { "w:instr": " PAGE " }, [
            el("w:r", {}, [el("w:t", {}, [txt("4")])]),
          ]),
        ]),
      ]),
    );
    const start = sections[0]?.blocks[0];
    expect(
      start?.kind === "constructStart" ? start.descriptor : undefined,
    ).toEqual({ kind: "field", instruction: " PAGE " });
  });

  // The kinds readDocxContent never produces, which a ContentDocument from another codec still can. Each writes its content and drops only the descriptor, since WordprocessingML has no block-level element for any of them — what must never happen is an element written where it does not parse.
  it.each([
    [
      "a block-scoped link",
      {
        kind: "link",
        target: { kind: "external", uri: "https://example.com" },
      },
    ],
    ["a named division", { kind: "division", name: "part-one" }],
    [
      "a format-change provenance",
      { kind: "provenance", change: "formatChange", author: "Ada" },
    ],
    [
      "a footnote anchor",
      { kind: "anchor", anchorType: "footnote", name: "1" },
    ],
  ] satisfies [string, ConstructDescriptor][])(
    "writes %s as its own content, with no wrapper element and no lost paragraph",
    (_label, descriptor) => {
      const blocks: ContentBlock[] = [
        { kind: "constructStart", descriptor },
        { kind: "paragraph", runs: [{ text: "inside" }] },
        { kind: "constructEnd" },
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
      const roundTripped = readDocxContent(written).sections[0]?.blocks ?? [];
      expect(roundTripped.map((block) => block.kind)).toEqual(["paragraph"]);
      const paragraph = roundTripped[0];
      expect(
        paragraph?.kind === "paragraph" ? paragraph.runs[0]?.text : undefined,
      ).toBe("inside");
    },
  );

  it("round-trips constructs nested inside each other, and inside a table cell", () => {
    // A content control wrapping a wholly tracked-inserted paragraph — Word's own nesting order, since CT_RunTrackChange has no w:p in its content model and so can never be the structural outer element around a block-level w:sdt.
    const trackedParagraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:rPr", {}, [el("w:ins", { "w:id": "1", "w:author": "Ada" })]),
      ]),
      el("w:ins", { "w:id": "2", "w:author": "Ada" }, [
        el("w:r", {}, [el("w:t", {}, [txt("controlled")])]),
      ]),
    ]);
    const outer = el("w:sdt", {}, [
      el("w:sdtPr", {}, [el("w:richText")]),
      el("w:sdtContent", {}, [trackedParagraph]),
    ]);
    const cellControl = el("w:sdt", {}, [
      el("w:sdtPr", {}, [el("w:text")]),
      el("w:sdtContent", {}, [para("in a cell")]),
    ]);
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "2880" })]),
      el("w:tr", {}, [el("w:tc", {}, [cellControl])]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([outer, table]));
    for (const section of sections) {
      expect(findConstructMarkerImbalance(section.blocks)).toBeUndefined();
    }
  });
});
