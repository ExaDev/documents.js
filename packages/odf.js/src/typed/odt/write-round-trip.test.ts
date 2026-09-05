import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentDocument } from "document-schema.js";
import {
  PAGE_SIZE_A4,
  PAGE_SIZE_LETTER,
  assembleTree,
  flattenTree,
} from "document-schema.js";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import { parsePackage } from "../../package-io/read";
import { readOdt, readOdtContent } from "./read";
import { normaliseOdtContent, writeOdt, writeOdtContent } from "./write";

// The write side's correctness suite: what writeOdtContent produces reads back as the document it was given. The sibling suite (write.test.ts) pins the XML shapes -- which is what stops this one from passing on a writer and reader that agree with each other and with nobody else -- while this one states the law and every deviation from it by name.
//
// THE LAW: normaliseOdtContent(readOdtContent(writeOdtContent(document))) equals normaliseOdtContent(document), for every document the writer accepts. The normalisation is applied to BOTH sides, so it is a genuine equivalence rather than a licence to discard whatever the writer happened to lose: everything it restates is a fact ODF's own content model cannot carry, each named in normaliseOdtContent's own doc comment and each pinned individually further down this file.
//
// The strongest evidence here is the fixture pair at the end: two real, unmodified LibreOffice-generated .odt documents, read into the pivot, written back out by this writer, and read again -- equal on the nose. Those exercise real producer output (real styles, real style chains, real whitespace, real tables, a real image) rather than this package's own idea of what such a document looks like. Two further facts were established against LibreOffice directly and cannot be stated as an assertion here, so they are recorded instead: converting this writer's own output to PDF renders the explicit page break and the second section's own page size as three pages (A4, A4, Letter), and LibreOffice's own re-save of that output reads back through readOdtContent with both sections, their geometry, the merged table cell, the nested list, the image, and the whitespace all intact.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

// A 1x1 PNG.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// The one arm of ContentDocument an .odt ever is, named locally so this suite reaches a document's own sections without re-narrowing the whole union at every assertion.
type WordprocessingDocument = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>;

function loadFixture(name: string): Package {
  return parsePackage(new Uint8Array(readFileSync(join(FIXTURES_DIR, name))));
}

function contentOf(pkg: Package): WordprocessingDocument {
  const { metadata, sections } = readOdtContent(pkg);
  return { kind: "wordprocessing", metadata, sections };
}

// One full pass through the writer and back: the document the caller handed in, written to a real package, encoded to real bytes, decoded again, and read. The bytes leg is deliberately in the loop rather than short-circuited at the Package level -- a writer that built a correct Package but an unserialisable one would pass a Package-only round trip.
function roundTrip(document: ContentDocument): WordprocessingDocument {
  return contentOf(decodePackage(encodePackage(writeOdtContent(document))));
}

function expectRoundTrip(document: ContentDocument): void {
  expect(normaliseOdtContent(roundTrip(document))).toEqual(
    normaliseOdtContent(document),
  );
}

function documentOf(blocks: ContentBlock[]): WordprocessingDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [{ pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks }],
  };
}

const KITCHEN_SINK: WordprocessingDocument = {
  kind: "wordprocessing",
  metadata: {
    title: "Writer round trip",
    author: "odf.js",
    subject: "The odt write path",
    keywords: ["odf", "writer"],
    creator: "odf.js test suite",
    createdIso: "2026-09-03T10:00:00Z",
    modifiedIso: "2026-09-03T11:00:00Z",
  },
  sections: [
    {
      pageSize: PAGE_SIZE_A4,
      margins: MARGINS,
      blocks: [
        {
          kind: "paragraph",
          headingLevel: 1,
          styleId: "Heading1",
          runs: [{ text: "Title" }],
        },
        {
          kind: "paragraph",
          alignment: "justify",
          spacingBeforePt: 6,
          spacingAfterPt: 3,
          lineSpacing: 1.5,
          indentLeftPt: 18,
          indentFirstLinePt: 9,
          runs: [
            { text: "Plain, " },
            { text: "bold", bold: true },
            { text: ", " },
            {
              text: "italic",
              italic: true,
              sizePt: 12,
              fontFamily: "Liberation Serif",
            },
            { text: ", " },
            { text: "struck", strike: true, color: { r: 0.8, g: 0, b: 0 } },
            { text: " and " },
            {
              text: "a link",
              underline: true,
              hyperlink: "https://example.invalid/?a=1&b=2",
            },
            { text: "." },
          ],
        },
        {
          kind: "paragraph",
          runs: [{ text: "  leading, three   inner, a\ttab and a\nbreak.  " }],
        },
        {
          kind: "paragraph",
          runs: [{ text: "First" }],
          list: { numId: "ordered:list1", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "Nested" }],
          list: { numId: "ordered:list1", level: 1 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "Second" }],
          list: { numId: "ordered:list1", level: 0 },
        },
        {
          kind: "paragraph",
          runs: [{ text: "A bullet" }],
          list: { numId: "bullet:list2", level: 0 },
        },
        {
          kind: "table",
          columnWidthsPt: [120, 120, 120],
          rows: [
            {
              heightPt: 20,
              cells: [
                {
                  colSpan: 2,
                  background: { kind: "solid", color: { r: 1, g: 1, b: 0.6 } },
                  borders: {
                    top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
                    bottom: {
                      color: { r: 0, g: 0, b: 0 },
                      widthPt: 1,
                      style: "dashed",
                    },
                  },
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "Merged header" }] },
                  ],
                },
                { blocks: [] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "Third" }] }] },
              ],
            },
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "b" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "c" }] }] },
              ],
            },
          ],
        },
        { kind: "paragraph", runs: [{ text: "An image follows." }] },
        {
          kind: "image",
          format: "png",
          base64: PNG_BASE64,
          widthPt: 36,
          heightPt: 36,
          altText: "A red dot",
        },
        { kind: "pageBreak" },
        {
          kind: "paragraph",
          runs: [{ text: "After an explicit page break." }],
        },
      ],
    },
    {
      pageSize: PAGE_SIZE_LETTER,
      margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
      breakType: "nextPage",
      blocks: [
        {
          kind: "paragraph",
          runs: [{ text: "A second section, on Letter paper." }],
        },
      ],
    },
  ],
};

describe("the odt round-trip law", () => {
  it("holds over a document exercising every construct this writer writes", () => {
    expectRoundTrip(KITCHEN_SINK);
  });

  it("holds through the tree form as well as the flat one", () => {
    const tree = assembleTree(KITCHEN_SINK);
    const written = writeOdt(tree);
    expect(normaliseOdtContent(flattenTree(readOdt(written)))).toEqual(
      normaliseOdtContent(KITCHEN_SINK),
    );
  });

  it("holds for a document whose only content is one empty paragraph", () => {
    expectRoundTrip(documentOf([{ kind: "paragraph", runs: [] }]));
  });

  it("is idempotent, so the canonical form is a genuine equivalence and not a moving target", () => {
    const once = normaliseOdtContent(KITCHEN_SINK);
    expect(normaliseOdtContent(once)).toEqual(once);
  });

  it("writes a package that survives its own second write unchanged", () => {
    const first = roundTrip(KITCHEN_SINK);
    expect(normaliseOdtContent(roundTrip(first))).toEqual(
      normaliseOdtContent(first),
    );
  });
});

// Every restatement below is a fact about ODF, not about this writer's convenience: each is something the format's own content model cannot carry, and each is asserted here on its own so that a future change which quietly widens the normalisation fails a test rather than passing one.
describe("what the canonical form restates, and why", () => {
  it("splits a run at a tab, a line break, and a collapsing space run, because each is an element in ODF", () => {
    const document = documentOf([
      { kind: "paragraph", runs: [{ text: "a\tb\nc  d", bold: true }] },
    ]);
    const section = normaliseOdtContent(document).sections[0]!;
    const paragraph = section.blocks[0]!;
    if (paragraph.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.runs.map((run) => run.text)).toEqual([
      "a",
      "\t",
      "b",
      "\n",
      "c",
      "  ",
      "d",
    ]);
    expect(paragraph.runs.every((run) => run.bold === true)).toBe(true);
    expectRoundTrip(document);
  });

  it("drops an empty run and merges adjacent identically-formatted ones, because neither has its own spelling", () => {
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [
          { text: "one" },
          { text: "" },
          { text: " two" },
          { text: " three", bold: true },
        ],
      },
    ]);
    const paragraph = normaliseOdtContent(document).sections[0]!.blocks[0]!;
    if (paragraph.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.runs).toEqual([
      { text: "one two" },
      { text: " three", bold: true },
    ]);
    expectRoundTrip(document);
  });

  it("keeps a heading's styleId, because a heading's identity is structural rather than a style name", () => {
    const document = documentOf([
      {
        kind: "paragraph",
        headingLevel: 2,
        styleId: "SomethingElse",
        runs: [{ text: "H" }],
      },
    ]);
    const paragraph = roundTrip(document).sections[0]!.blocks[0]!;
    if (paragraph.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.headingLevel).toBe(2);
    expect(paragraph.styleId).toBe("Heading2");
    expectRoundTrip(document);
  });

  it("drops a non-heading paragraph's styleId, because the written document's style names are this writer's own", () => {
    const document = documentOf([
      {
        kind: "paragraph",
        styleId: "MyHouseStyle",
        alignment: "center",
        runs: [{ text: "x" }],
      },
    ]);
    const written = roundTrip(document).sections[0]!.blocks[0]!;
    if (written.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    // The read-back paragraph names the automatic style the writer minted for its alignment, not the caller's own name -- which is why the canonical form states neither.
    expect(written.styleId).toBe("P1");
    expect(written.alignment).toBe("center");
    const paragraph = normaliseOdtContent(document).sections[0]!.blocks[0]!;
    if (paragraph.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.styleId).toBeUndefined();
    expectRoundTrip(document);
  });

  it("renumbers list identities per list encountered in document order, keeping the kind", () => {
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "a" }],
        list: { numId: "bullet:whatever", level: 0, checked: true },
      },
      { kind: "paragraph", runs: [{ text: "between" }] },
      {
        kind: "paragraph",
        runs: [{ text: "b" }],
        list: { numId: "bullet:whatever", level: 0 },
      },
    ]);
    const blocks = normaliseOdtContent(document).sections[0]!.blocks;
    const listOf = (block: ContentBlock): unknown =>
      block.kind === "paragraph" ? block.list : undefined;
    // Two separate runs of one incoming numId are two ODF lists, and each gets its own identity; `checked` has no ODF spelling at all and is dropped.
    expect(listOf(blocks[0]!)).toEqual({ numId: "bullet:list1", level: 0 });
    expect(listOf(blocks[2]!)).toEqual({ numId: "bullet:list2", level: 0 });
    expectRoundTrip(document);
  });

  it("folds a page-break block onto the following paragraph, because ODF has no standalone page break", () => {
    const document = documentOf([
      { kind: "paragraph", runs: [{ text: "before" }] },
      { kind: "pageBreak" },
      { kind: "paragraph", runs: [{ text: "after" }] },
    ]);
    const blocks = normaliseOdtContent(document).sections[0]!.blocks;
    expect(blocks).toHaveLength(2);
    const second = blocks[1]!;
    if (second.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(second.pageBreakBefore).toBe(true);
    expectRoundTrip(document);
  });

  it("opens an anchor paragraph for an image with nothing before it, because a frame is anchored inside one", () => {
    const document = documentOf([
      {
        kind: "image",
        format: "png",
        base64: PNG_BASE64,
        widthPt: 12,
        heightPt: 12,
      },
    ]);
    const blocks = normaliseOdtContent(document).sections[0]!.blocks;
    expect(blocks.map((block) => block.kind)).toEqual(["paragraph", "image"]);
    expectRoundTrip(document);
  });

  it("empties a covered cell and states an absent border style, because that is all ODF's own spellings carry", () => {
    const document = documentOf([
      {
        kind: "table",
        columnWidthsPt: [40, 40],
        rows: [
          {
            cells: [
              {
                colSpan: 2,
                borders: { top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 } },
                blocks: [{ kind: "paragraph", runs: [{ text: "wide" }] }],
              },
              // A covered position carrying content the source never rendered: table:covered-table-cell has nowhere to put it.
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "ignored" }] }],
              },
            ],
          },
        ],
      },
    ]);
    const table = normaliseOdtContent(document).sections[0]!.blocks[0]!;
    if (table.kind !== "table") {
      throw new Error("expected a table");
    }
    expect(table.rows[0]!.cells[1]).toEqual({ blocks: [] });
    expect(table.rows[0]!.cells[0]!.borders?.top?.style).toBe("solid");
    expectRoundTrip(document);
  });

  it("quantises a colour to eight bits per channel, because ODF states colour as six hex digits", () => {
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "x", color: { r: 0.9, g: 0.5, b: 0.1 } }],
      },
    ]);
    const paragraph = normaliseOdtContent(document).sections[0]!.blocks[0]!;
    if (paragraph.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    // 0.9 * 255 is 229.5, which rounds to 230 -- the nearest value ODF's own six-hex-digit spelling can carry.
    expect(paragraph.runs[0]!.color).toEqual({
      r: 230 / 255,
      g: 128 / 255,
      b: 26 / 255,
    });
    expectRoundTrip(document);
  });

  it("states breakType as nextPage on every section after the first, since an ODF page-style switch forces a break", () => {
    const document: WordprocessingDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "one" }] }],
        },
        {
          pageSize: PAGE_SIZE_LETTER,
          margins: MARGINS,
          breakType: "continuous",
          blocks: [{ kind: "paragraph", runs: [{ text: "two" }] }],
        },
      ],
    };
    const sections = normaliseOdtContent(document).sections;
    expect(sections[0]!.breakType).toBeUndefined();
    expect(sections[1]!.breakType).toBe("nextPage");
    expectRoundTrip(document);
  });

  it("drops the residue channel, the one loss this writer takes rather than refuses", () => {
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "x" }],
        source: { format: "odt", xml: "<text:ruby/>" },
      },
    ]);
    const paragraph = normaliseOdtContent(document).sections[0]!.blocks[0]!;
    if (paragraph.kind !== "paragraph") {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.source).toBeUndefined();
    expectRoundTrip(document);
  });

  it("drops metadata fields ODF or this package's own reader cannot carry back", () => {
    const document: WordprocessingDocument = {
      kind: "wordprocessing",
      metadata: { title: "T", producer: "a PDF writer", language: "en-GB" },
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }],
        },
      ],
    };
    expect(normaliseOdtContent(document).metadata).toEqual({ title: "T" });
    expectRoundTrip(document);
  });
});

// The real-producer half of the evidence: two unmodified LibreOffice-generated documents, through the pivot and back out through this writer. Nothing here is hand-built, so a construct this writer got subtly wrong against real style chains, real whitespace, or real table markup shows up as an inequality rather than as a gap nobody wrote a fixture for.
describe("real LibreOffice documents survive a read, a write, and a read", () => {
  for (const name of ["minimal.odt", "kitchen-sink.odt"]) {
    it(`round-trips ${name}`, () => {
      const document = contentOf(loadFixture(name));
      expectRoundTrip(document);
    });
  }

  it("preserves a real document's whitespace, formatting, headings, list nesting, and table exactly", () => {
    const document = contentOf(loadFixture("kitchen-sink.odt"));
    const written = roundTrip(document);
    const flatten = (value: WordprocessingDocument): string[] =>
      value.sections.flatMap((section) =>
        section.blocks.flatMap((block) => {
          if (block.kind === "paragraph") {
            return [
              `p:${block.headingLevel ?? "-"}:${block.list?.level ?? "-"}:${block.runs
                .map((run) => `${run.text}|${run.bold === true ? "b" : ""}`)
                .join("")}`,
            ];
          }
          if (block.kind === "table") {
            return [
              `table:${block.rows
                .map((row) =>
                  row.cells
                    .map((cell) =>
                      cell.blocks
                        .map((cellBlock) =>
                          cellBlock.kind === "paragraph"
                            ? cellBlock.runs.map((run) => run.text).join("")
                            : cellBlock.kind,
                        )
                        .join(""),
                    )
                    .join(","),
                )
                .join(";")}`,
            ];
          }
          return [block.kind];
        }),
      );
    expect(flatten(written)).toEqual(flatten(normaliseOdtContent(document)));
  });
});
