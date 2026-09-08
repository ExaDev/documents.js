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
    // Character 0 of set 12 (Tibetan): libwpd's own tibetanMap1 table has no entry below character number 33, so this position genuinely has no mapping in the cited source rather than being a gap this package introduced.
    readWpdContent(buildWpdFile([...text("x"), 0xf0, 0, 12, 0xf0]), {
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
      expect(
        diagnostics.filter(
          (diagnostic) =>
            diagnostic.code === WpdDiagnosticCodes.MergeFieldSpansParagraphs,
        ),
      ).toHaveLength(1);
    });
  });
});

describe("readWpd", () => {
  it("assembles the tree form of the same document", () => {
    const tree = readWpd(buildWpdFile(text("Hello")));
    expect(tree.kind).toBe("wordprocessing");
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
    expect(
      diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === WpdDiagnosticCodes.BoxContentUnresolved,
      ),
    ).toHaveLength(1);
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
