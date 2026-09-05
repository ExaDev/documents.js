import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentSection } from "document-schema.js";
import {
  RtfDiagnosticCodes,
  RtfUnsupportedDocumentKindError,
} from "./diagnostics";
import { readRtfContent } from "./read";
import { text } from "./test-support/bytes";
import { expectBalancedBraces } from "./test-support/brace-balance";
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
    expectBalancedBraces(out);
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
    expectBalancedBraces(out);
  });

  it("writes a checkbox contentControl as a real \\*\\formfield production", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "before " }, { text: " after" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: true,
                tag: "Check1",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain(
      "{\\field{\\*\\fldinst FORMCHECKBOX {\\*\\formfield{",
    );
    // \fftype1 is RTF 1.5's own "Form field type: ... 1 Check box" -- without it, the minted \*\formfield data says "text field" while the sibling \*\fldinst says FORMCHECKBOX.
    expect(out).toContain("\\fftype1");
    expect(out).toContain("\\ffdefres1");
    expect(out).toContain("{\\*\\ffname Check1}");
    expect(out.indexOf("before")).toBeLessThan(out.indexOf("FORMCHECKBOX"));
    expect(out.indexOf("FORMCHECKBOX")).toBeLessThan(out.indexOf("after"));
    expectBalancedBraces(out);
  });

  it("writes a dropDown contentControl's options as \\*\\ffl entries", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Guten Tag" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["Hello", "Guten Tag"],
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\fldinst FORMDROPDOWN {\\*\\formfield{");
    // \fftype2 is RTF 1.5's own "Form field type: ... 2 List".
    expect(out).toContain("\\fftype2");
    expect(out).toContain("{\\*\\ffl Hello}");
    expect(out).toContain("{\\*\\ffl Guten Tag}");
    expectBalancedBraces(out);
  });

  it("writes a plainText contentControl wrapping its runs in \\fldrslt", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    // \fftype0 is RTF 1.5's own "Form field type: 0 Text ...".
    expect(out).toContain(
      "FORMTEXT {\\*\\formfield{\\fftype0{\\*\\ffname Text1}}}",
    );
    expect(out).toContain("{\\fldrslt {Lorem ipsum.}}}");
    expectBalancedBraces(out);
  });

  it("reports a contentControl controlType RTF's own form-field vocabulary does not cover, rather than minting nothing silently -- and mints no unbalanced braces for it", () => {
    const codes: string[] = [];
    const out = text(
      writeRtfContent(
        wordprocessing([
          {
            kind: "paragraph",
            runs: [{ text: "x" }],
            constructs: [
              {
                descriptor: {
                  kind: "contentControl",
                  controlType: "richText",
                },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
        { sink: (diagnostic) => codes.push(diagnostic.code) },
      ),
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
    // The regression this guards: an unrepresentable controlType must mint no open half either, or the writer emits the extent's close "}}" unpaired and corrupts the rest of the document's brace balance.
    expectBalancedBraces(out);
  });

  it("mints balanced braces for a paragraph mixing a real form field with an unrepresentable one", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: true,
              },
              startRun: 0,
              endRun: 0,
            },
            {
              descriptor: { kind: "contentControl", controlType: "comboBox" },
              startRun: 1,
              endRun: 2,
            },
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["x"],
              },
              startRun: 3,
              endRun: 3,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("FORMCHECKBOX");
    expect(out).toContain("FORMDROPDOWN");
    expect(out).not.toContain("COMBOBOX");
    expectBalancedBraces(out);
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
    expectBalancedBraces(out);
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

  it("reports rather than silently dropping a construct boundary marker RTF cannot spell", () => {
    const codes: string[] = [];
    writeRtfContent(
      // A footnote anchor rather than a bookmark: a bookmark now has a real {\*\bkmkstart ...} spelling, while a footnote's body would need the note destination this package does not place.
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "footnote", name: "1" },
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

  it("writes a run-level bookmark anchor as the {\\*\\bkmkstart}/{\\*\\bkmkend} pair bracketing its runs", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "before " }, { text: "marked" }, { text: " after" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "paradigm",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\bkmkstart paradigm}");
    expect(out).toContain("{\\*\\bkmkend paradigm}");
    expect(out.indexOf("{\\*\\bkmkstart paradigm}")).toBeLessThan(
      out.indexOf("marked"),
    );
    expect(out.indexOf("marked")).toBeLessThan(
      out.indexOf("{\\*\\bkmkend paradigm}"),
    );
  });

  it("re-emits an rtf residue value's own control words verbatim, which is what the quarantine contract permits", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "Table1",
                source: { format: "rtf", xml: "\\bkmkcolf2\\bkmkcoll5" },
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\bkmkstart\\bkmkcolf2\\bkmkcoll5 Table1}");
  });

  it("leaves another format's residue alone rather than pasting it into RTF", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "b",
                source: { format: "docx", xml: "<w:bookmarkStart/>" },
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\bkmkstart b}");
    expect(out).not.toContain("w:bookmarkStart");
  });

  it("round-trips a block-scoped bookmark through its constructStart/constructEnd markers", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: { kind: "anchor", anchorType: "bookmark", name: "span" },
        },
        { kind: "paragraph", runs: [{ text: "One" }] },
        { kind: "paragraph", runs: [{ text: "Two" }] },
        { kind: "constructEnd" },
      ]),
    );
    const blocks =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : [];
    expect(blocks?.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
    ]);
  });

  it("round-trips a run-level bookmark back onto the same runs", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
          constructs: [
            {
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "mid",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "mid",
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("b");
  });

  it("reports a construct kind RTF has no spelling for rather than writing a bookmark for it", () => {
    const codes: string[] = [];
    writeRtfContent(
      wordprocessing([
        {
          kind: "constructStart",
          descriptor: {
            kind: "contentControl",
            controlType: "richText",
            tag: "T",
          },
        },
        { kind: "paragraph", runs: [{ text: "x" }] },
        { kind: "constructEnd" },
      ]),
      { sink: (diagnostic) => codes.push(diagnostic.code) },
    );
    expect(codes).toContain(RtfDiagnosticCodes.CONSTRUCT_UNREPRESENTED);
  });

  it("round-trips a checkbox contentControl's checked state and tag back onto the same point extent", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "before " }, { text: " after" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: true,
                tag: "Check1",
              },
              startRun: 1,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "checkbox",
      checked: true,
      tag: "Check1",
    });
    expect(extent?.startRun).toBe(extent?.endRun);
    expect(paragraph?.runs.map((run) => run.text).join("")).toBe(
      "before  after",
    );
  });

  it("round-trips a dropDown contentControl's options back onto the runs it wraps", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Guten Tag" }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "dropDown",
                options: ["Hello", "Guten Tag"],
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      options: ["Hello", "Guten Tag"],
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("Guten Tag");
  });

  it("round-trips a plainText contentControl's tag and its wrapped text", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "Lorem ipsum." }],
          constructs: [
            {
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                tag: "Text1",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    const paragraph = block?.kind === "paragraph" ? block : undefined;
    const extent = paragraph?.constructs?.[0];
    expect(extent?.descriptor).toEqual({
      kind: "contentControl",
      controlType: "plainText",
      tag: "Text1",
    });
    expect(
      paragraph?.runs
        .slice(extent?.startRun ?? 0, extent?.endRun ?? 0)
        .map((run) => run.text)
        .join(""),
    ).toBe("Lorem ipsum.");
  });

  it("writes a run-level provenance extent as the <chrev> character properties, minting a \\*\\revtbl for its author", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "kept " }, { text: "added" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "insertion",
                author: "A. Reviewer",
                dateIso: "2024-01-01T09:30:00",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("{\\*\\revtbl");
    expect(out).toContain("A. Reviewer;");
    expect(out).toContain("\\revised");
    // 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20) -- the DTTM bit field the spec tabulates.
    const dttm = 30 | (9 << 6) | (1 << 11) | (1 << 16) | (124 << 20);
    expect(out).toContain(`\\revdttm${String(dttm)}`);
  });

  it("round-trips every provenance change kind back onto the same runs", () => {
    for (const change of [
      "insertion",
      "deletion",
      "moveFrom",
      "moveTo",
      "formatChange",
    ] as const) {
      const back = roundTrip(
        wordprocessing([
          {
            kind: "paragraph",
            runs: [{ text: "a" }, { text: "b" }],
            constructs: [
              {
                descriptor: { kind: "provenance", change, author: "R" },
                startRun: 1,
                endRun: 2,
              },
            ],
          },
        ]),
      );
      const block =
        back.kind === "wordprocessing"
          ? back.sections[0]?.blocks[0]
          : undefined;
      const paragraph = block?.kind === "paragraph" ? block : undefined;
      expect(paragraph?.constructs?.[0]?.descriptor).toEqual({
        kind: "provenance",
        change,
        author: "R",
      });
      expect(
        paragraph?.runs
          .slice(
            paragraph.constructs?.[0]?.startRun ?? 0,
            paragraph.constructs?.[0]?.endRun ?? 0,
          )
          .map((run) => run.text)
          .join(""),
      ).toBe("b");
    }
  });

  it("round-trips a deletion's own text, which the provenance kind exists to carry", () => {
    const back = roundTrip(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "kept " }, { text: "gone" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "deletion",
                author: "R",
              },
              startRun: 1,
              endRun: 2,
            },
          ],
        },
      ]),
    );
    const block =
      back.kind === "wordprocessing" ? back.sections[0]?.blocks[0] : undefined;
    expect(
      block?.kind === "paragraph"
        ? block.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("kept gone");
  });

  it("omits \\revdttmN entirely for a dateIso it cannot pack, rather than writing a zero one", () => {
    const out = write(
      wordprocessing([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          constructs: [
            {
              descriptor: {
                kind: "provenance",
                change: "insertion",
                dateIso: "not a date",
              },
              startRun: 0,
              endRun: 1,
            },
          ],
        },
      ]),
    );
    expect(out).toContain("\\revised");
    expect(out).not.toContain("\\revdttm");
  });

  it("round-trips a cell's borders, background, and both merge directions", () => {
    const document = wordprocessing([
      {
        kind: "table",
        columnWidthsPt: [72, 72, 72],
        rows: [
          {
            cells: [
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "A" }] }],
                rowSpan: 2,
                background: { r: 1, g: 1, b: 0 },
                borders: {
                  top: { color: { r: 1, g: 0, b: 0 }, widthPt: 1.5 },
                  bottom: {
                    color: { r: 0, g: 0, b: 1 },
                    widthPt: 0.75,
                    style: "dashed",
                  },
                },
              },
              // colSpan 2 means this one cell occupies the second and third grid columns, so the row has two cells across three columns -- the covered column has no cell of its own, exactly as a gridSpan'd w:tc does not.
              {
                blocks: [{ kind: "paragraph", runs: [{ text: "B" }] }],
                colSpan: 2,
              },
            ],
          },
          {
            cells: [
              { blocks: [] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "C" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "D" }] }] },
            ],
          },
        ],
      },
    ]);
    const out = write(document);
    expect(out).toContain("\\clvmgf");
    expect(out).toContain("\\clvmrg");
    expect(out).toContain("\\clmgf");
    expect(out).toContain("\\clmrg");
    expect(out).toContain("\\clbrdrt\\brdrs\\brdrw30");
    expect(out).toContain("\\clbrdrb\\brdrdash\\brdrw15");
    expect(out).toContain("\\clcbpat");

    const back = roundTrip(document);
    const table = (
      back.kind === "wordprocessing" ? back.sections[0]?.blocks : []
    )?.find((block) => block.kind === "table");
    const anchor =
      table?.kind === "table" ? table.rows[0]?.cells[0] : undefined;
    expect(anchor?.rowSpan).toBe(2);
    expect(anchor?.background).toEqual({ r: 1, g: 1, b: 0 });
    expect(anchor?.borders?.top).toEqual({
      color: { r: 1, g: 0, b: 0 },
      widthPt: 1.5,
    });
    expect(anchor?.borders?.bottom).toEqual({
      color: { r: 0, g: 0, b: 1 },
      widthPt: 0.75,
      style: "dashed",
    });
    expect(
      table?.kind === "table" ? table.rows[0]?.cells[1]?.colSpan : undefined,
    ).toBe(2);
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
