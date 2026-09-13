import { describe, expect, it } from "vitest";
import { readRtfHeader } from "./header";
import { bytes } from "./test-support/bytes";
import { tokenizeRtf } from "./tokenize";

// The fixtures are the specification's own header examples, or minimal instances of the grammar productions it states for each table (RTF 1.9.1, "Font Table", "Color Table", "Style Sheet", "List Table", "List Override Table").

function headerOf(source: string) {
  return readRtfHeader(tokenizeRtf(bytes(source)), () => {
    /* diagnostics are asserted by the reader's own suite, not here */
  });
}

describe("font table", () => {
  const sample =
    "{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0\\froman Tms Rmn;}{\\f1\\fdecor Symbol;}{\\f2\\fswiss Helv;}}}";

  it("reads each <fontinfo>'s number and name from the spec's own example", () => {
    const { fonts } = headerOf(sample);
    expect(fonts.get(0)?.name).toBe("Tms Rmn");
    expect(fonts.get(1)?.name).toBe("Symbol");
    expect(fonts.get(2)?.name).toBe("Helv");
  });

  it("reads a <fontinfo> written without its own enclosing braces, which the grammar also admits", () => {
    const { fonts } = headerOf("{\\rtf1{\\fonttbl\\f0\\fswiss Arial;}}");
    expect(fonts.get(0)?.name).toBe("Arial");
  });

  it("maps \\fcharsetN to the code page the spec's own charset table pairs it with", () => {
    const { fonts } = headerOf(
      "{\\rtf1{\\fonttbl{\\f0\\froman\\fcharset238 Times New Roman CE;}}}",
    );
    expect(fonts.get(0)?.codepage).toBe(1250);
  });

  it("lets \\cpgN supersede the code page \\fcharsetN implies, as the spec requires", () => {
    const { fonts } = headerOf(
      "{\\rtf1{\\fonttbl{\\f0\\fswiss\\fcharset0\\cpg1251 Arial Cyr;}}}",
    );
    expect(fonts.get(0)?.codepage).toBe(1251);
  });

  it("does not let a bare \\cpg with no digits clobber an already-recorded \\cpgN", () => {
    const { fonts } = headerOf(
      "{\\rtf1{\\fonttbl{\\f0\\fswiss\\fcharset0\\cpg1251\\cpg Arial Cyr;}}}",
    );
    expect(fonts.get(0)?.codepage).toBe(1251);
  });

  it("does not let a bare \\f with no digits clobber an already-recorded font number", () => {
    const { fonts } = headerOf("{\\rtf1{\\fonttbl{\\f0\\froman\\f Arial;}}}");
    expect(fonts.get(0)?.name).toBe("Arial");
  });

  it("ignores the {\\*\\falt ...} alternate-name subgroup rather than folding it into the face name", () => {
    const { fonts } = headerOf(
      "{\\rtf1{\\fonttbl{\\f0\\froman\\fcharset0 Cambria{\\*\\falt Times New Roman};}}}",
    );
    expect(fonts.get(0)?.name).toBe("Cambria");
  });

  it("records the family keyword each <fontfamily> production names", () => {
    const { fonts } = headerOf(sample);
    expect(fonts.get(0)?.family).toBe("roman");
    expect(fonts.get(2)?.family).toBe("swiss");
  });

  it("decodes a \\'hh hex byte inside a font name through the entry's own code page", () => {
    // 0x41 is 'A' in every single-byte code page this decodes through, so the assertion holds regardless of which one \fcharset0 resolves to.
    const { fonts } = headerOf(
      "{\\rtf1{\\fonttbl{\\f0\\froman\\fcharset0 C\\'41B;}}}",
    );
    expect(fonts.get(0)?.name).toBe("CAB");
  });

  it("flushes pending bytes before skipping a nested group, not after, so a DBCS lead byte never spans across it", () => {
    // \cpg932's lead/trail byte scheme means combining a byte from before {\*\falt ...} with one from after it (rather than flushing each side separately) decodes the two together as one Shift-JIS character instead of the lone lead byte's own U+FFFD fallback followed by the plain ASCII byte after it.
    const { fonts } = headerOf(
      "{\\rtf1{\\fonttbl{\\f0\\froman\\cpg932 \\'81{\\*\\falt X}\\'40;}}}",
    );
    expect(fonts.get(0)?.name).toBe(`${String.fromCodePoint(0xfffd)}@`);
  });

  it("does not flush an empty pending run into a diagnostic-worthy decode", () => {
    // \cpg99999 is deliberately unsupported, so decoding through it emits one UNSUPPORTED_CODEPAGE warning per real, non-empty flush -- {\*\falt X} is skipped as a nested group before any name text has accumulated, so an unguarded flush right there would decode zero bytes through the same unsupported page and emit a second, spurious warning nothing in the actual name justifies.
    const diagnostics: unknown[] = [];
    const tokens = tokenizeRtf(
      bytes("{\\rtf1{\\fonttbl{\\f0\\froman\\cpg99999{\\*\\falt X}Y;}}}"),
    );
    readRtfHeader(tokens, (diagnostic) => diagnostics.push(diagnostic));
    expect(diagnostics).toHaveLength(1);
  });

  it("trims leading whitespace from a font name, not just the trailing semicolon", () => {
    // The <fontinfo> delimiter space after each control word is already consumed by the tokenizer, so these extra leading/trailing spaces are genuinely part of the name's own text run, not delimiter artifacts -- only .trim() removes the leading pair; the trailing-semicolon regex only ever touches what comes after the last real character.
    const { fonts } = headerOf("{\\rtf1{\\fonttbl{\\f0\\froman  Arial ;}}}");
    expect(fonts.get(0)?.name).toBe("Arial");
  });

  it("decodes a \\uN unicode escape inside a font name, for both a positive and a negative-encoded code point", () => {
    const { fonts } = headerOf(
      "{\\rtf1{\\fonttbl{\\f0\\froman A\\u233 B\\u-1C;}}}",
    );
    // \u233 is U+00E9 (233); \u-1 is RTF's signed-16-bit spelling of U+FFFF (-1 + 0x10000).
    expect(fonts.get(0)?.name).toBe(
      `A${String.fromCodePoint(233)}B${String.fromCodePoint(0xffff)}C`,
    );
  });

  it("does not add 0x1_00_00 to \\u0, the boundary case that is exactly zero rather than negative", () => {
    // code < 0 is false for code === 0 -- a <= mutation would wrongly take the negative-encoding branch for this exact boundary value, producing U+10000 instead of NUL.
    const { fonts } = headerOf("{\\rtf1{\\fonttbl{\\f0\\froman A\\u0B;}}}");
    expect(fonts.get(0)?.name).toBe(`A${String.fromCodePoint(0)}B`);
  });

  it("skips more than one non-brace token before finding the next <fontinfo>'s own opening brace", () => {
    // Two \filetbl-unrelated bare control words ahead of the first braced font entry: parseFontTable's own char-by-char pre-scan must step forward through both, not just tolerate a single one.
    const { fonts } = headerOf(
      "{\\rtf1{\\fonttbl\\deflang1033\\ftnbj{\\f0\\froman Arial;}}}",
    );
    expect(fonts.get(0)?.name).toBe("Arial");
  });

  it("does not let an unrelated control word with its own numeric parameter clobber the codepage as if it were \\cpgN", () => {
    // \fprq carries no field this reader records at all (see readFontInfo's own comment); reaching this table entry with a defined param must never fall into the \cpg branch merely for being the last check in the chain.
    const { fonts } = headerOf(
      "{\\rtf1{\\fonttbl{\\f0\\fswiss\\cpg1251\\fprq2 Arial Cyr;}}}",
    );
    expect(fonts.get(0)?.codepage).toBe(1251);
  });
});

describe("color table", () => {
  // The spec's own example opens with a bare semicolon: "{\colortbl;\red0\green0\blue0;..." -- the first entry defines no components at all, which is the 'auto' colour.
  const sample =
    "{\\rtf1{\\colortbl;\\red0\\green0\\blue0;\\red255\\green0\\blue0;\\red0\\green0\\blue255;}}";

  it("leaves index 0 undefined for the auto colour the leading semicolon states", () => {
    expect(headerOf(sample).colors[0]).toBeUndefined();
  });

  it("reads each <colordef>'s red/green/blue into a 0..1 Color", () => {
    const { colors } = headerOf(sample);
    expect(colors[1]).toEqual({ r: 0, g: 0, b: 0 });
    expect(colors[2]).toEqual({ r: 1, g: 0, b: 0 });
    expect(colors[3]).toEqual({ r: 0, g: 0, b: 1 });
  });

  it("keeps a theme colour's own literal red/green/blue, which the spec says is always provided alongside", () => {
    const { colors } = headerOf(
      "{\\rtf1{\\colortbl;\\caccentone\\ctint255\\cshade191\\red174\\green150\\blue56;}}",
    );
    expect(colors[1]).toEqual({ r: 174 / 255, g: 150 / 255, b: 56 / 255 });
  });

  it("is a real colour, not the auto entry, when only one of red/green/blue is stated", () => {
    // Only \red is present here -- green and blue are genuinely absent from the entry, not merely zero -- so this must still resolve to a real (defaulted-to-0) colour rather than being mistaken for the auto entry, which requires all three to be absent.
    const { colors } = headerOf("{\\rtf1{\\colortbl;\\red200;}}");
    expect(colors[1]).toEqual({ r: 200 / 255, g: 0, b: 0 });
  });

  it("is a real colour when only \\green is stated, not the auto entry", () => {
    const { colors } = headerOf("{\\rtf1{\\colortbl;\\green100;}}");
    expect(colors[1]).toEqual({ r: 0, g: 100 / 255, b: 0 });
  });

  it("is a real colour when only \\blue is stated, not the auto entry", () => {
    const { colors } = headerOf("{\\rtf1{\\colortbl;\\blue50;}}");
    expect(colors[1]).toEqual({ r: 0, g: 0, b: 50 / 255 });
  });

  it("does not treat an unrelated control word as \\blue just because it isn't \\red or \\green", () => {
    // \wgrffmtfilter99 names no field this table reads at all -- it must be ignored, not mistaken for \blue99 merely for falling into the same else-if chain's final branch.
    const { colors } = headerOf(
      "{\\rtf1{\\colortbl;\\red10\\green20\\wgrffmtfilter99;}}",
    );
    expect(colors[1]).toEqual({ r: 10 / 255, g: 20 / 255, b: 0 });
  });

  it("only finishes the current entry on a real semicolon byte, not on every byte of trailing text", () => {
    // "xy;" after \blue30 is 3 plain text bytes -- only the last one is the entry terminator; treating every byte as one would finish (and reset) the entry twice more, in each case with nothing left to record.
    const { colors } = headerOf(
      "{\\rtf1{\\colortbl;\\red10\\green20\\blue30xy;}}",
    );
    expect(colors).toHaveLength(2);
    expect(colors[1]).toEqual({ r: 10 / 255, g: 20 / 255, b: 30 / 255 });
  });
});

describe("style sheet", () => {
  it("reads the spec's own one-entry example, whose <styledef> is omitted and so means paragraph style 0", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\fs20 \\snext0 Normal;}}}",
    );
    expect(styles.get(0)?.name).toBe("Normal");
  });

  it("reads a heading style's own \\sN handle and name", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s1\\sbasedon0\\snext0 heading 1;}{\\s2\\sbasedon0\\snext0 heading 2;}}}",
    );
    expect(styles.get(1)?.name).toBe("heading 1");
    expect(styles.get(2)?.name).toBe("heading 2");
  });

  it("derives a heading level from a built-in 'heading N' style name", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s3\\snext0 heading 3;}}}",
    );
    expect(styles.get(3)?.headingLevel).toBe(3);
  });

  it("derives a heading level from \\outlinelevelN inside the style, which is 0-based", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s7\\outlinelevel1\\snext0 My Subhead;}}}",
    );
    expect(styles.get(7)?.headingLevel).toBe(2);
  });

  it("prefers \\outlinelevelN over a conflicting 'heading N' style name", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s5\\outlinelevel3\\snext0 heading 1;}}}",
    );
    expect(styles.get(5)?.headingLevel).toBe(4);
  });

  it("leaves headingLevel undefined when neither \\outlinelevelN nor a 'heading N' name is present", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s4\\snext0 Body Text;}}}",
    );
    expect(styles.get(4)?.headingLevel).toBeUndefined();
  });

  it("skips a character style, which the spec requires be written as {\\*\\csN ...}", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s0 Normal;}{\\*\\cs10\\additive Default Paragraph Font;}}}",
    );
    expect(styles.get(0)?.name).toBe("Normal");
    expect(styles.has(10)).toBe(false);
  });

  it("prefers \\outlinelevelN over a conflicting 'heading N' style name", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s5\\outlinelevel3\\snext0 heading 1;}}}",
    );
    expect(styles.get(5)?.headingLevel).toBe(4);
  });

  it("does not let a bare \\outlinelevel with no digits clobber an already-recorded \\outlinelevelN", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s6\\outlinelevel2\\outlinelevel\\snext0 Body;}}}",
    );
    expect(styles.get(6)?.headingLevel).toBe(3);
  });

  it("skips a nested group inside a style entry whole, rather than reading a stray \\sN inside it as this entry's own handle", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s3{\\*\\keycode\\s99}\\snext0 My Style;}}}",
    );
    expect(styles.get(3)?.name).toBe("My Style");
    expect(styles.has(99)).toBe(false);
  });

  it("skips a stray text byte between two style groups rather than misreading it as the next entry's own opening brace", () => {
    // The tokenizer drops bare CR/LF as pure whitespace, but a literal space here is a real "text" token some producers still emit for readability between destination groups -- treating it as if it were a groupStart would fold the whole of the next entry into a bogus, mis-scoped one and lose it.
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s1\\snext0 heading 1;} {\\s2\\snext0 heading 2;}}}",
    );
    expect(styles.get(2)?.name).toBe("heading 2");
  });
});

describe("list and list override tables", () => {
  // One \list whose single \listlevel is a bullet (\levelnfc23), and one whose level is arabic (\levelnfc0) starting at 3, each reached through its own \listoverride's \lsN -- the level of indirection the spec describes: "Each paragraph will contain a list override index (keyword \lsN), which is a 1-based index into this table."
  const sample =
    "{\\rtf1{\\*\\listtable" +
    "{\\list\\listtemplateid1\\listsimple{\\listlevel\\levelnfc23\\leveljc0\\levelstartat1{\\leveltext \\'01\\u183 ?;}{\\levelnumbers;}}\\listid101}" +
    "{\\list\\listtemplateid2\\listsimple{\\listlevel\\levelnfc0\\leveljc0\\levelstartat3{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}\\listid102}" +
    "}{\\*\\listoverridetable{\\listoverride\\listid101\\listoverridecount0\\ls1}{\\listoverride\\listid102\\listoverridecount0\\ls2}}}";

  it("resolves \\lsN through the override table to the list whose \\listidN it names", () => {
    const { lists } = headerOf(sample);
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(23);
    expect(lists.get(2)?.levels[0]?.numberFormat).toBe(0);
  });

  it("carries a level's own \\levelstartatN", () => {
    expect(headerOf(sample).lists.get(2)?.levels[0]?.startAt).toBe(3);
  });

  it("has nothing for an \\lsN no override declares", () => {
    expect(headerOf(sample).lists.has(9)).toBe(false);
  });

  it("skips a stray text byte between two \\list groups rather than misreading it as the next \\list's own opening brace", () => {
    const lists = headerOf(
      "{\\rtf1{\\*\\listtable" +
        "{\\list\\listtemplateid1\\listsimple{\\listlevel\\levelnfc23\\leveljc0\\levelstartat1{\\leveltext \\'01\\u183 ?;}{\\levelnumbers;}}\\listid201}" +
        " {\\list\\listtemplateid2\\listsimple{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}\\listid202}" +
        "}{\\*\\listoverridetable{\\listoverride\\listid202\\listoverridecount0\\ls1}}}",
    ).lists;
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(0);
  });

  it("does not treat an unrelated group inside \\*\\listtable as if it were a \\list", () => {
    const lists = headerOf(
      "{\\rtf1{\\*\\listtable{\\unknowndest\\listid999}}" +
        "{\\*\\listoverridetable{\\listoverride\\listid999\\listoverridecount0\\ls1}}}",
    ).lists;
    expect(lists.has(1)).toBe(false);
  });

  it("does not read a stray \\levelnfc/\\levelstartat inside a <listlevel>'s own nested {\\leveltext ...} as if it were the level's own", () => {
    const lists = headerOf(
      "{\\rtf1{\\*\\listtable{\\list\\listtemplateid1\\listsimple" +
        "{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext\\levelnfc99\\levelstartat88 \\'02\\'00.;}{\\levelnumbers\\'01;}}" +
        "\\listid302}}{\\*\\listoverridetable{\\listoverride\\listid302\\listoverridecount0\\ls1}}}",
    ).lists;
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(0);
    expect(lists.get(1)?.levels[0]?.startAt).toBe(1);
  });

  it("does not treat an unrelated group inside a \\list as if it were its own \\listlevel", () => {
    const lists = headerOf(
      "{\\rtf1{\\*\\listtable{\\list\\listtemplateid1\\listsimple" +
        "{\\unknowndest\\levelnfc99}" +
        "{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}" +
        "\\listid301}}{\\*\\listoverridetable{\\listoverride\\listid301\\listoverridecount0\\ls1}}}",
    ).lists;
    // Only the real <listlevel> group contributes -- the unrelated group must not become a bogus, wrongly-numbered-23 level 0.
    expect(lists.get(1)?.levels).toHaveLength(1);
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(0);
  });

  it("does not let a control word named something other than \\listidN set the list's own id", () => {
    // \listtemplateid999 carries a numeric param too, but only the exact name \listid may set listId -- placed AFTER the real \listidN so a wrongly-matched value would visibly stick rather than just get overwritten again by coincidence.
    const lists = headerOf(
      "{\\rtf1{\\*\\listtable{\\list\\listid401\\listtemplateid999\\listsimple" +
        "{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}}}" +
        "{\\*\\listoverridetable{\\listoverride\\listid401\\listoverridecount0\\ls1}}}",
    ).lists;
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(0);
  });

  it("does not let a bare \\listid with no digits clobber an already-recorded \\listidN", () => {
    const lists = headerOf(
      "{\\rtf1{\\*\\listtable{\\list\\listid402\\listid\\listsimple" +
        "{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}}}" +
        "{\\*\\listoverridetable{\\listoverride\\listid402\\listoverridecount0\\ls1}}}",
    ).lists;
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(0);
  });

  it("does not let a bare \\levelstartat with no digits clobber an already-recorded \\levelstartatN inside a \\listlevel", () => {
    const lists = headerOf(
      "{\\rtf1{\\*\\listtable{\\list\\listtemplateid1\\listsimple" +
        "{\\listlevel\\levelnfc0\\leveljc0\\levelstartat9\\levelstartat{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}" +
        "\\listid403}}{\\*\\listoverridetable{\\listoverride\\listid403\\listoverridecount0\\ls1}}}",
    ).lists;
    expect(lists.get(1)?.levels[0]?.startAt).toBe(9);
  });
});

// <lfolevel> is `'{' \lfolevel \listoverrideformatN? \listoverridestartat? <listlevel> '}'`, and the spec states exactly which of the two flags puts what where: "If the format flag (\listoverrideformatN) is given, the \lfolevel should also contain a list level (<listlevel>). If the start-at flag (\listoverridestartat) is given, a start-at value must be provided. If the start-at is overridden but the format is not, then a \levelstartatN should be provided in the <lfolevel> itself. If both the start-at and the format are overridden, put the \levelstartatN inside the <listlevel> contained in the <lfolevel>." (RTF 1.9.1, "List Override Table")
describe("list override levels", () => {
  // One arabic list starting at 1, so every override below is visibly a departure from it rather than a restatement.
  const ARABIC_LIST =
    "{\\*\\listtable{\\list\\listtemplateid1\\listsimple" +
    "{\\listlevel\\levelnfc0\\leveljc0\\levelstartat1{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}" +
    "\\listid101}}";

  function listsFor(
    overrideTable: string,
  ): ReturnType<typeof headerOf>["lists"] {
    return headerOf(
      `{\\rtf1${ARABIC_LIST}{\\*\\listoverridetable${overrideTable}}}`,
    ).lists;
  }

  it("applies a start-at-only override from the \\levelstartatN inside the \\lfolevel itself", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount1" +
        "{\\lfolevel\\listoverridestartat\\levelstartat7}\\ls1}",
    );
    expect(lists.get(1)?.levels[0]?.startAt).toBe(7);
    // The format is not overridden, so the list's own \levelnfcN survives.
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(0);
  });

  it("replaces the whole level when \\listoverrideformatN gives a nested <listlevel>", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount1" +
        "{\\lfolevel\\listoverrideformat1" +
        "{\\listlevel\\levelnfc23\\leveljc0\\levelstartat1{\\leveltext \\'01\\u183 ?;}{\\levelnumbers;}}" +
        "}\\ls1}",
    );
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(23);
  });

  it("takes the start-at from inside the nested <listlevel> when both flags are given", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount1" +
        "{\\lfolevel\\listoverrideformat1\\listoverridestartat" +
        "{\\listlevel\\levelnfc0\\leveljc0\\levelstartat42{\\leveltext \\'02\\'00.;}{\\levelnumbers\\'01;}}" +
        "}\\ls1}",
    );
    expect(lists.get(1)?.levels[0]?.startAt).toBe(42);
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(0);
  });

  it("applies each \\lfolevel to the level at its own position, the nine-level shape \\listoverridecount9 states", () => {
    const levels = Array.from(
      { length: 9 },
      (_unused, level) =>
        `{\\lfolevel\\listoverridestartat\\levelstartat${String(level + 1)}}`,
    ).join("");
    const lists = listsFor(
      `{\\listoverride\\listid101\\listoverridecount9${levels}\\ls1}`,
    );
    expect(lists.get(1)?.levels[3]?.startAt).toBe(4);
    // A level the list itself never defined still gains the override's own start-at, so a nine-level override over a \listsimple list is not silently truncated to the one level the list declared.
    expect(lists.get(1)?.levels[8]?.startAt).toBe(9);
  });

  it("leaves the list's own levels alone for \\listoverridecount0, which declares no \\lfolevel at all", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount0\\ls1}",
    );
    expect(lists.get(1)?.levels[0]?.startAt).toBe(1);
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(0);
  });

  it("keeps two overrides of one list independent, since each \\lsN is its own entry", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount1{\\lfolevel\\listoverridestartat\\levelstartat5}\\ls1}" +
        "{\\listoverride\\listid101\\listoverridecount0\\ls2}",
    );
    expect(lists.get(1)?.levels[0]?.startAt).toBe(5);
    expect(lists.get(2)?.levels[0]?.startAt).toBe(1);
  });

  it("skips a stray text byte between two \\listoverride groups rather than misreading it as the next one's own opening brace", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount0\\ls1}" +
        " {\\listoverride\\listid101\\listoverridecount1{\\lfolevel\\listoverridestartat\\levelstartat8}\\ls2}",
    );
    expect(lists.get(2)?.levels[0]?.startAt).toBe(8);
  });

  it("does not treat an unrelated group inside a \\listoverride as if it were its own \\lfolevel", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount1" +
        "{\\unknowndest\\levelstartat77}" +
        "{\\lfolevel\\listoverridestartat\\levelstartat9}\\ls1}",
    );
    expect(lists.get(1)?.levels[0]?.startAt).toBe(9);
  });

  it("does not let a bare \\listid or \\ls with no digits clobber an already-recorded value", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listid\\listoverridecount0\\ls3\\ls}",
    );
    expect(lists.get(3)?.levels[0]?.numberFormat).toBe(0);
  });

  it("does not let a control word named something other than \\listid or \\ls set the override's own id fields", () => {
    // \listoverridecount0 itself carries a numeric param -- placed AFTER the real \ls1 so a wrongly-matched value would visibly stick.
    const lists = listsFor(
      "{\\listoverride\\listid101\\ls1\\listoverridecount0}",
    );
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(0);
  });

  it("does not treat an unrelated group inside a \\lfolevel as if it were its own <listlevel>", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount1" +
        "{\\lfolevel\\listoverrideformat1{\\unknowndest\\levelnfc99}" +
        "{\\listlevel\\levelnfc23\\leveljc0\\levelstartat1{\\leveltext \\'01\\u183 ?;}{\\levelnumbers;}}}\\ls1}",
    );
    expect(lists.get(1)?.levels[0]?.numberFormat).toBe(23);
  });

  it("does not let a bare \\levelstartat with no digits inside a \\lfolevel clobber an already-recorded one", () => {
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount1" +
        "{\\lfolevel\\listoverridestartat\\levelstartat6\\levelstartat}\\ls1}",
    );
    expect(lists.get(1)?.levels[0]?.startAt).toBe(6);
  });

  it("does not let a control word named something other than \\levelstartat set the \\lfolevel's own start-at", () => {
    // \listoverridestartat itself carries no param at all here, and \listoverrideformat1 does -- neither is \levelstartat, so placing one right after the real \levelstartat6 must not overwrite it.
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount1" +
        "{\\lfolevel\\listoverridestartat\\levelstartat6\\listoverrideformat1}\\ls1}",
    );
    expect(lists.get(1)?.levels[0]?.startAt).toBe(6);
  });

  it("prefers the nested <listlevel>'s own start-at over a redundant direct \\levelstartatN when both are given", () => {
    // A malformed producer stating both is exactly the case applyListOverride's own level-replacement precedence exists for: the whole-level replacement must win over the otherwise-independent direct override.
    const lists = listsFor(
      "{\\listoverride\\listid101\\listoverridecount1" +
        "{\\lfolevel\\levelstartat50\\listoverrideformat1" +
        "{\\listlevel\\levelnfc23\\leveljc0\\levelstartat99{\\leveltext \\'01\\u183 ?;}{\\levelnumbers;}}}\\ls1}",
    );
    expect(lists.get(1)?.levels[0]?.startAt).toBe(99);
  });
});

describe("document properties", () => {
  it("reads the document character set keyword and \\ansicpgN override", () => {
    const header = headerOf("{\\rtf1\\mac\\ansicpg10000\\deff0}");
    expect(header.codepage).toBe(10000);
  });

  it("defaults to code page 1252 when the document states no character set at all", () => {
    expect(headerOf("{\\rtf1\\deff0}").codepage).toBe(1252);
  });

  it("takes the code page \\pc names when no \\ansicpgN overrides it", () => {
    expect(headerOf("{\\rtf1\\pc}").codepage).toBe(437);
  });

  it("reads the paper size and margins, in twips", () => {
    // Every one of the six fields gets its own distinct value, so a switch case that silently did nothing (or a case label swapped for a neighbour's) would leave a field at its default rather than merely matching a sibling's value by coincidence.
    const header = headerOf(
      "{\\rtf1\\ansi\\paperw11906\\paperh16838\\margl1001\\margr1002\\margt1003\\margb1004}",
    );
    expect(header.page.paperWidthTwips).toBe(11_906);
    expect(header.page.paperHeightTwips).toBe(16_838);
    expect(header.page.marginLeftTwips).toBe(1001);
    expect(header.page.marginRightTwips).toBe(1002);
    expect(header.page.marginTopTwips).toBe(1003);
    expect(header.page.marginBottomTwips).toBe(1004);
  });

  it("falls back to the spec's own stated defaults when no page geometry is declared", () => {
    const { page } = headerOf("{\\rtf1\\ansi}");
    expect(page.paperWidthTwips).toBe(12_240);
    expect(page.paperHeightTwips).toBe(15_840);
    expect(page.marginLeftTwips).toBe(1800);
  });

  it("reads \\deffN, the default font a run with no \\fN of its own uses", () => {
    expect(headerOf("{\\rtf1\\ansi\\deff2}").defaultFontIndex).toBe(2);
  });

  it("reads the {\\info ...} group's title and author into document metadata", () => {
    const header = headerOf(
      "{\\rtf1\\ansi{\\info{\\title A Document}{\\author John Doe}}}",
    );
    expect(header.metadata.title).toBe("A Document");
    expect(header.metadata.author).toBe("John Doe");
  });

  it("reads the {\\info ...} group's subject, keywords, and operator too", () => {
    const header = headerOf(
      "{\\rtf1\\ansi{\\info{\\subject A Subject}{\\keywords one, two;three}{\\operator Jane Roe}}}",
    );
    expect(header.metadata.subject).toBe("A Subject");
    expect(header.metadata.keywords).toEqual(["one", "two", "three"]);
    expect(header.metadata.creator).toBe("Jane Roe");
  });

  it("drops an empty entry a keywords list's own delimiter run produces", () => {
    const header = headerOf("{\\rtf1\\ansi{\\info{\\keywords one;;two}}}");
    expect(header.metadata.keywords).toEqual(["one", "two"]);
  });

  it("leaves every {\\info ...} field entirely absent when its own value is empty", () => {
    const header = headerOf("{\\rtf1\\ansi{\\info{\\title}}}");
    expect(header.metadata).not.toHaveProperty("title");
  });

  it("does not treat an unrecognized {\\info ...} field as \\operator just for reaching the end of the else-if chain", () => {
    const header = headerOf(
      "{\\rtf1\\ansi{\\info{\\manager Someone Else}{\\operator Jane Roe}}}",
    );
    expect(header.metadata.creator).toBe("Jane Roe");
  });

  it("skips a stray text byte between two {\\info ...} fields rather than misreading it as the next field's own opening brace", () => {
    const header = headerOf(
      "{\\rtf1\\ansi{\\info{\\title A Document} {\\author John Doe}}}",
    );
    expect(header.metadata.author).toBe("John Doe");
  });

  it("does not read a document property from inside a nested destination group, only at the file group's own top level", () => {
    // \paperw999 sits inside a font entry here -- nonsensical RTF, but nothing stops a malformed producer from emitting it, and the document-properties sweep must skip the whole {\fonttbl ...} group rather than linearly scanning through it.
    const header = headerOf(
      "{\\rtf1\\ansi{\\fonttbl{\\f0\\froman\\paperw999 Arial;}}}",
    );
    expect(header.page.paperWidthTwips).toBe(12_240);
  });

  it("skips a stray text byte between two top-level destination groups rather than misreading it as the next one's own opening brace", () => {
    const header = headerOf(
      "{\\rtf1\\ansi{\\fonttbl{\\f0\\froman Arial;}} {\\colortbl;\\red10\\green20\\blue30;}}",
    );
    expect(header.fonts.get(0)?.name).toBe("Arial");
    expect(header.colors[1]).toEqual({ r: 10 / 255, g: 20 / 255, b: 30 / 255 });
  });
});

describe("revision table", () => {
  it("reads each author name, trimmed, in table order", () => {
    // Leading/trailing spaces around "Spacey Author" are genuinely part of the group's own text run (nothing here is a control-word delimiter), so only .trim() removes them.
    const header = headerOf(
      "{\\rtf1{\\*\\revtbl{Unknown;}{ Spacey Author ;}}}",
    );
    expect(header.revisionAuthors).toEqual(["Unknown", "Spacey Author"]);
  });

  it("skips a stray text byte between two revision-author groups rather than misreading it as the next one's own opening brace", () => {
    const header = headerOf("{\\rtf1{\\*\\revtbl{Unknown;} {Second Author;}}}");
    expect(header.revisionAuthors).toEqual(["Unknown", "Second Author"]);
  });
});

describe("bodyStartIndex", () => {
  it("does not advance past a group whose own destination is not one of HEADER_DESTINATIONS", () => {
    const tokens = tokenizeRtf(
      bytes(
        "{\\rtf1\\ansi{\\fonttbl{\\f0\\froman Tms Rmn;}}{\\unknowndest x}Body}",
      ),
    );
    const header = readRtfHeader(tokens, () => {
      /* not asserted here */
    });
    // bodyStartIndex must land exactly on the {\unknowndest x} group's own opening brace -- immediately after \fonttbl's matching close -- rather than being pushed past that whole group too.
    expect(tokens[header.bodyStartIndex]).toEqual({ kind: "groupStart" });
    expect(tokens[header.bodyStartIndex - 1]).toEqual({ kind: "groupEnd" });
  });

  it("does not advance past a group that opens with no destination control word at all", () => {
    const tokens = tokenizeRtf(
      bytes("{\\rtf1\\ansi{\\fonttbl{\\f0\\froman Tms Rmn;}}{plain text}Body}"),
    );
    const header = readRtfHeader(tokens, () => {
      /* not asserted here */
    });
    expect(tokens[header.bodyStartIndex]).toEqual({ kind: "groupStart" });
    expect(tokens[header.bodyStartIndex - 1]).toEqual({ kind: "groupEnd" });
  });
});
