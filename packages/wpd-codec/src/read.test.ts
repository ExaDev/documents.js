import type { ContentDocument, ContentParagraph } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpd, readWpdContent } from "./read";
import {
  buildWpdFile,
  fontDescriptorPacket,
  text,
  variableFunction,
} from "./test-support/build-wpd";
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
    // Character set 8 is one of the sets whose table this package cannot state from a primary source.
    readWpdContent(buildWpdFile([...text("x"), 0xf0, 5, 8, 0xf0]), {
      sink: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      WpdDiagnosticCodes.UnmappedCharacter,
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
        nonDeletable: [255, 0, 0],
      }),
      ...text("red"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]?.color).toEqual({
      r: 1,
      g: 0,
      b: 0,
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

  // A cell or row boundary with no Table Definition open has no grid to belong to, which a stray code left behind by an edit can produce. The text on either side still survives as paragraphs, in reading order.
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
    expect(
      diagnostics.filter(
        (diagnostic) => diagnostic.code === WpdDiagnosticCodes.TableFlattened,
      ),
    ).toHaveLength(1);
  });

  // The same document in both containers must read identically: a WordPerfect 6.x file writes the byte stream straight to disk, and WP7 onwards may wrap the identical stream in an OLE compound file.
  it("reads the same document from a bare file and from an OLE compound wrapper", () => {
    const bare = buildWpdFile([...text("Hello"), HARD_EOL, ...text("World")]);
    expect(
      readWpdContent(compoundFileWithStream(PERFECT_OFFICE_MAIN_STREAM, bare)),
    ).toEqual(readWpdContent(bare));
  });
});

describe("readWpd", () => {
  it("assembles the tree form of the same document", () => {
    const tree = readWpd(buildWpdFile(text("Hello")));
    expect(tree.kind).toBe("wordprocessing");
  });
});
