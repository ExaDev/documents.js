import type {
  ContentBlock,
  ContentDocument,
  ContentParagraph,
} from "document-schema.js";
import { bytesToBase64 } from "./bytes/base64";
import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpd, readWpdContent } from "./read";
import {
  buildWpdFile,
  fontDescriptorPacket,
  text,
  variableFunction,
} from "./test-support/build-wpd";
import { writeCompoundFile } from "archive-codec";
import { compoundFileWithStream } from "./test-support/compound-file";
import { PERFECT_OFFICE_MAIN_STREAM } from "./container/container";

const HARD_EOL = 0xcc;
const SOFT_EOL = 0xcf;
const HARD_EOP = 0xc7;
const SOFT_SPACE = 0x80;
const HARD_SPACE = 0x81;
const ATTRIBUTE_ON = 0xf2;
const ATTRIBUTE_OFF = 0xf3;
const BOLD = 12;
const ITALICS = 8;
const UNDERLINE = 14;
const STRIKEOUT = 13;
const DOUBLE_UNDERLINE = 11;
const SMALL_CAPS = 15;

function paragraphsOf(document: ContentDocument): ContentParagraph[] {
  if (document.kind !== "wordprocessing") {
    throw new Error("expected a wordprocessing document");
  }
  return document.sections
    .flatMap((section) => section.blocks)
    .filter((block): block is ContentParagraph => block.kind === "paragraph");
}

function readDocumentArea(
  documentArea: readonly number[],
  packets: Parameters<typeof buildWpdFile>[1] = [],
): ContentDocument {
  return readWpdContent(buildWpdFile(documentArea, packets));
}

describe("readWpdContent", () => {
  it("reads a wordprocessing document", () => {
    const document = readDocumentArea(text("Hello"));
    expect(document.kind).toBe("wordprocessing");
  });

  it("splits paragraphs on a hard end of line", () => {
    const document = readDocumentArea([
      ...text("First"),
      HARD_EOL,
      ...text("Second"),
    ]);
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "First",
      "Second",
    ]);
  });

  // "Soft EOL: The formatter inserts a code at the end of a line. Its position changes automatically as text is added or deleted", and the End-of-Line group's own conversion table maps it to a space rather than a break.
  it("turns a soft end of line into a space within one paragraph", () => {
    const document = readDocumentArea([
      ...text("wrapped"),
      SOFT_EOL,
      ...text("line"),
    ]);
    const paragraphs = paragraphsOf(document);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs[0]?.text).toBe("wrapped line");
  });

  it("keeps a blank line between two consecutive hard returns", () => {
    const document = readDocumentArea([
      ...text("above"),
      HARD_EOL,
      HARD_EOL,
      ...text("below"),
    ]);
    expect(paragraphsOf(document).map((p) => p.runs.length)).toEqual([1, 0, 1]);
  });

  it("does not invent a trailing paragraph after a document's final hard return", () => {
    const document = readDocumentArea([...text("only"), HARD_EOL]);
    expect(paragraphsOf(document)).toHaveLength(1);
  });

  it("emits a page break for a hard end of page", () => {
    const document = readDocumentArea([
      ...text("before"),
      HARD_EOP,
      ...text("after"),
    ]);
    if (document.kind !== "wordprocessing") {
      throw new Error("expected a wordprocessing document");
    }
    expect(document.sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "pageBreak",
      "paragraph",
    ]);
  });

  it("distinguishes a soft space from a hard space", () => {
    const document = readDocumentArea([
      ...text("a"),
      SOFT_SPACE,
      ...text("b"),
      HARD_SPACE,
      ...text("c"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]?.text).toBe("a b c");
  });

  // Byte 0x20 is the last of the thirty-two Default Extended International Characters, not a space: the SDK's own table gives it as the sharp s, and a space is the Soft Space function instead.
  it("reads byte 0x20 as the sharp s, not as a space", () => {
    const document = readDocumentArea([...text("Stra"), 0x20, ...text("e")]);
    expect(paragraphsOf(document)[0]?.runs[0]?.text).toBe("Straße");
  });

  it("reads an international shorthand byte as its accented character", () => {
    const document = readDocumentArea([...text("caf"), 0x0f]);
    expect(paragraphsOf(document)[0]?.runs[0]?.text).toBe("café");
  });

  it("reads an extended character function", () => {
    // Character 41 of set 1 is e-acute, the same glyph the shorthand above encodes in one byte.
    const document = readDocumentArea([...text("caf"), 0xf0, 41, 1, 0xf0]);
    expect(paragraphsOf(document)[0]?.runs[0]?.text).toBe("café");
  });

  it("renders an unmapped character visibly and reports it", () => {
    const diagnostics: WpdDiagnostic[] = [];
    // Character 0 of set 12 (Tibetan): libwpd's own tibetanMap1 table has no entry below character number 33, so this position genuinely has no mapping in the cited source rather than being a gap this package introduced.
    readWpdContent(buildWpdFile([...text("x"), 0xf0, 0, 12, 0xf0]), {
      sink: (diagnostic) => diagnostics.push(diagnostic),
    });
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === WpdDiagnosticCodes.UnmappedCharacter,
    );
    expect(found?.message).toBe(
      "Character 0 of WordPerfect character set 12 has no mapping in this package and was rendered as U+FFFD.",
    );
  });

  it("splits runs at an attribute boundary", () => {
    const document = readDocumentArea([
      ...text("plain"),
      ATTRIBUTE_ON,
      BOLD,
      ATTRIBUTE_ON,
      ...text("bold"),
      ATTRIBUTE_OFF,
      BOLD,
      ATTRIBUTE_OFF,
      ...text("plain"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([
      { text: "plain" },
      { text: "bold", bold: true },
      { text: "plain" },
    ]);
  });

  it("carries several attributes on one run", () => {
    const document = readDocumentArea([
      ATTRIBUTE_ON,
      BOLD,
      ATTRIBUTE_ON,
      ATTRIBUTE_ON,
      ITALICS,
      ATTRIBUTE_ON,
      ...text("both"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([
      { text: "both", bold: true, italic: true },
    ]);
  });

  // "Bit 7: 1 = Ignore the attributed text on/off codes. Used when an attributed block of text becomes a subset of a larger attribute block of the same type, such as bolding a sentence that contains a word already bolded."
  it("ignores an attribute code whose ignore bit is set", () => {
    const document = readDocumentArea([
      ATTRIBUTE_ON,
      BOLD,
      ATTRIBUTE_ON,
      ...text("a"),
      ATTRIBUTE_OFF,
      BOLD | 0x80,
      ATTRIBUTE_OFF,
      ...text("b"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([
      { text: "ab", bold: true },
    ]);
  });

  // Plain and double underline are separate WordPerfect attributes that both mean `underline` in the shared schema, so tracking the schema's boolean alone would let one attribute's Off code clear the other's still-open On.
  it("keeps underline while a double underline is still open", () => {
    const document = readDocumentArea([
      ATTRIBUTE_ON,
      DOUBLE_UNDERLINE,
      ATTRIBUTE_ON,
      ATTRIBUTE_ON,
      UNDERLINE,
      ATTRIBUTE_ON,
      ...text("a"),
      ATTRIBUTE_OFF,
      UNDERLINE,
      ATTRIBUTE_OFF,
      ...text("b"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([
      { text: "ab", underline: true },
    ]);
  });

  it("does not split a run at an attribute the shared schema cannot express", () => {
    const document = readDocumentArea([
      ...text("a"),
      ATTRIBUTE_ON,
      SMALL_CAPS,
      ATTRIBUTE_ON,
      ...text("b"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([{ text: "ab" }]);
  });

  it("splits a run at strikeout, the same way as the other boolean attributes", () => {
    const document = readDocumentArea([
      ...text("a"),
      ATTRIBUTE_ON,
      STRIKEOUT,
      ATTRIBUTE_ON,
      ...text("b"),
      ATTRIBUTE_OFF,
      STRIKEOUT,
      ATTRIBUTE_OFF,
      ...text("c"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([
      { text: "a" },
      { text: "b", strike: true },
      { text: "c" },
    ]);
  });

  it("gives a plain run no optional keys at all, not keys holding undefined", () => {
    const document = readDocumentArea([...text("plain")]);
    const run = paragraphsOf(document)[0]?.runs[0];
    expect(run).toBeDefined();
    for (const key of ["strike", "fontFamily", "sizePt", "color"]) {
      expect(run === undefined ? false : Object.hasOwn(run, key)).toBe(false);
    }
  });

  it("gives a plain paragraph no optional keys at all, not keys holding undefined", () => {
    const document = readDocumentArea([...text("plain")]);
    const paragraph = paragraphsOf(document)[0];
    expect(paragraph).toBeDefined();
    for (const key of ["alignment", "headingLevel", "list", "constructs"]) {
      expect(
        paragraph === undefined ? false : Object.hasOwn(paragraph, key),
      ).toBe(false);
    }
  });

  // "The surrounded text is passed over by the formatter and is not displayed."
  it("drops text between the Start and End of Text to Skip pair", () => {
    const document = readDocumentArea([
      ...text("keep"),
      0x8d,
      ...text("drop"),
      0x8e,
      ...text("keep"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]?.text).toBe("keepkeep");
  });

  // An End of Text to Skip with no matching Start (a stray or duplicated code, possible in a document edited by a third-party writer) must not drive the skip depth negative: clamping at zero means the very next Start still raises it to exactly one, so the region it opens is skipped as normal. Without the clamp, an unmatched End would leave the depth one lower than it should be, and the following Start/End pair's own text would wrongly leak into the document instead of being dropped.
  it("clamps skip depth at zero so an unmatched End of Text to Skip cannot leak a later skip region's text", () => {
    const document = readDocumentArea([
      ...text("keep"),
      0x8d, // START_OF_TEXT_TO_SKIP
      ...text("drop"),
      0x8e, // END_OF_TEXT_TO_SKIP -- balances the Start above
      0x8e, // an extra, unmatched END_OF_TEXT_TO_SKIP
      0x8d, // START_OF_TEXT_TO_SKIP again
      ...text("hidden"),
      0x8e, // END_OF_TEXT_TO_SKIP
      ...text("keep"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]?.text).toBe("keepkeep");
  });

  // A font face change must split off whatever text already accumulated before it into its own run, so that earlier text keeps its own (absent) font family rather than being retroactively folded into the new one.
  it("splits the run at a font face change, leaving earlier text without the new font family", () => {
    const document = readDocumentArea(
      [
        ...text("before"),
        ...variableFunction({
          group: 0xd4,
          subgroup: 0x1a,
          prefixIds: [1],
          nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
        }),
        ...text("after"),
      ],
      [fontDescriptorPacket("Courier New")],
    );
    expect(paragraphsOf(document)[0]?.runs).toEqual([
      { text: "before" },
      { text: "after", fontFamily: "Courier New" },
    ]);
  });

  it("takes a run's font family from the descriptor packet a font face change names", () => {
    const document = readDocumentArea(
      [
        ...variableFunction({
          group: 0xd4,
          subgroup: 0x1a,
          prefixIds: [1],
          nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
        }),
        ...text("styled"),
      ],
      [fontDescriptorPacket("Courier New")],
    );
    expect(paragraphsOf(document)[0]?.runs[0]).toEqual({
      text: "styled",
      fontFamily: "Courier New",
    });
  });

  // "[desired point size (3600ths)]" is the first field of a Font Size Change, and a point is 1/72 inch, so 36,000 3600ths of an inch is ten inches -- and 600 is twelve points.
  it("converts a font size change from 3600ths of an inch to points", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: 0xd4,
        subgroup: 0x1b,
        nonDeletable: [0x58, 0x02, 0, 0, 0, 0, 0, 0],
      }),
      ...text("sized"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]).toEqual({
      text: "sized",
      sizePt: 12,
    });
  });

  it("reads a character colour change", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: 0xd4,
        subgroup: 0x18,
        // A distinct, non-zero, non-255 value on every channel: 0 or 255 would divide to the same result a stray multiplication would give.
        nonDeletable: [102, 51, 204],
      }),
      ...text("mix"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]?.color).toEqual({
      r: 102 / 255,
      g: 51 / 255,
      b: 204 / 255,
    });
  });

  it("applies a justification change to the paragraphs that follow it", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: 0xd3,
        subgroup: 0x05,
        nonDeletable: [2],
      }),
      ...text("centred"),
    ]);
    expect(paragraphsOf(document)[0]?.alignment).toBe("center");
  });

  // "Subfunctions 0 to 28 (0x1C) of this group are interchangeable with the single-byte function codes 180 (0xB4) to 207 (0xCF) ... A program reading WP 7.0 documents must handle both."
  it("handles the multi-byte spelling of a hard end of line", () => {
    const document = readDocumentArea([
      ...text("first"),
      ...variableFunction({ group: 0xd0, subgroup: 4 }),
      ...text("second"),
    ]);
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "first",
      "second",
    ]);
  });

  // Subfunction 0, Beginning of File, is the one End-of-Line subfunction with no single-byte spelling at all -- it exists solely as this group's own subgroup 0 -- and the SDK's own conversion table maps it to nothing: it contributes neither a character nor a paragraph break.
  it("ignores the Beginning-of-File End-of-Line subfunction, reachable only through its multi-byte spelling", () => {
    const document = readDocumentArea([
      ...text("before"),
      ...variableFunction({ group: 0xd0, subgroup: 0 }),
      ...text("after"),
    ]);
    const paragraphs = paragraphsOf(document);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs[0]?.text).toBe("beforeafter");
  });

  // The shared content schema has no column-break block, so a hard end of column becomes a paragraph break instead, and the diagnostic sink is told exactly what was flattened away.
  it("reports a column break becoming a paragraph break", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([
        ...text("first"),
        ...variableFunction({ group: 0xd0, subgroup: 7 }),
        ...text("second"),
      ]),
      { sink: (diagnostic) => diagnostics.push(diagnostic) },
    );
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "first",
      "second",
    ]);
    const found = diagnostics.find(
      (diagnostic) =>
        diagnostic.code === WpdDiagnosticCodes.ColumnBreakFlattened,
    );
    expect(found?.message).toBe("A column break became a paragraph break.");
  });

  // "Both mark a permitted break point that is not currently taken, and neither shows a character": the invisible return contributes no text and does not split the run it sits in, exactly like the soft hyphen it is documented alongside.
  it("contributes nothing for an invisible return in line", () => {
    const document = readDocumentArea([
      ...text("un"),
      0x86, // INVISIBLE_RETURN_IN_LINE
      ...text("broken"),
    ]);
    const paragraphs = paragraphsOf(document);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs[0]?.text).toBe("unbroken");
  });

  // "An auto-hyphen was inserted by the formatter at the end of a line" -- displayed exactly like the other end-of-line hyphen functions.
  it("appends a hyphen for an auto-hyphen at the end of a line", () => {
    const document = readDocumentArea([
      ...text("auto"),
      0x85, // AUTO_HYPHEN_AT_END_OF_LINE
      ...text("mated"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]?.text).toBe("auto-mated");
  });

  // "Whenever a [HRt] code appears alone at the top of a page that starts with a soft page break, the formatter changes the Hard Return code into a Dormant Hard Return code." The paragraph boundary the author typed is still there, so it still closes the paragraph.
  it("splits paragraphs at a dormant hard return", () => {
    const document = readDocumentArea([
      ...text("first"),
      0x87, // DORMANT_HARD_RETURN
      ...text("second"),
    ]);
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "first",
      "second",
    ]);
  });

  // "The formatter inserts a soft End of Line, which causes centering to end, but not the paragraph" -- a wrap, so it becomes the same space every other soft end of line converts to.
  it("appends a space for a soft end of center align", () => {
    const document = readDocumentArea([
      ...text("centred"),
      0x88, // SOFT_END_OF_CENTER_ALIGN
      ...text("text"),
    ]);
    const paragraphs = paragraphsOf(document);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs[0]?.text).toBe("centred text");
  });

  // "The Enter key is pressed, ending the line, the centering, and the paragraph."
  it("splits paragraphs at a hard end of center align", () => {
    const document = readDocumentArea([
      ...text("first"),
      0x89, // HARD_END_OF_CENTER_ALIGN
      ...text("second"),
    ]);
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "first",
      "second",
    ]);
  });

  // A single-byte function code this switch names no case for at all -- one of the format's own formatting/bookkeeping markers this reader has no specific behaviour for -- must fall through to the default case and contribute neither characters nor structure, exactly like the codes with an explicit no-op case.
  it("contributes nothing for a single-byte function code with no named case", () => {
    const document = readDocumentArea([
      ...text("un"),
      0x8a, // an unassigned single-byte function code between INVISIBLE_RETURN_IN_LINE (0x86) and START_OF_TEXT_TO_SKIP (0x8d)
      ...text("broken"),
    ]);
    const paragraphs = paragraphsOf(document);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs[0]?.text).toBe("unbroken");
  });

  // A cell or row boundary with no Table Definition open has no grid to belong to, which a stray code left behind by an edit can produce. The text on either side still survives as paragraphs, in reading order.
  // flushParagraphIfContent must still flush when the pending text is empty but a run has already been split off it (here, by an attribute change) -- checking only state.text.length would wrongly drop that already-built run.
  it("flushes a paragraph at a boundary whose pending text is empty but whose runs are not", () => {
    const document = readDocumentArea([
      ...text("plain"),
      ATTRIBUTE_ON,
      BOLD,
      ATTRIBUTE_ON,
      0xc6,
      ...text("next"),
      0xbf,
    ]);
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "plain",
      "next",
    ]);
  });

  it("flattens an orphaned cell boundary into paragraphs and says so", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile([...text("cell"), 0xc6, ...text("next"), 0xbf]),
      { sink: (diagnostic) => diagnostics.push(diagnostic) },
    );
    expect(paragraphsOf(document).map((p) => p.runs[0]?.text)).toEqual([
      "cell",
      "next",
    ]);
    const matches = diagnostics.filter(
      (diagnostic) => diagnostic.code === WpdDiagnosticCodes.TableFlattened,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toBe(
      "A table cell or row boundary appeared with no table definition open; its text became a paragraph.",
    );
  });

  // The same document in both containers must read identically: a WordPerfect 6.x file writes the byte stream straight to disk, and WP7 onwards may wrap the identical stream in an OLE compound file.
  it("reads the same document from a bare file and from an OLE compound wrapper", () => {
    const bare = buildWpdFile([...text("Hello"), HARD_EOL, ...text("World")]);
    expect(
      readWpdContent(compoundFileWithStream(PERFECT_OFFICE_MAIN_STREAM, bare)),
    ).toEqual(readWpdContent(bare));
  });

  it("abandons a footnote left open across a paragraph boundary and reports it", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const bytes = buildWpdFile([
      ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [1] }), // FOOTNOTE_ON
      ...text("1"),
      HARD_EOL,
      ...text("next"),
      ...variableFunction({ group: 0xd7, subgroup: 0x01 }), // FOOTNOTE_OFF
    ]);
    const document = readWpdContent(bytes, {
      sink: (d) => diagnostics.push(d),
    });
    const paragraphs = paragraphsOf(document);
    expect(
      paragraphs.every((paragraph) => paragraph.constructs === undefined),
    ).toBe(true);
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.NoteSpansParagraphs,
    );
    expect(found?.message).toBe(
      "A footnote or endnote's own On/Off pair straddled a paragraph boundary, which the run-scoped note anchor cannot express; its reference text became ordinary paragraph text with no note anchor.",
    );
  });

  it("reports the exact missing-prefix-packet message for a font face change naming an unknown prefix ID", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile([
        ...variableFunction({
          group: 0xd4,
          subgroup: 0x1a,
          prefixIds: [7],
          nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
        }),
        ...text("plain"),
      ]),
      { sink: (d) => diagnostics.push(d) },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.MissingPrefixPacket,
    );
    expect(found?.message).toBe(
      "A font face change names prefix ID 7, which this document's index does not carry.",
    );
  });

  it("does not apply a font face change when the named packet is not a font descriptor", () => {
    const document = readDocumentArea(
      [
        ...variableFunction({
          group: 0xd4,
          subgroup: 0x1a,
          prefixIds: [1],
          nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
        }),
        ...text("plain"),
      ],
      [{ packetType: 0x08, bytes: new Uint8Array(0) }], // General WP Text, not a font descriptor
    );
    expect(paragraphsOf(document)[0]?.runs[0]).toEqual({ text: "plain" });
  });

  it("does not apply a font face change when the descriptor packet's own typeface name cannot be read", () => {
    const document = readDocumentArea(
      [
        ...variableFunction({
          group: 0xd4,
          subgroup: 0x1a,
          prefixIds: [1],
          nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
        }),
        ...text("plain"),
      ],
      [{ packetType: 0x55, bytes: new Uint8Array(0) }], // font descriptor packet type, but too short for a typeface name
    );
    expect(paragraphsOf(document)[0]?.runs[0]).toEqual({ text: "plain" });
  });

  // The packet-type check must actually gate the read, not just happen to agree with it: a packet whose own bytes would decode as a valid typeface if read as a font descriptor, but which is not one, must not have its bytes read that way at all.
  it("does not read a non-font-descriptor packet's bytes as a typeface even when they would decode as one", () => {
    const descriptorShapedBytes = fontDescriptorPacket("Courier New").bytes;
    const document = readDocumentArea(
      [
        ...variableFunction({
          group: 0xd4,
          subgroup: 0x1a,
          prefixIds: [1],
          nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
        }),
        ...text("plain"),
      ],
      [{ packetType: 0x08, bytes: descriptorShapedBytes }], // General WP Text, not a font descriptor, despite the descriptor-shaped bytes
    );
    expect(paragraphsOf(document)[0]?.runs[0]).toEqual({ text: "plain" });
  });

  // A font face change that names an unreadable typeface must leave a PREVIOUSLY set font family in place for the run it starts, rather than clearing it -- the failed change contributes nothing, it does not reset what came before it.
  it("keeps a previously set font family when a later font face change cannot be read", () => {
    const document = readDocumentArea(
      [
        ...variableFunction({
          group: 0xd4,
          subgroup: 0x1a,
          prefixIds: [1],
          nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
        }),
        ...text("first"),
        0xf2, // ATTRIBUTE_ON (bold), forcing a run split independent of the font logic under test
        12, // BOLD
        0xf2,
        ...variableFunction({
          group: 0xd4,
          subgroup: 0x1a,
          prefixIds: [2],
          nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
        }),
        ...text("second"),
      ],
      [
        fontDescriptorPacket("Georgia"),
        { packetType: 0x55, bytes: new Uint8Array(0) }, // font descriptor packet type, but too short for a typeface name
      ],
    );
    expect(
      paragraphsOf(document)[0]?.runs.map((run) => [run.text, run.fontFamily]),
    ).toEqual([
      ["first", "Georgia"],
      ["second", "Georgia"],
    ]);
  });

  describe("style packet resolution", () => {
    const GLOBAL_ON = 0x0a;
    const GLOBAL_OFF = 0x0b;
    const STYLE_GROUP = 0xdd;
    const NORMAL_STYLE_PACKET_TYPE = 0x30;
    // No system style number, so styleSemanticsFor contributes nothing -- isolating the packet's own direct-formatting effect from the heading/list mapping a system style number would otherwise add.
    const NO_SYSTEM_STYLE = 0xff;

    // A Normal Style packet (type 0x30) carrying no link PID and a "beginning style text" block of the given raw document-area bytes, laid out exactly as WPFF Prefix Packet Type 48 states.
    function normalStylePacket(beginBytes: readonly number[]) {
      const headerSize = 2 + 2 + 16; // [pid count=0] [numTextBlocks=4] then four 32-bit sizes/offsets
      const bytes = new Uint8Array(headerSize + beginBytes.length);
      // pid count = 0, number of text blocks = 4
      bytes[2] = 4;
      const putUint32 = (offset: number, value: number) => {
        bytes[offset] = value & 0xff;
        bytes[offset + 1] = (value >>> 8) & 0xff;
        bytes[offset + 2] = (value >>> 16) & 0xff;
        bytes[offset + 3] = (value >>> 24) & 0xff;
      };
      putUint32(4, headerSize); // relative offset of 1st text block
      putUint32(8, 0); // paragraph text size
      putUint32(12, beginBytes.length); // beginning style text size
      bytes.set(beginBytes, headerSize);
      return { packetType: NORMAL_STYLE_PACKET_TYPE, bytes };
    }

    it("applies a style packet's own begin block as direct formatting", () => {
      const document = readDocumentArea(
        [
          ...variableFunction({
            group: STYLE_GROUP,
            subgroup: GLOBAL_ON,
            prefixIds: [1],
            nonDeletable: [0, 0, NO_SYSTEM_STYLE],
          }),
          ...text("styled"),
          ...variableFunction({ group: STYLE_GROUP, subgroup: GLOBAL_OFF }),
          ...text("plain"),
        ],
        [normalStylePacket([ATTRIBUTE_ON, BOLD, ATTRIBUTE_ON])],
      );
      const runs = paragraphsOf(document)[0]?.runs;
      expect(runs?.[0]).toEqual({ text: "styled", bold: true });
      expect(runs?.[1]).toEqual({ text: "plain" });
    });

    it("restores font family and colour the style's own begin block changed", () => {
      const document = readDocumentArea(
        [
          ...variableFunction({
            group: 0xd4,
            subgroup: 0x1a, // Font Face Change, naming the descriptor packet at prefix ID 2
            prefixIds: [2],
            nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
          }),
          ...text("before"),
          ...variableFunction({
            group: STYLE_GROUP,
            subgroup: GLOBAL_ON,
            prefixIds: [1],
            nonDeletable: [0, 0, NO_SYSTEM_STYLE],
          }),
          ...text("styled"),
          ...variableFunction({ group: STYLE_GROUP, subgroup: GLOBAL_OFF }),
          ...text("after"),
        ],
        [
          normalStylePacket([ATTRIBUTE_ON, BOLD, ATTRIBUTE_ON]),
          fontDescriptorPacket("Courier New"),
        ],
      );
      const runs = paragraphsOf(document)[0]?.runs;
      expect(runs?.[0]).toEqual({ text: "before", fontFamily: "Courier New" });
      expect(runs?.[1]).toEqual({
        text: "styled",
        bold: true,
        fontFamily: "Courier New",
      });
      expect(runs?.[2]).toEqual({ text: "after", fontFamily: "Courier New" });
    });
  });

  describe("merge fields", () => {
    const MERGE_GROUP = 0xde;
    const FIELD_ON = 0x4c;
    const FIELD_OFF = 0x4d;

    it("tags a FIELD On/Off pair as a field construct, keeping its own displayed text", () => {
      const document = readDocumentArea([
        ...text("Dear "),
        ...variableFunction({ group: MERGE_GROUP, subgroup: FIELD_ON }),
        ...text("CompanyName"),
        ...variableFunction({ group: MERGE_GROUP, subgroup: FIELD_OFF }),
        ...text(","),
      ]);
      const paragraph = paragraphsOf(document)[0];
      expect(paragraph?.runs.map((run) => run.text)).toEqual([
        "Dear ",
        "CompanyName",
        ",",
      ]);
      expect(paragraph?.constructs).toEqual([
        {
          descriptor: { kind: "field", instruction: "CompanyName" },
          startRun: 1,
          endRun: 2,
        },
      ]);
    });

    it("joins a field instruction split across more than one run with no separator", () => {
      const document = readDocumentArea([
        ...variableFunction({ group: MERGE_GROUP, subgroup: FIELD_ON }),
        ...text("Company"),
        0xf2, // ATTRIBUTE_ON (bold), splitting the instruction across two runs
        12, // BOLD
        0xf2,
        ...text("Name"),
        ...variableFunction({ group: MERGE_GROUP, subgroup: FIELD_OFF }),
      ]);
      const construct = paragraphsOf(document)[0]?.constructs?.[0]?.descriptor;
      expect(construct).toEqual({
        kind: "field",
        instruction: "CompanyName",
      });
    });

    it("reports every other merge subfunction through the diagnostic sink, unchanged", () => {
      const diagnostics: WpdDiagnostic[] = [];
      const bytes = buildWpdFile([
        ...variableFunction({ group: MERGE_GROUP, subgroup: 0x08 }), // ELSE
        ...text("plain"),
      ]);
      readWpdContent(bytes, { sink: (d) => diagnostics.push(d) });
      expect(
        diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === WpdDiagnosticCodes.MergeCodeDropped,
        ),
      ).toHaveLength(1);
    });

    it("abandons a FIELD left open across a paragraph boundary and reports it", () => {
      const diagnostics: WpdDiagnostic[] = [];
      const bytes = buildWpdFile([
        ...variableFunction({ group: MERGE_GROUP, subgroup: FIELD_ON }),
        ...text("Name"),
        HARD_EOL,
        ...text("next"),
        ...variableFunction({ group: MERGE_GROUP, subgroup: FIELD_OFF }),
      ]);
      const document = readWpdContent(bytes, {
        sink: (d) => diagnostics.push(d),
      });
      const paragraphs = paragraphsOf(document);
      expect(
        paragraphs.every((paragraph) => paragraph.constructs === undefined),
      ).toBe(true);
      const matches = diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.MergeFieldSpansParagraphs,
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.message).toBe(
        "A merge field's own On/Off pair straddled a paragraph boundary, which the run-scoped field construct cannot express; its text became ordinary paragraph text with no field tag.",
      );
    });
  });
});

describe("readWpd", () => {
  it("assembles the tree form of the same document", () => {
    const tree = readWpd(buildWpdFile(text("Hello")));
    expect(tree.kind).toBe("wordprocessing");
  });

  it("gives a plain document's own section no headers, footers, or watermarks keys at all", () => {
    const tree = readWpd(buildWpdFile(text("plain")));
    if (tree.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const section = tree.children[0]?.node;
    expect(section).toBeDefined();
    for (const key of ["headers", "footers", "watermarks"]) {
      expect(section === undefined ? false : Object.hasOwn(section, key)).toBe(
        false,
      );
    }
  });
});

describe("boxes", () => {
  const BOX_GROUP = 0xdf;
  const PAGE_ANCHORED_BOX = 0x02;
  const BOX_CONTENT_TYPE_TEXT = 1;
  const BOX_CONTENT_TYPE_EQUATION = 4;
  const BOX_CONTENT_TYPE_IMAGE = 3;

  function putUint16(bytes: number[], offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function contentBlock(contentType: number): number[] {
    const flags: number[] = [0, 0];
    putUint16(flags, 0, 0x4000); // bit 14: content type override
    return [...flags, contentType];
  }

  function positionBlock(widthWpu: number, heightWpu: number): number[] {
    const flags: number[] = [0, 0];
    putUint16(flags, 0, 0x0c00); // bits 11 (width) and 10 (height)
    const width = [0, 0, 0];
    putUint16(width, 1, widthWpu);
    const height = [0, 0, 0];
    putUint16(height, 1, heightWpu);
    return [...flags, ...width, ...height];
  }

  // A box function's own nonDeletable bytes: 14 reserved, two unused "total size" words, the override flags word, then each set bit's own size-prefixed block in descending order.
  function boxNonDeletable(
    overrideFlags: number,
    blocks: ReadonlyMap<number, readonly number[]>,
  ): number[] {
    const bytes = new Array<number>(18).fill(0);
    putUint16(bytes, 18, overrideFlags);
    for (let bit = 15; bit >= 5; bit -= 1) {
      const data = blocks.get(bit);
      if (data === undefined) {
        continue;
      }
      putUint16(bytes, bytes.length, data.length);
      bytes.push(...data);
    }
    return bytes;
  }

  function generalWpTextPacket(documentArea: readonly number[]) {
    const header = [
      1,
      0,
      6,
      0,
      documentArea.length & 0xff,
      (documentArea.length >>> 8) & 0xff,
    ];
    return {
      packetType: 0x08,
      bytes: new Uint8Array([...header, ...documentArea]),
    };
  }

  function boxFunction(
    contentType: number,
    prefixIds: readonly number[],
  ): number[] {
    return variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds,
      nonDeletable: boxNonDeletable(
        0x6000, // bit 14 (position) and bit 13 (content)
        new Map([
          [14, positionBlock(1440, 720)], // 1440 WPU = 86.4pt, 720 WPU = 43.2pt
          [13, contentBlock(contentType)],
        ]),
      ),
    });
  }

  it("lifts a text box's own content into an embedded wordprocessing document", () => {
    const document = readDocumentArea(
      [...boxFunction(BOX_CONTENT_TYPE_TEXT, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) }, // box template, not read
        generalWpTextPacket(text("boxed text")),
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    expect(block?.kind).toBe("embeddedObject");
    if (block?.kind !== "embeddedObject")
      throw new Error("expected embeddedObject");
    expect(block.objectKind).toBe("wordprocessing");
    expect(block.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 86.4,
      heightPt: 43.2,
    });
    if (block.document.kind !== "wordprocessing") {
      throw new Error("expected nested wordprocessing document");
    }
    expect(block.document.sections[0]?.blocks[0]).toMatchObject({
      kind: "paragraph",
      runs: [{ text: "boxed text" }],
    });
  });

  it("lifts an equation box's own content as unparsed residue, not fabricated MathML", () => {
    const document = readDocumentArea(
      [...boxFunction(BOX_CONTENT_TYPE_EQUATION, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        generalWpTextPacket(text("a+b")),
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    if (block?.kind !== "embeddedObject")
      throw new Error("expected embeddedObject");
    expect(block.objectKind).toBe("formula");
    if (block.document.kind !== "formula") {
      throw new Error("expected a formula document");
    }
    expect(block.document.formula.mathml).toEqual([]);
    expect(block.document.formula.source).toEqual({
      format: "wpd",
      xml: "a+b",
    });
  });

  // plainTextOf must only ever read paragraph blocks -- a non-paragraph block folded alongside them (a page break, here) carries no `runs` field at all and must be skipped rather than read as one. It must also join a paragraph's own runs with no separator, and join separate paragraphs with a newline.
  it("builds an equation's plain-text residue from only its paragraph blocks, joined correctly", () => {
    const document = readDocumentArea(
      [...boxFunction(BOX_CONTENT_TYPE_EQUATION, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        generalWpTextPacket([
          ...text("a"),
          0xf2, // ATTRIBUTE_ON (bold), splitting the first paragraph across two runs
          12, // BOLD
          0xf2,
          ...text("b"),
          0xcc, // HARD_EOL: ends the first paragraph
          0xc7, // hard end of page: a non-paragraph block between the two paragraphs
          ...text("c"),
        ]),
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    if (block?.kind !== "embeddedObject")
      throw new Error("expected embeddedObject");
    if (block.document.kind !== "formula") {
      throw new Error("expected a formula document");
    }
    // The hard end of page unconditionally flushes a paragraph before it, which is empty here (the hard return just before it already flushed the pending text) -- so the join sees three paragraphs ("ab", "", "c"), with the intervening page break filtered out entirely rather than read as a fourth.
    expect(block.document.formula.source).toEqual({
      format: "wpd",
      xml: "ab\n\nc",
    });
  });

  it("reports an image box through the diagnostic sink rather than guessing at its content", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const bytes = buildWpdFile(
      [...boxFunction(BOX_CONTENT_TYPE_IMAGE, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        { packetType: 0x40, bytes: new Uint8Array([0]) }, // Graphics Filename, not decoded
      ],
    );
    readWpdContent(bytes, { sink: (d) => diagnostics.push(d) });
    const matches = diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === WpdDiagnosticCodes.BoxContentUnresolved,
    );
    expect(matches).toHaveLength(1);
    expect(matches[0]?.message).toBe(
      "This document contains an image box whose content packet carries no decodable PNG or JPEG payload -- a WPG graphic or other image spelling this reader does not decode.",
    );
  });

  // A minimal well-formed 1x1 white PNG: signature, IHDR, IDAT, IEND -- hand-built here as bytes so the fixture needs no encoder dependency, and structurally complete so stream/image.ts's chunk walk bounds it exactly.
  function tinyPng(): Uint8Array {
    const chunk = (type: string, data: readonly number[]): number[] => [
      0,
      0,
      0,
      data.length,
      ...Array.from(type, (c) => c.charCodeAt(0)),
      ...data,
      0,
      0,
      0,
      0, // crc not verified by the scanner
    ];
    return new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
      ...chunk("IDAT", [0x78, 0x01]),
      ...chunk("IEND", []),
    ]);
  }

  it("lifts an image box carrying a PNG payload as a real image block", () => {
    const png = tinyPng();
    const document = readDocumentArea(
      [...boxFunction(BOX_CONTENT_TYPE_IMAGE, [1, 2])],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        // An "Image: WP"-shaped packet: a small unknown header ahead of the payload, so the test proves the magic scan rather than assuming the payload sits at offset 0.
        {
          packetType: 0x42,
          bytes: new Uint8Array([9, 9, 9, 9, ...png, 7, 7]),
        },
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b): b is Extract<ContentBlock, { kind: "image" }> => b.kind === "image",
    );
    if (block === undefined) throw new Error("expected an image block");
    expect(block.format).toBe("png");
    expect(block.base64).toBe(bytesToBase64(png));
    expect(block.widthPt).toBeCloseTo(86.4);
    expect(block.heightPt).toBeCloseTo(43.2);
    expect(block.floatPosition).toBeUndefined();
  });

  it("carries an image box's absolute page position as the image's floatPosition", () => {
    const png = tinyPng();
    // Position override with all four members: horizontal and vertical absolute-from-page-edge offsets (type 0 flags) plus width and height.
    const flags: number[] = [0, 0];
    putUint16(flags, 0, 0x3c00); // bits 13 (h), 12 (v), 11 (width), 10 (height)
    const horizontal = [0x00, 0x10, 0x01, 0, 0]; // type 0 = absolute from page edge, offset 0x0110 WPU = 10.56pt
    const vertical = [0x00, 0x20, 0x02]; // type 0, offset 0x0220 WPU = 21.12pt
    const width = [0, 0, 0];
    putUint16(width, 1, 1440);
    const height = [0, 0, 0];
    putUint16(height, 1, 720);
    const positionedBox = variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds: [1, 2],
      nonDeletable: boxNonDeletable(
        0x6000,
        new Map([
          [14, [...flags, ...horizontal, ...vertical, ...width, ...height]],
          [13, contentBlock(BOX_CONTENT_TYPE_IMAGE)],
        ]),
      ),
    });
    const document = readDocumentArea(
      [...positionedBox],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        { packetType: 0x42, bytes: png },
      ],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const block = document.sections[0]?.blocks.find(
      (b): b is Extract<ContentBlock, { kind: "image" }> => b.kind === "image",
    );
    if (block === undefined) throw new Error("expected an image block");
    expect(block.floatPosition).toEqual({
      horizontal: { relativeTo: "page", offsetPt: 0x0110 * 0.06 },
      vertical: { relativeTo: "page", offsetPt: 0x0220 * 0.06 },
    });
  });

  it("reports a box with no content override through the diagnostic sink", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const bytes = buildWpdFile([
      ...variableFunction({
        group: BOX_GROUP,
        subgroup: PAGE_ANCHORED_BOX,
        prefixIds: [1],
        nonDeletable: boxNonDeletable(0, new Map()),
      }),
    ]);
    readWpdContent(bytes, { sink: (d) => diagnostics.push(d) });
    expect(
      diagnostics.filter(
        (diagnostic) => diagnostic.code === WpdDiagnosticCodes.BoxDropped,
      ),
    ).toHaveLength(1);
  });
});

describe("page furniture and notes (D6/D7, #1128)", () => {
  function generalWpTextPacket(documentArea: readonly number[]) {
    const header = [
      1,
      0,
      6,
      0,
      documentArea.length & 0xff,
      (documentArea.length >>> 8) & 0xff,
    ];
    return {
      packetType: 0x08,
      bytes: new Uint8Array([...header, ...documentArea]),
    };
  }

  function headerFunction(subgroup: number, occurrence: number): number[] {
    return variableFunction({
      group: 0xd6,
      subgroup,
      prefixIds: [1],
      nonDeletable: [occurrence, 0],
    });
  }

  it("lifts a header occurring on odd pages into the section's default header slot", () => {
    const document = readDocumentArea(
      [...text("body"), ...headerFunction(0x00, 0x01)],
      [generalWpTextPacket(text("Confidential draft"))],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.headers?.default?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["Confidential draft"]);
    expect(section.headers?.even).toBeUndefined();
    expect(section.footers).toBeUndefined();
  });

  it("lifts an even-only footer into the even slot", () => {
    const document = readDocumentArea(
      [...text("body"), ...headerFunction(0x02, 0x02)],
      [generalWpTextPacket(text("Page footer"))],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.footers?.even?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["Page footer"]);
    expect(section.footers?.default).toBeUndefined();
  });

  it("lifts a watermark occurring on both parities into the section's default watermark slot", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...text("body"),
          ...variableFunction({
            group: 0xd6,
            subgroup: 0x04,
            prefixIds: [1],
            nonDeletable: [0x03, 0],
          }),
        ],
        [generalWpTextPacket(text("DRAFT"))],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.watermarks?.default?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["DRAFT"]);
    expect(section.watermarks?.even).toBeUndefined();
    // A watermark is lifted page furniture now, not a dropped header-or-footer: the code no longer fires for it.
    expect(
      diagnostics.filter((d) => d.code === "wpd/header-footer-dropped"),
    ).toHaveLength(0);
  });

  it("lifts an even-only watermark into the even slot", () => {
    const document = readDocumentArea(
      [...text("body"), ...headerFunction(0x05, 0x02)],
      [generalWpTextPacket(text("EVEN DRAFT"))],
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.watermarks?.even?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["EVEN DRAFT"]);
    expect(section.watermarks?.default).toBeUndefined();
  });

  it("keeps the first watermark when a second claims the same slot", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...text("body"),
          ...headerFunction(0x04, 0x01),
          ...headerFunction(0x05, 0x01),
        ],
        [generalWpTextPacket(text("First watermark"))],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.watermarks?.default?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["First watermark"]);
    expect(
      diagnostics.some((d) => d.code === "wpd/header-footer-dropped"),
    ).toBe(true);
  });

  it("reports a watermark whose occurrence bits claim neither parity, lifting nothing", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...text("body"),
          ...variableFunction({
            group: 0xd6,
            subgroup: 0x04,
            prefixIds: [1],
            nonDeletable: [0x00, 0],
          }),
        ],
        [generalWpTextPacket(text("DRAFT"))],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    expect(document.sections[0]?.watermarks).toBeUndefined();
    expect(diagnostics).toHaveLength(0);
  });

  it("keeps the first header when a second claims the same slot", () => {
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [
          ...text("body"),
          ...headerFunction(0x00, 0x01),
          ...headerFunction(0x01, 0x01),
        ],
        [generalWpTextPacket(text("First header"))],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    if (document.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const section = document.sections[0];
    if (section === undefined) throw new Error("expected a section");
    expect(
      section.headers?.default?.map((b) =>
        b.kind === "paragraph" ? b.runs.map((run) => run.text).join("") : "",
      ),
    ).toEqual(["First header"]);
    const found = diagnostics.find(
      (d) => d.code === "wpd/header-footer-dropped",
    );
    expect(found?.message).toBe(
      "This document declares a second header for the default slot -- WordPerfect's own A/B two-slot-per-kind mechanism, which the shared one-flow-per-slot page-furniture vocabulary does not carry; the first header to claim the slot is the one lifted.",
    );
  });

  it("anchors a footnote reference in the flat form and carries its body in the tree's definitions table", () => {
    const noteBody = generalWpTextPacket(text("The fine print"));
    const documentArea = [
      ...text("See this"),
      ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [1] }),
      ...text("1"),
      ...variableFunction({ group: 0xd7, subgroup: 0x01 }),
      ...text(" point"),
    ];
    const diagnostics: WpdDiagnostic[] = [];
    const flat = readWpdContent(buildWpdFile(documentArea, [noteBody]), {
      sink: (d) => diagnostics.push(d),
    });
    if (flat.kind !== "wordprocessing")
      throw new Error("expected wordprocessing");
    const paragraph = flat.sections[0]?.blocks.find(
      (b): b is Extract<typeof b, { kind: "paragraph" }> =>
        b.kind === "paragraph",
    );
    expect(paragraph?.constructs?.[0]?.descriptor.kind).toBe("anchor");
    const anchor = paragraph?.constructs?.[0]?.descriptor;
    if (anchor?.kind === "anchor") {
      expect(anchor.anchorType).toBe("footnote");
      expect(anchor.name).toBe("1");
      expect(anchor.definition).toBe("note-1");
    } else {
      throw new Error("expected an anchor descriptor");
    }
    // The flat form reports the body it cannot carry.
    const noteDroppedMatches = diagnostics.filter(
      (d) => d.code === "wpd/note-dropped",
    );
    expect(noteDroppedMatches).toHaveLength(1);
    expect(noteDroppedMatches[0]?.message).toBe(
      "This document contains a footnote whose body the flat ContentDocument has no home for; its reference anchor survives and readWpd lifts the body into the tree form's definitions table.",
    );

    const tree = readWpd(buildWpdFile(documentArea, [noteBody]));
    // The definitions table is deliberately tenant-loose (document-schema.js's own design), so the whole entry is asserted in one toEqual rather than through typed field access.
    expect(tree.definitions?.["note-1"]).toEqual({
      kind: "footnote",
      marker: "1",
      blocks: [
        {
          kind: "paragraph",
          runs: [{ text: "The fine print" }],
        },
      ],
    });
  });

  it("reports the exact could-not-read message for a note whose body packet is the wrong type", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [
          ...text("See this"),
          ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [1] }),
          ...text("1"),
          ...variableFunction({ group: 0xd7, subgroup: 0x01 }),
        ],
        [{ packetType: 0x55, bytes: new Uint8Array(0) }], // a real packet, but not General WP Text
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.NoteDropped,
    );
    expect(found?.message).toBe(
      "This document contains a footnote or endnote whose body packet this reader could not read; its reference anchor survives and its body does not.",
    );
  });

  // The marker text is built from every run between a note's On and Off, flushing whatever text is still pending first -- and only falls back to a generated numeral when that text is genuinely empty. A marker that IS real text, spanning more than one run and happening to be truthy, must be used as-is rather than replaced by the numeral, and the numeral itself must come from the notes already carried plus one, not minus one.
  it("builds a multi-run marker over the generated-numeral fallback, and numbers a genuinely empty marker correctly", () => {
    const bodies = [
      generalWpTextPacket(text("first body")),
      generalWpTextPacket(text("second body")),
    ];
    const tree = readWpd(
      buildWpdFile(
        [
          // Note A: an empty reference marker -- must fall back to the generated numeral "1" (state.notes.length is 0 at this point).
          ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [1] }),
          ...variableFunction({ group: 0xd7, subgroup: 0x01 }),
          // Note B: a genuine, non-empty, two-run marker ("star") that must win over the fallback numeral ("2").
          ...variableFunction({ group: 0xd7, subgroup: 0x00, prefixIds: [2] }),
          ...text("st"),
          0xf2, // ATTRIBUTE_ON (bold), splitting the marker across two runs
          12, // BOLD
          0xf2,
          ...text("ar"),
          ...variableFunction({ group: 0xd7, subgroup: 0x01 }),
        ],
        bodies,
      ),
    );
    expect(tree.definitions?.["note-1"]?.marker).toBe("1");
    expect(tree.definitions?.["note-2"]?.marker).toBe("star");
  });

  it("carries an endnote pair as the endnote tenant", () => {
    const tree = readWpd(
      buildWpdFile(
        [
          ...text("Note"),
          ...variableFunction({ group: 0xd7, subgroup: 0x02, prefixIds: [1] }),
          ...text("2"),
          ...variableFunction({ group: 0xd7, subgroup: 0x03 }),
        ],
        [generalWpTextPacket(text("The endnote body"))],
      ),
    );
    const definition = tree.definitions?.["note-1"];
    expect(definition?.kind).toBe("endnote");
  });
});

describe("native OLE objects (#1191)", () => {
  const BOX_GROUP = 0xdf;
  const PAGE_ANCHORED_BOX = 0x02;
  const BOX_CONTENT_TYPE_IMAGE = 3;

  function putUint16(bytes: number[], offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function contentBlock(contentType: number): number[] {
    const flags: number[] = [0, 0];
    putUint16(flags, 0, 0x4000); // bit 14: content type override
    return [...flags, contentType];
  }

  function positionBlock(widthWpu: number, heightWpu: number): number[] {
    const flags: number[] = [0, 0];
    putUint16(flags, 0, 0x0c00); // bits 11 (width) and 10 (height)
    const width = [0, 0, 0];
    putUint16(width, 1, widthWpu);
    const height = [0, 0, 0];
    putUint16(height, 1, heightWpu);
    return [...flags, ...width, ...height];
  }

  function boxNonDeletable(
    overrideFlags: number,
    blocks: ReadonlyMap<number, readonly number[]>,
  ): number[] {
    const bytes = new Array<number>(18).fill(0);
    putUint16(bytes, 18, overrideFlags);
    for (let bit = 15; bit >= 5; bit -= 1) {
      const data = blocks.get(bit);
      if (data === undefined) {
        continue;
      }
      putUint16(bytes, bytes.length, data.length);
      bytes.push(...data);
    }
    return bytes;
  }

  function imageBoxFunction(): number[] {
    return variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds: [1, 2],
      nonDeletable: boxNonDeletable(
        0x6000, // bit 14 (position) and bit 13 (content)
        new Map([
          [14, positionBlock(1440, 720)],
          [13, contentBlock(BOX_CONTENT_TYPE_IMAGE)],
        ]),
      ),
    });
  }

  // The descriptor packet, assembled from WPFF PrefixPkt83-255's own field table: the 44-byte marker, the fixed head, then the payload wordstring.
  function oleDescriptorPacket(
    marker: string,
    objectNumber: number,
    payload: readonly number[],
  ) {
    // The marker field is 44 bytes and the string with its null is 43, so one pad byte follows.
    const markerBytes = [
      ...Array.from(marker, (character) => character.charCodeAt(0)),
      0,
      0,
    ];
    const fixedHead = [
      3,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      objectNumber & 0xff,
      (objectNumber >>> 8) & 0xff,
      (objectNumber >>> 16) & 0xff,
      (objectNumber >>> 24) & 0xff,
    ];
    return {
      packetType: 0x70,
      bytes: new Uint8Array([...markerBytes, ...fixedHead, ...payload]),
    };
  }

  // A Graphics Filename packet (type 0x40) whose index flags state children and whose data names one child: prefix ID 3, the descriptor packet that follows it in the packet list.
  function graphicsFilenamePacket() {
    return {
      packetType: 0x40,
      flags: 0x01,
      bytes: new Uint8Array([1, 0, 3, 0, 0, 0, 0, 0]),
    };
  }

  it("carries an OLE 2 object's native stream bytes as a tree-form attachment", () => {
    const nativeBytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 9, 9]);
    const bare = buildWpdFile(
      [...imageBoxFunction()],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        graphicsFilenamePacket(),
        oleDescriptorPacket(
          "WPWin7.0/OLE 2.0 Prefix Information Marker",
          0,
          // The null-terminated WP word string naming the objects-storage stream, one ASCII character set 0 word per character.
          [
            ...Array.from("OLE10", (character) =>
              character.charCodeAt(0),
            ).flatMap((code) => [code & 0xff, 0]),
            0,
            0,
          ],
        ),
      ],
    );
    const compound = writeCompoundFile([
      { path: PERFECT_OFFICE_MAIN_STREAM, bytes: bare },
      {
        path: "PerfectOffice_OBJECTS/OLE10",
        bytes: nativeBytes,
      },
    ]);

    // The flat read recovers the bytes but has no field for them, and says so through the OLE-specific code rather than the generic box-content-unresolved one.
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(compound, { sink: (d) => diagnostics.push(d) });
    const oleDroppedMatches = diagnostics.filter(
      (d) => d.code === WpdDiagnosticCodes.OleObjectDropped,
    );
    expect(oleDroppedMatches).toHaveLength(1);
    expect(oleDroppedMatches[0]?.message).toBe(
      "This document embeds a native OLE object ('OLE10') whose bytes the flat ContentDocument has no home for; readWpd lifts them into the tree form's attachments table.",
    );
    expect(
      diagnostics.filter(
        (d) => d.code === WpdDiagnosticCodes.BoxContentUnresolved,
      ),
    ).toHaveLength(0);

    // The tree read carries them, as the attachments-table entry the PDF embedded-file precedent established.
    const tree = readWpd(compound);
    expect(tree.attachments?.OLE10).toEqual({
      kind: "attachment",
      name: "OLE10",
      base64: bytesToBase64(nativeBytes),
    });
  });

  it("carries an OLE 1 object's inline descriptor bytes as a tree-form attachment in a bare file", () => {
    const ole1Data = [0x01, 0x02, 0x03];
    const bare = buildWpdFile(
      [...imageBoxFunction()],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        graphicsFilenamePacket(),
        oleDescriptorPacket(
          "WPWin6.0/OLE 1.0 Prefix Information Marker",
          2,
          ole1Data,
        ),
      ],
    );

    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(bare, { sink: (d) => diagnostics.push(d) });
    expect(
      diagnostics.filter((d) => d.code === WpdDiagnosticCodes.OleObjectDropped),
    ).toHaveLength(1);

    const tree = readWpd(bare);
    expect(tree.attachments?.["ole1-2"]).toEqual({
      kind: "attachment",
      name: "ole1-2",
      base64: bytesToBase64(new Uint8Array(ole1Data)),
    });
    // No footnotes or endnotes rode along with the OLE object, so the tree carries no definitions table entry at all -- not merely an empty one.
    expect(tree.definitions).toBeUndefined();
  });

  it("collapses two boxes naming the same OLE object into one attachment entry", () => {
    const bare = buildWpdFile(
      [...imageBoxFunction(), ...imageBoxFunction()],
      [
        { packetType: 0x41, bytes: new Uint8Array(0) },
        graphicsFilenamePacket(),
        oleDescriptorPacket(
          "WPWin6.0/OLE 1.0 Prefix Information Marker",
          0,
          [0xaa, 0xbb],
        ),
      ],
    );
    const tree = readWpd(bare);
    expect(Object.keys(tree.attachments ?? {})).toEqual(["ole1-0"]);
  });

  it("still reports a graphics packet with no OLE descriptor child as unresolved", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          { packetType: 0x40, bytes: new Uint8Array([0]) }, // no children: just a filename
        ],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    expect(
      diagnostics.filter(
        (d) => d.code === WpdDiagnosticCodes.BoxContentUnresolved,
      ),
    ).toHaveLength(1);
    expect(
      diagnostics.filter((d) => d.code === WpdDiagnosticCodes.OleObjectDropped),
    ).toHaveLength(0);
  });
});

describe("WPG vector graphics embedded in an image box", () => {
  const BOX_GROUP = 0xdf;
  const PAGE_ANCHORED_BOX = 0x02;
  const BOX_CONTENT_TYPE_IMAGE = 3;
  const PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA = 0x6f;

  function putUint16(bytes: number[], offset: number, value: number): void {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function contentBlock(contentType: number): number[] {
    const flags: number[] = [0, 0];
    putUint16(flags, 0, 0x4000);
    return [...flags, contentType];
  }

  function positionBlock(widthWpu: number, heightWpu: number): number[] {
    const flags: number[] = [0, 0];
    putUint16(flags, 0, 0x0c00);
    const width = [0, 0, 0];
    putUint16(width, 1, widthWpu);
    const height = [0, 0, 0];
    putUint16(height, 1, heightWpu);
    return [...flags, ...width, ...height];
  }

  function boxNonDeletable(
    overrideFlags: number,
    blocks: ReadonlyMap<number, readonly number[]>,
  ): number[] {
    const bytes = new Array<number>(18).fill(0);
    putUint16(bytes, 18, overrideFlags);
    for (let bit = 15; bit >= 5; bit -= 1) {
      const data = blocks.get(bit);
      if (data === undefined) {
        continue;
      }
      putUint16(bytes, bytes.length, data.length);
      bytes.push(...data);
    }
    return bytes;
  }

  // An image box naming a Graphics Filename packet at prefix ID 2, itself naming one Graphics Cached File Data child at prefix ID 3 -- the one path stream/wpg.ts's own decoder is reached through. `withFrame` false omits the position override entirely, for the "no trustworthy frame" branch.
  function imageBoxFunction(withFrame = true): number[] {
    const blocks = new Map<number, readonly number[]>([
      [13, contentBlock(BOX_CONTENT_TYPE_IMAGE)],
    ]);
    if (withFrame) {
      blocks.set(14, positionBlock(1440, 720));
    }
    return variableFunction({
      group: BOX_GROUP,
      subgroup: PAGE_ANCHORED_BOX,
      prefixIds: [1, 2],
      nonDeletable: boxNonDeletable(withFrame ? 0x6000 : 0x2000, blocks),
    });
  }

  function graphicsFilenamePacket() {
    return {
      packetType: 0x40,
      flags: 0x01,
      bytes: new Uint8Array([1, 0, 3, 0, 0, 0, 0, 0]),
    };
  }

  function graphicsCachedFileDataPacket(wpgBytes: Uint8Array) {
    return {
      packetType: PACKET_TYPE_GRAPHICS_CACHED_FILE_DATA,
      bytes: wpgBytes,
    };
  }

  function word(value: number): number[] {
    return [value & 0xff, (value >>> 8) & 0xff];
  }

  function dword(value: number): number[] {
    return [...word(value & 0xffff), ...word((value >>> 16) & 0xffff)];
  }

  function wpgRecord(type: number, data: readonly number[]): number[] {
    return [0x0f, type, 0, data.length, ...data];
  }

  // A minimal, well-formed WPG 2.x stream: the 26-byte prefix, a Start WPG stating a 288x144pt extent at 72ppi, one framed Rectangle vector, and End WPG.
  function wpgFile(options: {
    readonly majorVersion?: number;
    readonly encrypted?: boolean;
    readonly withRecordStream?: boolean;
    readonly withVector?: boolean;
  }): Uint8Array {
    const majorVersion = options.majorVersion ?? 2;
    const startWpgData = [
      ...word(72),
      ...word(72),
      0,
      ...word(0),
      ...word(0),
      ...word(0x7fff),
      ...word(0x7fff),
      ...word(0),
      ...word(0),
      ...word(288),
      ...word(144),
    ];
    const records =
      options.withRecordStream === false
        ? []
        : [
            ...wpgRecord(0x01, startWpgData),
            ...(options.withVector === false
              ? []
              : wpgRecord(0x18, [
                  ...word(0x8000),
                  ...word(0),
                  ...word(0),
                  ...word(10),
                  ...word(10),
                  ...word(0),
                  ...word(0),
                ])),
            ...wpgRecord(0x02, []),
          ];
    const head = [
      0xff,
      0x57,
      0x50,
      0x43,
      ...dword(26),
      1,
      0x16,
      majorVersion,
      0,
      ...word(options.encrypted ? 1 : 0),
      ...word(26),
      0,
      0,
      ...word(0),
      ...dword(26 + records.length),
      ...word(0),
    ];
    return new Uint8Array([...head, ...records]);
  }

  it("lifts a decoded WPG graphic as a nested drawing embeddedObject, naming its one skipped record", () => {
    // A Polyspline record (0x16, unrecognised by this reader) rides alongside the framed rectangle, so the decode both succeeds and reports a skipped record.
    const wpg = wpgFile({});
    const withSkip = new Uint8Array([
      ...wpg.subarray(0, wpg.length - 4), // drop the trailing End WPG record
      ...wpgRecord(0x16, [
        ...word(0x8000),
        ...word(2),
        ...word(0),
        ...word(0),
        ...word(5),
        ...word(5),
      ]),
      ...wpgRecord(0x02, []),
    ]);
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(withSkip),
        ],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    if (block?.kind !== "embeddedObject") {
      throw new Error("expected an embeddedObject block");
    }
    expect(block.objectKind).toBe("drawing");
    expect(block.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 86.4,
      heightPt: 43.2,
    });
    if (block.document.kind !== "drawing") {
      throw new Error("expected a drawing document");
    }
    expect(block.document.pages).toHaveLength(1);
    expect(block.document.pages[0]?.size).toEqual({
      widthPt: 288,
      heightPt: 144,
    });
    expect(block.document.pages[0]?.vectors).toHaveLength(1);
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
    );
    expect(found?.message).toBe(
      "This document embeds a WPG vector graphic that partially decoded; the following record types were skipped: Polyspline.",
    );
  });

  it("lifts a decoded WPG graphic with no skipped records, reporting nothing", () => {
    const wpg = wpgFile({});
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const block = document.sections[0]?.blocks.find(
      (b) => b.kind === "embeddedObject",
    );
    expect(block?.kind).toBe("embeddedObject");
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
      ),
    ).toBe(false);
  });

  it("reports a decoded WPG graphic with no trustworthy frame, lifting nothing", () => {
    const wpg = wpgFile({});
    const diagnostics: WpdDiagnostic[] = [];
    const document = readWpdContent(
      buildWpdFile(
        [...imageBoxFunction(false)],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    if (document.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    expect(
      document.sections[0]?.blocks.some((b) => b.kind === "embeddedObject"),
    ).toBe(false);
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.BoxFrameUnresolved,
    );
    expect(found?.message).toBe(
      "This document contains a box whose content this reader could read, but whose function-level override states no width and height this reader can trust, so its content was not lifted.",
    );
  });

  it("reports a WPG 1.0 graphic through the diagnostic sink with its own exact message", () => {
    const wpg = wpgFile({ majorVersion: 1 });
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
    );
    expect(found?.message).toBe(
      "This document embeds a WPG 1.0 vector graphic, whose type-and-length record vocabulary predates the framed WPG 2.x stream this reader decodes, so it was not lifted.",
    );
  });

  it("reports an encrypted WPG graphic through the diagnostic sink with its own exact message", () => {
    const wpg = wpgFile({ encrypted: true });
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
    );
    expect(found?.message).toBe(
      "This document embeds an encrypted WPG vector graphic, which this reader does not decrypt, so it was not lifted.",
    );
  });

  it("reports a malformed WPG graphic (no walkable Start WPG record) with its own exact message", () => {
    const wpg = wpgFile({ withRecordStream: false });
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile(
        [...imageBoxFunction()],
        [
          { packetType: 0x41, bytes: new Uint8Array(0) },
          graphicsFilenamePacket(),
          graphicsCachedFileDataPacket(wpg),
        ],
      ),
      { sink: (d) => diagnostics.push(d) },
    );
    const found = diagnostics.find(
      (d) => d.code === WpdDiagnosticCodes.WpgRecordsUndecoded,
    );
    expect(found?.message).toBe(
      "This document embeds a WPG graphic whose record stream this reader could not walk (no well-formed Start WPG record), so it was not lifted.",
    );
  });
});
