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
import {
  ATTRIBUTE_ON,
  BOLD,
  HARD_EOL,
  paragraphsOf,
  readDocumentArea,
} from "./test-support/read-fixtures";

describe("readWpdContent", () => {
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

  // applyVariableFunction's own group dispatch must fall through its default case, contributing nothing, for a variable-function group this reader names no handling for at all.
  it("contributes nothing for a variable-function group with no named case", () => {
    const document = readDocumentArea([
      ...text("un"),
      ...variableFunction({ group: 0xd8, subgroup: 0 }), // an unassigned variable-function group
      ...text("broken"),
    ]);
    const paragraphs = paragraphsOf(document);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs[0]?.text).toBe("unbroken");
  });

  // Subfunction 0, Beginning of File, is the one End-of-Line subfunction with no single-byte spelling at all — it exists solely as this group's own subgroup 0 — and the SDK's own conversion table maps it to nothing: it contributes neither a character nor a paragraph break.
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
      {
        sink: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
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

  // "An auto-hyphen was inserted by the formatter at the end of a line" — displayed exactly like the other end-of-line hyphen functions.
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

  // "The formatter inserts a soft End of Line, which causes centering to end, but not the paragraph" — a wrap, so it becomes the same space every other soft end of line converts to.
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

  // A single-byte function code this switch names no case for at all — one of the format's own formatting/bookkeeping markers this reader has no specific behaviour for — must fall through to the default case and contribute neither characters nor structure, exactly like the codes with an explicit no-op case.
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
  // flushParagraphIfContent must still flush when the pending text is empty but a run has already been split off it (here, by an attribute change) — checking only state.text.length would wrongly drop that already-built run.
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
      {
        sink: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
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
      sink: (d) => {
        diagnostics.push(d);
      },
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
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
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

  // A font face change that names an unreadable typeface must leave a PREVIOUSLY set font family in place for the run it starts, rather than clearing it — the failed change contributes nothing, it does not reset what came before it.
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
    // No system style number, so styleSemanticsFor contributes nothing — isolating the packet's own direct-formatting effect from the heading/list mapping a system style number would otherwise add.
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
      readWpdContent(bytes, {
        sink: (d) => {
          diagnostics.push(d);
        },
      });
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
        sink: (d) => {
          diagnostics.push(d);
        },
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

  // The tree-form section must actually carry a header, footer, and watermark when the document declares them — proving readWpd's own headers/footers/watermarks spreads fire when non-empty, not just that they stay absent when empty.
  it("carries a header, footer, and watermark on the tree-form section", () => {
    function furniturePacket(text_: string) {
      const documentArea = text(text_);
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
    function furnitureFunction(subgroup: number, prefixId: number): number[] {
      return variableFunction({
        group: 0xd6,
        subgroup,
        prefixIds: [prefixId],
        nonDeletable: [1, 0], // occurrence: odd/default pages
      });
    }
    const tree = readWpd(
      buildWpdFile(
        [
          ...text("body"),
          ...furnitureFunction(0x00, 1), // header
          ...furnitureFunction(0x02, 2), // footer
          ...furnitureFunction(0x04, 3), // watermark
        ],
        [furniturePacket("H"), furniturePacket("F"), furniturePacket("W")],
      ),
    );
    if (tree.kind !== "wordprocessing") {
      throw new Error("expected wordprocessing");
    }
    const section = tree.children[0]?.node;
    if (section?.kind !== "section") {
      throw new Error("expected a section node");
    }
    expect(Object.hasOwn(section, "headers")).toBe(true);
    expect(Object.hasOwn(section, "footers")).toBe(true);
    expect(Object.hasOwn(section, "watermarks")).toBe(true);
  });
});
