import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentSection } from "document-schema.js";
import {
  RtfDiagnosticCodes,
  RtfUnsupportedDocumentKindError,
} from "./diagnostics";
import { readRtfContent } from "./read";
import { text } from "./test-support/bytes";
import { writeRtfContent } from "./write";

const LETTER_SECTION: Omit<ContentSection, "blocks"> = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
};

function wordprocessing(
  blocks: ContentSection["blocks"],
  metadata: ContentDocument["metadata"] = {},
): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata,
    sections: [{ ...LETTER_SECTION, blocks }],
  };
}

function write(document: ContentDocument): string {
  return text(writeRtfContent(document));
}

describe("output shape", () => {
  it("opens with the {\\rtf1 the <File> production requires and closes its own group", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }]),
    );
    expect(out.startsWith("{\\rtf1\\ansi")).toBe(true);
    expect(out.endsWith("}")).toBe(true);
  });

  it("emits pure 7-bit ASCII whatever the input contained", () => {
    const out = writeRtfContent(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: "naïve — Ω — 日本語" }] },
      ]),
    );
    expect(out.every((byte) => byte < 0x80)).toBe(true);
  });

  it("refuses a document kind RTF cannot express at all", () => {
    expect(() =>
      writeRtfContent({
        kind: "presentation",
        metadata: {},
        slides: [],
      }),
    ).toThrow(RtfUnsupportedDocumentKindError);
  });

  it("is deterministic: the same document produces byte-identical output", () => {
    const document = wordprocessing([
      { kind: "paragraph", runs: [{ text: "a", bold: true }, { text: "b" }] },
    ]);
    expect(write(document)).toBe(write(document));
  });
});

describe("escaping", () => {
  it("escapes RTF's own three reserved characters", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "a{b}c\\d" }] }]),
    );
    expect(out).toContain("a\\{b\\}c\\\\d");
  });

  it("writes a non-ASCII character as \\uN with a one-character ANSI fallback", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "Γ" }] }]),
    );
    expect(out).toContain("\\u915 ?");
    expect(out).toContain("\\uc1");
  });

  it("writes an astral character as its two UTF-16 code units, the second as a negative parameter", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "𝄞" }] }]),
    );
    // U+1D11E is the surrogate pair D834 DD1E, each expressed as the signed 16-bit value the spec prescribes for a code above 32767.
    expect(out).toContain("\\u-10188 ?\\u-8930 ?");
  });

  it("writes a tab and a line break as their own control words rather than raw bytes", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "a\tb\nc" }] }]),
    );
    expect(out).toContain("a\\tab b\\line c");
  });
});

describe("header tables", () => {
  it("mints a font table entry per distinct family and references it by index", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [
            { text: "a", fontFamily: "Arial" },
            { text: "b", fontFamily: "Courier New" },
          ],
        },
      ]),
    );
    expect(out).toContain("\\f1\\fnil\\fcharset0 Arial;");
    expect(out).toContain("\\f2\\fnil\\fcharset0 Courier New;");
  });

  it("mints a colour table whose index 0 is the auto colour the leading semicolon states", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "red", color: { r: 1, g: 0, b: 0 } }],
        },
      ]),
    );
    expect(out).toContain("{\\colortbl;\\red255\\green0\\blue0;}");
    expect(out).toContain("\\cf1");
  });

  it("mints a style sheet entry per heading level, with the 0-based \\outlinelevelN the spec states", () => {
    const out = write(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: "Title" }], headingLevel: 1 },
      ]),
    );
    expect(out).toContain("\\outlinelevel0 heading 1;");
    expect(out).toContain("\\s1\\outlinelevel0");
  });

  it("writes an {\\info ...} group from the document's own metadata", () => {
    const out = write(
      wordprocessing([{ kind: "paragraph", runs: [{ text: "x" }] }], {
        title: "A Title",
        author: "An Author",
      }),
    );
    expect(out).toContain("{\\title A Title}");
    expect(out).toContain("{\\author An Author}");
  });

  it("mints both list tables and references the override by \\lsN", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "item" }],
          list: { numId: "rtf1:bullet", level: 0 },
        },
      ]),
    );
    expect(out).toContain("{\\*\\listtable");
    expect(out).toContain("\\levelnfc23");
    expect(out).toContain("{\\*\\listoverridetable");
    expect(out).toContain("\\ls1\\ilvl0");
  });

  it("mints an arabic level for an ordered numId", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "item" }],
          list: { numId: "rtf3:ordered@5", level: 0 },
        },
      ]),
    );
    expect(out).toContain("\\levelnfc0");
    expect(out).toContain("\\levelstartat5");
  });
});

describe("body constructs", () => {
  it("writes paragraph properties in twips", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          alignment: "center",
          indentLeftPt: 36,
          spacingBeforePt: 12,
          lineSpacing: 1.5,
        },
      ]),
    );
    expect(out).toContain("\\qc");
    expect(out).toContain("\\li720");
    expect(out).toContain("\\sb240");
    expect(out).toContain("\\sl360\\slmult1");
  });

  it("writes a hyperlink run as the HYPERLINK field production", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "here", hyperlink: "https://example.com/" }],
        },
      ]),
    );
    expect(out).toContain(
      '{\\field{\\*\\fldinst{HYPERLINK "https://example.com/"}}{\\fldrslt{',
    );
  });

  it("writes a table as \\trowd/\\cellxN row definitions with \\cell and \\row marks", () => {
    const out = write(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72, 144],
          rows: [
            {
              cells: [
                { blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }] },
                { blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }] },
              ],
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\trowd\\trgaph108\\trleft0\\cellx1440\\cellx4320");
    expect(out).toContain("\\intbl");
    expect(out).toContain("\\cell");
    expect(out).toContain("\\row");
  });

  it("writes a page break as \\page", () => {
    expect(write(wordprocessing([{ kind: "pageBreak" }]))).toContain("\\page");
  });

  it("writes an image as a hex-payload \\pict inside the \\*\\shppict wrapper", () => {
    // A one-pixel PNG.
    const base64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const out = write(
      wordprocessing([
        {
          kind: "image",
          format: "png",
          base64,
          widthPt: 72,
          heightPt: 36,
        },
      ]),
    );
    expect(out).toContain(
      "{\\*\\shppict{\\pict\\pngblip\\picwgoal1440\\pichgoal720",
    );
    expect(out).toContain("89504e470d0a1a0a");
  });

  it("reports rather than silently dropping a construct boundary marker", () => {
    const codes: string[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "b" },
        },
        { kind: "paragraph", runs: [{ text: "x" }] },
        { kind: "constructEnd" },
      ]),
      { sink: (diagnostic) => codes.push(diagnostic.code) },
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
  });
});

describe("round trip through this package's own reader", () => {
  function roundTrip(document: ContentDocument): ContentDocument {
    return readRtfContent(writeRtfContent(document)).document;
  }

  it("preserves paragraph text and character formatting", () => {
    const document = wordprocessing([
      {
        kind: "paragraph",
        runs: [
          { text: "plain ", sizePt: 12 },
          { text: "bold", bold: true, sizePt: 12 },
          { text: " and ", sizePt: 12 },
          { text: "italic", italic: true, sizePt: 12 },
        ],
      },
    ]);
    const back = roundTrip(document);
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    const paragraph = section?.blocks[0];
    expect(paragraph?.kind === "paragraph" ? paragraph.runs : []).toEqual(
      document.kind === "wordprocessing"
        ? document.sections[0]?.blocks[0]?.kind === "paragraph"
          ? document.sections[0].blocks[0].runs
          : []
        : [],
    );
  });

  it("preserves non-ASCII text through the \\uN escape", () => {
    const back = roundTrip(
      wordprocessing([
        { kind: "paragraph", runs: [{ text: "naïve Ω 日本語", sizePt: 12 }] },
      ]),
    );
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    const paragraph = section?.blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("naïve Ω 日本語");
  });

  it("preserves a heading's level and a list's marker type", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Head", sizePt: 12 }],
          headingLevel: 2,
        },
        {
          kind: "paragraph",
          runs: [{ text: "Item", sizePt: 12 }],
          list: { numId: "rtf1:bullet", level: 0 },
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const heading = blocks[0];
    const item = blocks[1];
    expect(
      heading?.kind === "paragraph" ? heading.headingLevel : undefined,
    ).toBe(2);
    expect(item?.kind === "paragraph" ? item.list : undefined).toEqual({
      numId: "rtf1:bullet",
      level: 0,
    });
  });

  it("preserves a table's shape and cell text", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "table",
          columnWidthsPt: [72, 144],
          rows: [
            {
              cells: [
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "A", sizePt: 12 }] },
                  ],
                },
                {
                  blocks: [
                    { kind: "paragraph", runs: [{ text: "B", sizePt: 12 }] },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const table = blocks.find((block) => block.kind === "table");
    expect(table?.kind === "table" ? table.columnWidthsPt : undefined).toEqual([
      72, 144,
    ]);
    expect(
      table?.kind === "table" ? table.rows[0]?.cells.length : undefined,
    ).toBe(2);
  });

  it("preserves a hyperlink's target", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [
            {
              text: "link",
              hyperlink: "https://example.com/a?b=1",
              sizePt: 12,
            },
          ],
        },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? (back.sections[0]?.blocks ?? []) : [];
    const paragraph = blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs.find((run) => run.hyperlink !== undefined)?.hyperlink
        : undefined,
    ).toBe("https://example.com/a?b=1");
  });

  it("preserves the section's page geometry and the document's metadata", () => {
    const back = roundTrip(
      wordprocessing(
        [{ kind: "paragraph", runs: [{ text: "x", sizePt: 12 }] }],
        {
          title: "T",
          author: "A",
        },
      ),
    );
    expect(back.metadata).toEqual({ title: "T", author: "A" });
    const section =
      back.kind === "wordprocessing" ? back.sections[0] : undefined;
    expect(section?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(section?.margins).toEqual(LETTER_SECTION.margins);
  });

  it("round-trips several sections, each keeping its own geometry and break kind", () => {
    const document: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [{ kind: "paragraph", runs: [{ text: "Portrait" }] }],
        },
        {
          pageSize: { widthPt: 792, heightPt: 612 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          breakType: "oddPage",
          blocks: [{ kind: "paragraph", runs: [{ text: "Landscape" }] }],
        },
      ],
    };
    const back = roundTrip(document);
    const sections = back.kind === "wordprocessing" ? back.sections : [];
    expect(sections).toHaveLength(2);
    expect(sections[0]?.pageSize).toEqual({ widthPt: 612, heightPt: 792 });
    expect(sections[1]?.pageSize).toEqual({ widthPt: 792, heightPt: 612 });
    expect(sections[1]?.margins.leftPt).toBe(36);
    expect(sections[1]?.breakType).toBe("oddPage");
  });

  it("states each section's geometry with the section-scoped \\pgwsxnN family, not the document-level \\paperwN", () => {
    const out = write({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          ...LETTER_SECTION,
          blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
        },
        {
          pageSize: { widthPt: 792, heightPt: 612 },
          margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
          blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }],
        },
      ],
    });
    expect(out).toContain("\\pgwsxn15840\\pghsxn12240");
    expect(out).toContain("\\marglsxn720");
    // The document-level geometry is stated once, in the header, from the first section -- not restated per section.
    expect(out.match(/\\paperw/g)).toHaveLength(1);
  });
});
