import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  DocumentTree,
  SourceResidue,
} from "document-schema.js";
import {
  PAGE_SIZE_A4,
  PAGE_SIZE_LETTER,
  assembleTree,
  flattenTree,
} from "document-schema.js";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import { readManifest } from "../../manifest";
import { parsePackage } from "../../package-io/read";
import { buildXml } from "../../xml/build";
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

  it("restores a quarantined non-content package part verbatim, through the tree form", () => {
    // A settings.xml this writer never generates itself (package-io/scaffold.ts's own note: "settings.xml is not created at all") -- exactly the shape a reader quarantines wholesale on the way in (typed/shared/constructs.ts's collectOdfNonContentPartResidue), an unmapped element this writer could not have produced by writing the document, so its survival proves the residue channel restored it rather than the ordinary content writer coincidentally reproducing it.
    const settingsXml =
      '<office:document-settings office:version="1.3"><office:settings><config:config-item-set config:name="ooo:view-settings"><config:config-item config:name="ViewAreaTop" config:type="int">0</config:config-item></config:config-item-set></office:settings></office:document-settings>';
    const source: Record<string, SourceResidue> = {
      "settings.xml": { format: "odt", xml: settingsXml },
    };
    const tree: DocumentTree = {
      ...assembleTree(
        documentOf([{ kind: "paragraph", runs: [{ text: "hello" }] }]),
      ),
      source,
    };

    const written = writeOdt(tree);
    const settingsPart = written.parts["settings.xml"];
    expect(settingsPart?.kind).toBe("xml");
    expect(
      settingsPart?.kind === "xml" &&
        settingsPart.nodes.some(
          (node) =>
            node.type === "element" && node.tag === "office:document-settings",
        ),
    ).toBe(true);
    const manifest = readManifest(written);
    expect(
      manifest.entries.some((entry) => entry.fullPath === "settings.xml"),
    ).toBe(true);

    // The bytes leg is in the loop for the same reason roundTrip() puts it there: a writer that built a correct Package but an unserialisable one would pass a Package-only check.
    const readBack = readOdt(decodePackage(encodePackage(written)));
    expect(readBack.source).toEqual(source);
  });

  it("holds for a table cell containing a nested list and a nested table", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "table",
          columnWidthsPt: [200],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "Before the list" }] },
                    {
                      kind: "paragraph",
                      runs: [{ text: "Item one" }],
                      list: { numId: "bullet:list1", level: 0 },
                    },
                    {
                      kind: "paragraph",
                      runs: [{ text: "Item two" }],
                      list: { numId: "bullet:list1", level: 0 },
                    },
                    {
                      kind: "table",
                      columnWidthsPt: [80, 80],
                      rows: [
                        {
                          cells: [
                            {
                              blocks: [
                                {
                                  kind: "paragraph",
                                  runs: [{ text: "Nested A" }],
                                },
                              ],
                            },
                            {
                              blocks: [
                                {
                                  kind: "paragraph",
                                  runs: [{ text: "Nested B" }],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                    {
                      kind: "paragraph",
                      runs: [{ text: "After the nested table" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
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

describe("preformatted (#1020)", () => {
  it("round-trips a preformatted paragraph with no other formatting of its own by referencing Preformatted_20_Text directly as text:style-name", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "$ echo hi" }],
          preformatted: true,
        },
      ]),
    );
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "$ echo hi" }],
          preformatted: true,
        },
      ]),
    );
    const content = decodePackage(encodePackage(pkg)).parts["content.xml"];
    if (content?.kind !== "xml") {
      throw new Error("expected content.xml to be an XML part");
    }
    expect(buildXml(content.nodes)).toContain(
      'text:style-name="Preformatted_20_Text"',
    );
  });

  it("round-trips a preformatted paragraph that ALSO carries real formatting of its own, via an interned automatic style parented to Preformatted_20_Text", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "  indented", bold: true }],
          alignment: "center",
          preformatted: true,
        },
      ]),
    );
  });

  it("does not mark an ordinary paragraph preformatted just because a preformatted paragraph exists elsewhere in the same document", () => {
    const roundTripped = roundTrip(
      documentOf([
        { kind: "paragraph", runs: [{ text: "code" }], preformatted: true },
        { kind: "paragraph", runs: [{ text: "ordinary prose" }] },
      ]),
    );
    const [preformattedBlock, ordinaryBlock] = roundTrippedBlocks(roundTripped);
    expect(preformattedBlock).toMatchObject({ preformatted: true });
    expect(ordinaryBlock && "preformatted" in ordinaryBlock).toBe(false);
  });
});

// ExaDev/documents.js#969: the writer's own construct-writing scope, closed for the odt writer -- a field and a bookmark anchor entirely within one paragraph (run-scoped, ContentParagraph.constructs), and a division/index wrapper bracketing whole blocks (block-scoped, a constructStart/constructEnd pair). Every case here round-trips through the identical law the rest of this suite states: normaliseOdtContent(read(write(document))) equals normaliseOdtContent(document).
describe("fidelity constructs written (#969)", () => {
  it("round-trips a field from its own cached instruction and result", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "Author: " }, { text: "Joe" }, { text: "." }],
          constructs: [
            {
              descriptor: {
                kind: "field",
                instruction: '<text:author-name text:fixed="false"/>',
                cachedResult: "Joe",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a field carrying no cached text as a point extent", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "Page " }, { text: " of many" }],
          constructs: [
            {
              descriptor: {
                kind: "field",
                instruction: "<text:page-number/>",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a field whose own cached text mixes formatting", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [
            { text: "before " },
            { text: "bold", bold: true },
            { text: "plain" },
            { text: " after" },
          ],
          constructs: [
            {
              descriptor: {
                kind: "field",
                instruction: "<text:expression/>",
                cachedResult: "boldplain",
              },
              startRun: 1,
              endRun: 3,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a point bookmark", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "before" }, { text: "after" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "b1",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a ranged bookmark spanning part of one paragraph", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [
            { text: "see " },
            { text: "target", bold: true },
            { text: " here" },
          ],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "target1",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips two overlapping ranged bookmarks in one paragraph", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "one" }, { text: "two" }, { text: "three" }],
          constructs: [
            {
              descriptor: { kind: "anchor", anchorType: "bookmark", name: "a" },
              startRun: 0,
              endRun: 2,
            },
            {
              descriptor: { kind: "anchor", anchorType: "bookmark", name: "b" },
              startRun: 1,
              endRun: 3,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a field and a ranged bookmark together, keeping a bookmark boundary that falls inside the field's own range clamped just after it", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "value: " }, { text: "42" }, { text: "." }],
          constructs: [
            {
              descriptor: {
                kind: "field",
                instruction: "<text:expression/>",
                cachedResult: "42",
              },
              startRun: 1,
              endRun: 2,
            },
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "value",
              },
              startRun: 0,
              endRun: 2,
            },
          ],
        },
      ]),
    );
  });

  it("round-trips a division wrapping a single paragraph", () => {
    expectRoundTrip(
      documentOf([
        { kind: "constructStart", descriptor: { kind: "division" } },
        { kind: "paragraph", runs: [{ text: "inside the division" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division's own name, protected flag, and column count", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "division",
            name: "Sidebar",
            protected: true,
            columnCount: 3,
          },
        },
        { kind: "paragraph", runs: [{ text: "column text" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division's external-chapter link", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "division",
            linked: { href: "chapters/one.odt", sectionName: "Chapter1" },
          },
        },
        { kind: "paragraph", runs: [{ text: "linked content" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division wrapping a table and multiple paragraphs", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Body" },
        },
        { kind: "paragraph", runs: [{ text: "first" }] },
        {
          kind: "table",
          columnWidthsPt: [100],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "cell" }] }] },
              ],
            },
          ],
        },
        { kind: "paragraph", runs: [{ text: "last" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips two sibling divisions in the same section", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "First" },
        },
        { kind: "paragraph", runs: [{ text: "one" }] },
        { kind: "constructEnd" },
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Second" },
        },
        { kind: "paragraph", runs: [{ text: "two" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division nested inside another division", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Outer" },
        },
        { kind: "paragraph", runs: [{ text: "outer text" }] },
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Inner" },
        },
        { kind: "paragraph", runs: [{ text: "inner text" }] },
        { kind: "constructEnd" },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips an index wrapper recovering its own element identity from residue", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "contentControl",
            controlType: "index",
            tag: "Table of Contents1",
            source: {
              format: "odt",
              xml: "<text:table-of-content-source/>",
            },
          },
        },
        { kind: "paragraph", runs: [{ text: "Chapter One .......... 1" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a bibliography index wrapper, a different one of the seven wrapper tags", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "contentControl",
            controlType: "index",
            source: {
              format: "odt",
              xml: "<text:bibliography-source/>",
            },
          },
        },
        { kind: "paragraph", runs: [{ text: "Author, Title, Year" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a division nested inside an index wrapper's own cached body", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: {
            kind: "contentControl",
            controlType: "index",
            source: {
              format: "odt",
              xml: "<text:table-of-content-source/>",
            },
          },
        },
        { kind: "paragraph", runs: [{ text: "heading" }] },
        {
          kind: "constructStart",
          descriptor: { kind: "division", name: "Nested" },
        },
        { kind: "paragraph", runs: [{ text: "nested entry" }] },
        { kind: "constructEnd" },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("refuses an index wrapper descriptor with no recoverable *-source residue", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "constructStart",
            descriptor: { kind: "contentControl", controlType: "index" },
          },
          { kind: "paragraph", runs: [{ text: "x" }] },
          { kind: "constructEnd" },
        ]),
      ),
    ).toThrow(/no fact naming which of the seven ODF index wrappers/);
  });
  it("round-trips a block-scope bookmark range spanning two paragraphs", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "Cross" },
        },
        { kind: "paragraph", runs: [{ text: "first paragraph" }] },
        { kind: "paragraph", runs: [{ text: "second paragraph" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a block-scope bookmark range spanning a table between its paragraphs", () => {
    expectRoundTrip(
      documentOf([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "Wide" },
        },
        { kind: "paragraph", runs: [{ text: "before the table" }] },
        {
          kind: "table",
          columnWidthsPt: [100],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "cell" }] }] },
              ],
            },
          ],
        },
        { kind: "paragraph", runs: [{ text: "after the table" }] },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("round-trips a block-scope bookmark range nested inside a division", () => {
    expectRoundTrip(
      documentOf([
        { kind: "constructStart", descriptor: { kind: "division", name: "D" } },
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "Inner" },
        },
        { kind: "paragraph", runs: [{ text: "inner content" }] },
        { kind: "constructEnd" },
        { kind: "constructEnd" },
      ]),
    );
  });

  it("refuses a block-scope bookmark range whose extent contains no paragraph, by name", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "constructStart",
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "Empty",
            },
          },
          {
            kind: "table",
            columnWidthsPt: [100],
            rows: [
              {
                cells: [
                  { blocks: [{ kind: "paragraph", runs: [{ text: "only" }] }] },
                ],
              },
            ],
          },
          { kind: "constructEnd" },
        ]),
      ),
    ).toThrow(/no paragraph to carry its marker halves/);
  });

  it("round-trips a footnote anchor with its definitions-table body through writeOdt", () => {
    // The tree-level law for notes: writeOdt (the entry point that can see the definitions table) writes the inline text:note, and reading the package back recovers the same citation run, anchor extent, and definitions entry.
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "1" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "footnote",
              name: "note1",
              definition: "note:note1",
            },
            startRun: 0,
            endRun: 1,
          },
        ],
      },
    ]);
    const tree = assembleTree(document);
    tree.definitions = {
      "note:note1": {
        kind: "footnote",
        citation: "1",
        body: [{ kind: "paragraph", runs: [{ text: "the note body" }] }],
      },
    };
    const rewritten = readOdtContent(writeOdt(tree));
    expect(rewritten.sections[0]!.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "1" }],
      constructs: [
        {
          descriptor: {
            kind: "anchor",
            anchorType: "footnote",
            name: "note1",
            definition: "note:note1",
          },
          startRun: 0,
          endRun: 1,
        },
      ],
    });
    expect(rewritten.definitions?.["note:note1"]).toMatchObject({
      kind: "footnote",
      citation: "1",
    });
  });

  it("refuses a note anchor when no definitions table is in reach, by name", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "paragraph",
            runs: [{ text: "1" }],
            constructs: [
              {
                descriptor: {
                  kind: "anchor",
                  anchorType: "footnote",
                  name: "note1",
                  definition: "note:note1",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
      ),
    ).toThrow(/does not spell back yet/);
  });

  it("refuses a cyclic note definition by name rather than recursing to stack exhaustion", () => {
    // The hostile shape the security review of this PR named: a note body whose own anchor resolves back to the entry still being written (the reader assigns the outer entry after parsing the nested body, so a reused text:id lands here).
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "1" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "footnote",
              name: "note1",
              definition: "note:note1",
            },
            startRun: 0,
            endRun: 1,
          },
        ],
      },
    ]);
    const tree = assembleTree(document);
    tree.definitions = {
      "note:note1": {
        kind: "footnote",
        citation: "1",
        body: [
          {
            kind: "paragraph",
            runs: [{ text: "nested" }],
            constructs: [
              {
                descriptor: {
                  kind: "anchor",
                  anchorType: "footnote",
                  name: "note1",
                  definition: "note:note1",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ],
      },
    };
    expect(() => writeOdt(tree)).toThrow(/cyclic note definition/);
  });

  it("round-trips a comment anchor with author, date, and body through writeOdt", () => {
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "remarked" }],
        constructs: [
          {
            descriptor: {
              kind: "anchor",
              anchorType: "comment",
              name: "annotation1",
              definition: "comment:annotation1",
            },
            startRun: 0,
            endRun: 1,
          },
        ],
      },
    ]);
    const tree = assembleTree(document);
    tree.definitions = {
      "comment:annotation1": {
        kind: "comment",
        author: "Ada Lovelace",
        dateIso: "2026-09-09T00:00:00Z",
        body: [{ kind: "paragraph", runs: [{ text: "check this" }] }],
      },
    };
    const rewritten = readOdtContent(writeOdt(tree));
    expect(rewritten.definitions?.["comment:annotation1"]).toMatchObject({
      kind: "comment",
      author: "Ada Lovelace",
      dateIso: "2026-09-09T00:00:00Z",
    });
  });

  it("round-trips a tracked-change range with author and date through writeOdt", () => {
    // The extent is interior (a later unchanged run follows it) deliberately: a change whose halves land at the paragraph's own leading/trailing edges is indistinguishable, on the way back in, from the block-scope pair the reader promotes whole-paragraph coverage into -- the identical point the bookmark machinery's run-versus-block split turns on -- so the interior shape is the one that round-trips through the run-level path this test pins.
    const descriptor = {
      kind: "provenance",
      change: "insertion",
      author: "Grace Hopper",
      dateIso: "2026-09-09T01:00:00Z",
    } as const;
    const document = documentOf([
      {
        kind: "paragraph",
        runs: [{ text: "inserted text" }, { text: " unchanged" }],
        constructs: [{ descriptor, startRun: 0, endRun: 1 }],
      },
    ]);
    const tree = assembleTree(document);
    const rewritten = readOdtContent(writeOdt(tree));
    const paragraph = rewritten.sections[0]!.blocks[0];
    expect(paragraph).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "inserted text" }, { text: " unchanged" }],
      constructs: [
        {
          descriptor: {
            kind: "provenance",
            change: "insertion",
            author: "Grace Hopper",
            dateIso: "2026-09-09T01:00:00Z",
          },
          startRun: 0,
          endRun: 1,
        },
      ],
    });
  });

  it("refuses a moveFrom provenance extent by name -- no ODF spelling exists", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "paragraph",
            runs: [{ text: "moved" }],
            constructs: [
              {
                descriptor: { kind: "provenance", change: "moveFrom" },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
      ),
    ).toThrow(/does not spell back yet/);
  });

  it("round-trips a block-scope tracked-change range spanning two paragraphs", () => {
    const descriptor = {
      kind: "provenance",
      change: "deletion",
      author: "Edsger Dijkstra",
    } as const;
    const document = documentOf([
      { kind: "constructStart", descriptor },
      { kind: "paragraph", runs: [{ text: "first removed" }] },
      { kind: "paragraph", runs: [{ text: "second removed" }] },
      { kind: "constructEnd" },
      { kind: "paragraph", runs: [{ text: "kept" }] },
    ]);
    const tree = assembleTree(document);
    const rewritten = readOdtContent(writeOdt(tree));
    const blocks = rewritten.sections[0]!.blocks;
    expect(blocks[0]).toMatchObject({ kind: "constructStart" });
    expect(blocks[1]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "first removed" }],
    });
    expect(blocks[3]).toMatchObject({ kind: "constructEnd" });
    const lastInside = blocks[2];
    expect(lastInside).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "second removed" }],
    });
  });

  it("refuses a block-scope change range whose extent contains no paragraph, by name", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "constructStart",
            descriptor: { kind: "provenance", change: "insertion" },
          },
          {
            kind: "table",
            columnWidthsPt: [100],
            rows: [
              {
                cells: [
                  { blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }] },
                ],
              },
            ],
          },
          { kind: "constructEnd" },
        ]),
      ),
    ).toThrow(/no paragraph to carry its marker halves/);
  });
});

function roundTrippedBlocks(document: WordprocessingDocument): ContentBlock[] {
  return document.sections.flatMap((section) => section.blocks);
}
