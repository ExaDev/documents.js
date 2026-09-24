import { describe, expect, it } from "vitest";
import { WpdDiagnosticCodes, type WpdDiagnostic } from "./diagnostics";
import { readWpdContent } from "./read";
import {
  assertDefined,
  UNREACHABLE_CHARACTER_MAPPING_MESSAGE,
} from "./read-runs";
import {
  buildWpdFile,
  fontDescriptorPacket,
  text,
  variableFunction,
} from "./test-support/build-wpd";
import {
  ATTRIBUTE_OFF,
  ATTRIBUTE_ON,
  BOLD,
  DOUBLE_UNDERLINE,
  HARD_EOL,
  HARD_EOP,
  HARD_SPACE,
  ITALICS,
  paragraphsOf,
  readDocumentArea,
  SMALL_CAPS,
  SOFT_EOL,
  SOFT_SPACE,
  STRIKEOUT,
  UNDERLINE,
} from "./test-support/read-fixtures";

describe("assertDefined", () => {
  it("throws with the exact given message for an undefined value", () => {
    expect(() => {
      assertDefined(undefined, "should not be undefined");
    }).toThrow("should not be undefined");
  });

  // UNREACHABLE_CHARACTER_MAPPING_MESSAGE's own exact text, asserted against a hardcoded duplicate rather than by importing and comparing the constant to itself — no real document byte can ever trigger this message at its one call site (applyToken's "character" case), so this is the only test that can catch a change to its actual wording.
  it("carries UNREACHABLE_CHARACTER_MAPPING_MESSAGE's own exact text", () => {
    expect(UNREACHABLE_CHARACTER_MAPPING_MESSAGE).toBe(
      "A single-byte document-area character had no character mapping, which the tokeniser's own byte range should make unreachable.",
    );
  });

  it("does not throw for a defined value, including a falsy one", () => {
    expect(() => {
      assertDefined(0, "unreachable");
    }).not.toThrow();
    expect(() => {
      assertDefined("", "unreachable");
    }).not.toThrow();
  });
});

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

  // A hard return's own case must actually end there in the switch, not fall through into the next case (hardEndOfColumn) and report a column-break diagnostic that never happened.
  it("does not report a column break for a plain hard end of line", () => {
    const diagnostics: WpdDiagnostic[] = [];
    readWpdContent(
      buildWpdFile([...text("First"), HARD_EOL, ...text("Second")]),
      {
        sink: (d) => {
          diagnostics.push(d);
        },
      },
    );
    expect(
      diagnostics.some(
        (d) => d.code === WpdDiagnosticCodes.ColumnBreakFlattened,
      ),
    ).toBe(false);
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
    const document = readWpdContent(
      buildWpdFile([...text("x"), 0xf0, 0, 12, 0xf0]),
      {
        sink: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
    );
    expect(paragraphsOf(document)[0]?.runs[0]?.text).toBe("x�");
    const found = diagnostics.find(
      (diagnostic) => diagnostic.code === WpdDiagnosticCodes.UnmappedCharacter,
    );
    expect(found?.message).toBe(
      "Character 0 of WordPerfect character set 12 has no mapping in this package and was rendered as U+FFFD.",
    );
  });

  // A fixed-length function code this reader names no specific meaning for at all — Undo (0xF1), reserved by the format but not one applyFixedFunction handles — must contribute neither a character nor an attribute change.
  it("contributes nothing for a fixed-length function code with no named meaning", () => {
    const document = readDocumentArea([
      ...text("un"),
      0xf1,
      0,
      0,
      0,
      0xf1, // Undo: a genuine 5-byte fixed function, gated at both ends
      ...text("broken"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([{ text: "unbroken" }]);
  });

  // A fixed-length function code with no named meaning must not be misread as an ATTRIBUTE_ON/OFF payload even when its own data byte happens to look like a real attribute number: since its own code is neither ATTRIBUTE_ON nor ATTRIBUTE_OFF, misreading it would take the ATTRIBUTE_OFF branch (deleting the attribute) regardless of which real code opened it, silently turning bold back off.
  it("does not clear an active attribute for a fixed-length function code with no named meaning", () => {
    const document = readDocumentArea([
      0xf2, // ATTRIBUTE_ON (bold)
      12,
      0xf2,
      ...text("before"),
      0xf1,
      12, // BOLD's own attribute number, in a code this reader does not treat as an attribute code at all
      0,
      0,
      0xf1, // Undo: a genuine 5-byte fixed function, gated at both ends
      ...text("after"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([
      { text: "beforeafter", bold: true },
    ]);
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
      0x8e, // END_OF_TEXT_TO_SKIP — balances the Start above
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

  // "[desired point size (3600ths)]" is the first field of a Font Size Change, and a point is 1/72 inch, so 36,000 3600ths of an inch is ten inches — and 600 is twelve points.
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

  it("splits the run at a font size change, leaving earlier text without the new size", () => {
    const document = readDocumentArea([
      ...text("before"),
      ...variableFunction({
        group: 0xd4,
        subgroup: 0x1b,
        nonDeletable: [0x58, 0x02, 0, 0, 0, 0, 0, 0],
      }),
      ...text("after"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([
      { text: "before" },
      { text: "after", sizePt: 12 },
    ]);
  });

  it("ignores a font size change whose non-deletable data is too short to hold a size word", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: 0xd4,
        subgroup: 0x1b,
        nonDeletable: [0x58], // one byte — not enough for the size word
      }),
      ...text("sized"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]).toEqual({ text: "sized" });
  });

  it("reads a font size change whose non-deletable data is exactly the size word's own length", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: 0xd4,
        subgroup: 0x1b,
        nonDeletable: [0x58, 0x02], // exactly two bytes, the size word itself and nothing more
      }),
      ...text("sized"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]).toEqual({
      text: "sized",
      sizePt: 12,
    });
  });

  it("ignores a font size change of exactly zero points", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: 0xd4,
        subgroup: 0x1b,
        nonDeletable: [0, 0, 0, 0, 0, 0, 0, 0],
      }),
      ...text("sized"),
    ]);
    expect(paragraphsOf(document)[0]?.runs[0]).toEqual({ text: "sized" });
  });

  it("splits the run at a character colour change, leaving earlier text without the new colour", () => {
    const document = readDocumentArea([
      ...text("before"),
      ...variableFunction({
        group: 0xd4,
        subgroup: 0x18,
        nonDeletable: [102, 51, 204],
      }),
      ...text("after"),
    ]);
    expect(paragraphsOf(document)[0]?.runs).toEqual([
      { text: "before" },
      {
        text: "after",
        color: { r: 102 / 255, g: 51 / 255, b: 204 / 255 },
      },
    ]);
  });

  // applyCharacterGroup's own switch must fall through its default case, contributing nothing, for a character-group subgroup this reader names no handling for at all.
  it("contributes nothing for a character-group subgroup with no named case", () => {
    const document = readDocumentArea([
      ...text("un"),
      ...variableFunction({ group: 0xd4, subgroup: 0x19 }), // an unassigned character-group subgroup
      ...text("broken"),
    ]);
    const paragraphs = paragraphsOf(document);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs[0]?.text).toBe("unbroken");
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

  // applyVariableFunction's own paragraph-group dispatch must actually gate on the subgroup being PARAGRAPH_SET_JUSTIFICATION — a different subfunction in the same group, even one whose own first byte happens to look like a justification mode, must not be misread as one.
  it("does not apply a justification change for an unrelated paragraph-group subfunction", () => {
    const document = readDocumentArea([
      ...variableFunction({
        group: 0xd3,
        subgroup: 0x01, // not PARAGRAPH_SET_JUSTIFICATION
        nonDeletable: [2], // happens to look like "center" if misread as a justification mode
      }),
      ...text("plain"),
    ]);
    expect(paragraphsOf(document)[0]?.alignment).toBeUndefined();
  });
});
