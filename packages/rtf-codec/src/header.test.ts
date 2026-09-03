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

  it("skips a character style, which the spec requires be written as {\\*\\csN ...}", () => {
    const { styles } = headerOf(
      "{\\rtf1{\\stylesheet{\\s0 Normal;}{\\*\\cs10\\additive Default Paragraph Font;}}}",
    );
    expect(styles.get(0)?.name).toBe("Normal");
    expect(styles.has(10)).toBe(false);
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
    const header = headerOf(
      "{\\rtf1\\ansi\\paperw11906\\paperh16838\\margl1134\\margr1134\\margt1417\\margb1417}",
    );
    expect(header.page.paperWidthTwips).toBe(11_906);
    expect(header.page.marginTopTwips).toBe(1417);
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
});
