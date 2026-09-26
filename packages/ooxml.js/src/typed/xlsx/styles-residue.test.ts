import { describe, expect, it } from "vitest";
import type { ContentCellFill } from "document-schema.js";
import type { Package } from "../../model/package";
import { el } from "../../xml/fragment";
import {
  CellFormatTable,
  GENERAL_NUM_FMT_ID,
  assertNeverContentStrokeStyle,
  assertNeverDeclaredFillKind,
  colorFromElement,
  readCellStyles,
  readColorRgb,
} from "./styles";
function stylesPackage(styleSheet: ReturnType<typeof el>): Package {
  return { parts: { "xl/styles.xml": { kind: "xml", nodes: [styleSheet] } } };
}

// True precisely when `key` is an own property of `obj`, regardless of whether its value is `undefined` — unlike `toBeUndefined()`, which is satisfied identically by a key holding `undefined` and by the key's own absence, and so cannot distinguish "never assigned" from "assigned undefined". Several of this module's own optional-field copies are guarded by a presence check specifically to avoid ever assigning the key at all when the source has nothing to offer, and only a key-existence assertion can prove that guard is doing real work.
function hasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}

describe("readFillBackground: fgColor/bgColor tag names and presence", () => {
  it("falls back to bgColor for a solid fill whose fgColor is absent", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [
            el("patternFill", { patternType: "solid" }, [
              el("bgColor", { rgb: "FF00FF00" }),
            ]),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fillId: "0" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.background).toEqual({
      kind: "solid",
      color: { r: 0, g: 1, b: 0 },
    });
  });

  it("carries only foregroundColor (never a phantom backgroundColor) for a pattern fill with fgColor alone", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [
            el("patternFill", { patternType: "darkGrid" }, [
              el("fgColor", { rgb: "FFFF0000" }),
            ]),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fillId: "0" })]),
      ]),
    );
    const background = readCellStyles(pkg)[0]?.background ?? {};
    expect(hasOwn(background, "foregroundColor")).toBe(true);
    expect(hasOwn(background, "backgroundColor")).toBe(false);
  });

  it("carries only backgroundColor (never a phantom foregroundColor) for a pattern fill with bgColor alone", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("fills", {}, [
          el("fill", {}, [
            el("patternFill", { patternType: "darkGrid" }, [
              el("bgColor", { rgb: "FF0000FF" }),
            ]),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", fillId: "0" })]),
      ]),
    );
    const background = readCellStyles(pkg)[0]?.background ?? {};
    expect(hasOwn(background, "foregroundColor")).toBe(false);
    expect(hasOwn(background, "backgroundColor")).toBe(true);
  });
});

describe('readBorderEdge: style="none" means no border, distinct from an absent style', () => {
  it('reads undefined for an edge whose style is explicitly "none"', () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [
            el("left", { style: "none" }, [el("color", { rgb: "FF000000" })]),
            el("right"),
            el("top"),
            el("bottom"),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.borders).toBeUndefined();
  });
});

describe("readBorders: each edge's own presence is independent", () => {
  it("returns undefined for a <border> whose every edge resolves to no border at all", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [el("left"), el("right"), el("top"), el("bottom")]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    expect(readCellStyles(pkg)[0]?.borders).toBeUndefined();
  });

  it("carries exactly the right edge — none of left/top/bottom — for a border naming only right", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [
            el("left"),
            el("right", { style: "thin" }, [el("color", { rgb: "FF000000" })]),
            el("top"),
            el("bottom"),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    const borders = readCellStyles(pkg)[0]?.borders ?? {};
    expect(hasOwn(borders, "left")).toBe(false);
    expect(hasOwn(borders, "right")).toBe(true);
    expect(hasOwn(borders, "top")).toBe(false);
    expect(hasOwn(borders, "bottom")).toBe(false);
  });

  it("carries exactly the top edge for a border naming only top", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [
            el("left"),
            el("right"),
            el("top", { style: "thin" }, [el("color", { rgb: "FF000000" })]),
            el("bottom"),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    const borders = readCellStyles(pkg)[0]?.borders ?? {};
    expect(hasOwn(borders, "top")).toBe(true);
    expect(hasOwn(borders, "left")).toBe(false);
    expect(hasOwn(borders, "right")).toBe(false);
    expect(hasOwn(borders, "bottom")).toBe(false);
  });

  it("carries exactly the bottom edge for a border naming only bottom", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("borders", {}, [
          el("border", {}, [
            el("left"),
            el("right"),
            el("top"),
            el("bottom", { style: "thin" }, [el("color", { rgb: "FF000000" })]),
          ]),
        ]),
        el("cellXfs", {}, [el("xf", { numFmtId: "0", borderId: "0" })]),
      ]),
    );
    const borders = readCellStyles(pkg)[0]?.borders ?? {};
    expect(hasOwn(borders, "bottom")).toBe(true);
    expect(hasOwn(borders, "left")).toBe(false);
    expect(hasOwn(borders, "right")).toBe(false);
    expect(hasOwn(borders, "top")).toBe(false);
  });
});

describe("readHorizontalAlignment: every recognised member, not just center/right", () => {
  function alignedEntry(horizontal: string) {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0" }, [el("alignment", { horizontal })]),
        ]),
      ]),
    );
    return readCellStyles(pkg)[0];
  }

  it('reads horizontal="left"', () => {
    expect(alignedEntry("left")?.alignment).toBe("left");
  });

  it('reads horizontal="justify"', () => {
    expect(alignedEntry("justify")?.alignment).toBe("justify");
  });
});

describe("readCellStyles: numFmtId/numberFormatCode/alignment key presence", () => {
  it("leaves numberFormatCode absent for a non-integer numFmtId on the xf itself", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [el("xf", { numFmtId: "not-a-number" })]),
      ]),
    );
    expect(hasOwn(readCellStyles(pkg)[0] ?? {}, "numberFormatCode")).toBe(
      false,
    );
  });

  it("leaves numberFormatCode absent for a well-formed numFmtId that resolves to no code at all", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [el("xf", { numFmtId: "200" })]),
      ]),
    );
    expect(hasOwn(readCellStyles(pkg)[0] ?? {}, "numberFormatCode")).toBe(
      false,
    );
  });

  it("leaves alignment absent (not undefined) when the xf's own <alignment> states no recognised horizontal value, but still states verticalAlignment", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0" }, [
            el("alignment", { horizontal: "fill", vertical: "top" }),
          ]),
        ]),
      ]),
    );
    const entry = readCellStyles(pkg)[0] ?? {};
    expect(hasOwn(entry, "alignment")).toBe(false);
    expect(entry.verticalAlignment).toBe("top");
  });

  it("leaves verticalAlignment absent when the xf's own <alignment> states no recognised vertical value, but still states alignment", () => {
    const pkg = stylesPackage(
      el("styleSheet", {}, [
        el("cellXfs", {}, [
          el("xf", { numFmtId: "0" }, [
            el("alignment", { horizontal: "center", vertical: "bottom" }),
          ]),
        ]),
      ]),
    );
    const entry = readCellStyles(pkg)[0] ?? {};
    expect(hasOwn(entry, "verticalAlignment")).toBe(false);
    expect(entry.alignment).toBe("center");
  });
});

describe("CellFormatTable: font signature isolates every one of its own segments", () => {
  // Interns two fonts differing in exactly ONE property and asserts they mint DISTINCT font entries — if a signature segment were ever dropped (a template literal collapsed, a boolean-to-string comparison broken), the two would wrongly collide onto the same fontId instead.
  function internedFontIds(
    fontA: {
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
      strike?: boolean;
      color?: { r: number; g: number; b: number };
      sizePt?: number;
      fontFamily?: string;
    },
    fontB: typeof fontA,
  ): [number, number] {
    const table = new CellFormatTable();
    const a = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: fontA },
    );
    const b = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: fontB },
    );
    return [a, b];
  }

  it("bold alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ bold: true }, { bold: false });
    expect(a).not.toBe(b);
  });

  it("italic alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ italic: true }, { italic: false });
    expect(a).not.toBe(b);
  });

  it("underline alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ underline: true }, { underline: false });
    expect(a).not.toBe(b);
  });

  it("strike alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ strike: true }, { strike: false });
    expect(a).not.toBe(b);
  });

  it("colour alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds(
      { color: { r: 1, g: 0, b: 0 } },
      { color: { r: 0, g: 0, b: 1 } },
    );
    expect(a).not.toBe(b);
  });

  it("size alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds({ sizePt: 11 }, { sizePt: 14 });
    expect(a).not.toBe(b);
  });

  it("fontFamily alone distinguishes two otherwise-identical fonts", () => {
    const [a, b] = internedFontIds(
      { fontFamily: "Arial" },
      { fontFamily: "Courier New" },
    );
    expect(a).not.toBe(b);
  });

  it("declares underline as undefined, not false, for a ContentFont whose own underline is explicitly false", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: { underline: false, bold: true } },
    );
    expect(table.fontDeclarations()[1]?.underline).toBeUndefined();
  });

  it("caches a font interned twice under DIFFERENT number formats to the same fontId, minting only one <fonts> entry", () => {
    const table = new CellFormatTable();
    const first = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { font: { bold: true } },
    );
    const second = table.intern(
      { kind: "builtin", id: 9 },
      { font: { bold: true } },
    );
    expect(table.cellFormatRecords()[first]?.fontId).toBe(
      table.cellFormatRecords()[second]?.fontId,
    );
    // Exactly one real font entry beyond the default: had the font-level cache write been skipped, this second, differently-outer-keyed intern() would have missed the cache and minted a duplicate.
    expect(table.fontDeclarations()).toHaveLength(2);
  });
});

describe("CellFormatTable: fill signature isolates colour, and caches across different outer formats", () => {
  it("two different solid colours mint two distinct fill entries, not one shared by signature collapse", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    table.intern(
      { kind: "builtin", id: 9 },
      { background: { kind: "solid", color: { r: 0, g: 0, b: 1 } } },
    );
    expect(table.fillDeclarations()).toEqual([
      { kind: "none" },
      { kind: "gray125" },
      { kind: "solid", rgb: "ff0000" },
      { kind: "solid", rgb: "0000ff" },
    ]);
  });

  it("two pattern fills differing only in backgroundColor mint two distinct entries", () => {
    const table = new CellFormatTable();
    const shared = {
      kind: "pattern" as const,
      patternType: "darkGrid" as const,
      foregroundColor: { r: 1, g: 0, b: 0 },
    };
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { ...shared, backgroundColor: { r: 0, g: 0, b: 1 } } },
    );
    table.intern(
      { kind: "builtin", id: 9 },
      { background: { ...shared, backgroundColor: { r: 0, g: 1, b: 0 } } },
    );
    // The two mandatory fills every fresh table seeds itself with (none, gray125) plus the two distinct pattern fills interned above.
    const MANDATORY_AND_DISTINCT_FILL_COUNT = 4;
    expect(table.fillDeclarations()).toHaveLength(
      MANDATORY_AND_DISTINCT_FILL_COUNT,
    );
  });

  it("caches a fill interned twice under different number formats to the same fillId, minting only one real <fills> entry", () => {
    const table = new CellFormatTable();
    const first = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    const second = table.intern(
      { kind: "builtin", id: 9 },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    expect(table.cellFormatRecords()[first]?.fillId).toBe(
      table.cellFormatRecords()[second]?.fillId,
    );
    // The two mandatory fills every fresh table seeds itself with (none, gray125) plus the one real solid fill, interned twice but cached to a single entry.
    const MANDATORY_AND_CACHED_FILL_COUNT = 3;
    expect(table.fillDeclarations()).toHaveLength(
      MANDATORY_AND_CACHED_FILL_COUNT,
    );
  });
});

describe("CellFormatTable: border signature and caching across different outer formats", () => {
  it("caches a border interned twice under different number formats to the same borderId, minting only one real <borders> entry", () => {
    const table = new CellFormatTable();
    const border = { left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 } };
    const first = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { borders: border },
    );
    const second = table.intern(
      { kind: "builtin", id: 9 },
      { borders: border },
    );
    expect(table.cellFormatRecords()[first]?.borderId).toBe(
      table.cellFormatRecords()[second]?.borderId,
    );
    expect(table.borderDeclarations()).toHaveLength(2);
  });

  it("writes a double-style border as the double token verbatim, ignoring widthPt entirely", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        borders: {
          left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75, style: "double" },
        },
      },
    );
    expect(table.borderDeclarations()[1]).toEqual({
      edges: { left: { style: "double", rgb: "000000" } },
    });
  });

  it("writes a dotted-style border as the dotted token verbatim, ignoring widthPt entirely", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        borders: {
          left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75, style: "dotted" },
        },
      },
    );
    expect(table.borderDeclarations()[1]).toEqual({
      edges: { left: { style: "dotted", rgb: "000000" } },
    });
  });

  it("writes a dashed border at thin weight as plain dashed, not mediumDashed — the medium check is not a no-op", () => {
    const table = new CellFormatTable();
    table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        borders: {
          left: {
            color: { r: 0, g: 0, b: 0 },
            widthPt: 0.75,
            style: "dashed",
          },
        },
      },
    );
    expect(table.borderDeclarations()[1]).toEqual({
      edges: { left: { style: "dashed", rgb: "000000" } },
    });
  });

  it("dedupes a whole cellXfs entry across an implicit-vs-explicit-'solid' border, at the outer decoration-signature level", () => {
    // Deliberately the SAME number format on both calls, so the outer cellFormat-level cache (signatureOfDecoration, not internBorder's own separate borderIndexBySignature) is what is actually exercised here: a second intern() with a different numFmtId would call internBorder again regardless of the outer signature, proving nothing about this specific "?? 'solid'" fallback.
    const table = new CellFormatTable();
    const implicit = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { borders: { left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 } } },
    );
    const explicit = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        borders: {
          left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75, style: "solid" },
        },
      },
    );
    expect(explicit).toBe(implicit);
    expect(table.cellFormatRecords()).toHaveLength(2);
  });

  it("two genuinely different real borders mint two distinct entries, not one shared by an edge-segment collapse", () => {
    // Deliberately two REAL, non-empty borders (not an empty-vs-real pair): an empty `{}` decoration hits the outer cellFormat-level default seed before internBorder is ever called at all (its own signature already coincides with EMPTY_DECORATION's), so it can never exercise internBorder's own per-edge signature segment either way. Two distinct real borders, by contrast, both genuinely reach internBorder, so only a real per-edge signature can tell them apart.
    const table = new CellFormatTable();
    const thin = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { borders: { left: { color: { r: 0, g: 0, b: 0 }, widthPt: 0.75 } } },
    );
    const thick = table.intern(
      { kind: "builtin", id: 9 },
      { borders: { left: { color: { r: 1, g: 0, b: 0 }, widthPt: 1.5 } } },
    );
    expect(table.cellFormatRecords()[thin]?.borderId).not.toBe(
      table.cellFormatRecords()[thick]?.borderId,
    );
    // The one mandatory empty-border entry every fresh table seeds itself with, plus the two genuinely distinct real borders interned above.
    const MANDATORY_AND_DISTINCT_BORDER_COUNT = 3;
    expect(table.borderDeclarations()).toHaveLength(
      MANDATORY_AND_DISTINCT_BORDER_COUNT,
    );
  });
});

describe("CellFormatTable: internFill's own default branch for a wholly unrecognised fill kind", () => {
  it("throws naming the unrecognised kind, for a fill this discriminated union genuinely has no member for", () => {
    const table = new CellFormatTable();
    const bogus = { kind: "gradient" } as unknown as ContentCellFill;
    expect(() =>
      table.intern(
        { kind: "builtin", id: GENERAL_NUM_FMT_ID },
        { background: bogus },
      ),
    ).toThrow(/gradient/);
  });
});

describe("CellFormatTable: intern's own alignment-presence OR, not AND", () => {
  it("still creates a record.alignment when only horizontal is given, with no vertical at all", () => {
    const table = new CellFormatTable();
    const index = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { alignment: "center" },
    );
    expect(table.cellFormatRecords()[index]?.alignment).toEqual({
      horizontal: "center",
      vertical: undefined,
    });
  });

  it("still creates a record.alignment when only vertical is given, with no horizontal at all", () => {
    const table = new CellFormatTable();
    const index = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { verticalAlignment: "middle" },
    );
    expect(table.cellFormatRecords()[index]?.alignment).toEqual({
      horizontal: undefined,
      vertical: "middle",
    });
  });

  it("a decoration with only alignment set does not collide with one that also sets a fill", () => {
    const table = new CellFormatTable();
    const alignedOnly = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { alignment: "left" },
    );
    const alignedAndFilled = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        alignment: "left",
        background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      },
    );
    expect(alignedOnly).not.toBe(alignedAndFilled);
  });

  it("a decoration with alignment set does not collide with an otherwise-identical one with no alignment at all", () => {
    const table = new CellFormatTable();
    const noAlignment = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    const withAlignment = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        alignment: "left",
        background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      },
    );
    expect(noAlignment).not.toBe(withAlignment);
  });

  it("a decoration with verticalAlignment set does not collide with an otherwise-identical one with no verticalAlignment at all", () => {
    const table = new CellFormatTable();
    const noVertical = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      { background: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    );
    const withVertical = table.intern(
      { kind: "builtin", id: GENERAL_NUM_FMT_ID },
      {
        verticalAlignment: "top",
        background: { kind: "solid", color: { r: 1, g: 0, b: 0 } },
      },
    );
    expect(noVertical).not.toBe(withVertical);
  });
});

describe("assertNeverContentStrokeStyle", () => {
  it("throws naming the unhandled style, proving borderToXlsxStyle's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverContentStrokeStyle("bogus" as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'borderToXlsxStyle: unhandled ContentBorder style "bogus"',
    );
  });
});

describe("assertNeverDeclaredFillKind", () => {
  it("throws naming the unhandled kind, proving buildStylesPart's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverDeclaredFillKind({ kind: "bogus" } as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'buildStylesPart: unhandled DeclaredFill kind {"kind":"bogus"}',
    );
  });
});

describe("colorFromElement/readColorRgb: hex length boundary and validation", () => {
  it("returns undefined — not a garbage colour — for a 6-character rgb that is not valid hex", () => {
    expect(colorFromElement(el("color", { rgb: "ZZZZZZ" }))).toBeUndefined();
  });

  it("returns undefined for an rgb attribute shorter than 6 characters", () => {
    expect(colorFromElement(el("color", { rgb: "FF00" }))).toBeUndefined();
  });

  it("resolves an 8-digit AARRGGBB rgb by its last 6 (real) digits, dropping the alpha prefix", () => {
    const RGB_BYTE_MAX = 255;
    // The r/g/b bytes of the fixture's own "80112233" rgb attribute (alpha 80, then 11/22/33).
    const FIXTURE_RED_BYTE = 0x11;
    const FIXTURE_GREEN_BYTE = 0x22;
    const FIXTURE_BLUE_BYTE = 0x33;
    expect(
      readColorRgb(el("x", {}, [el("color", { rgb: "80112233" })]), "color"),
    ).toEqual({
      r: FIXTURE_RED_BYTE / RGB_BYTE_MAX,
      g: FIXTURE_GREEN_BYTE / RGB_BYTE_MAX,
      b: FIXTURE_BLUE_BYTE / RGB_BYTE_MAX,
    });
  });

  it("returns undefined when the element carries no rgb attribute at all", () => {
    expect(
      readColorRgb(el("x", {}, [el("color", {})]), "color"),
    ).toBeUndefined();
  });

  // The regex's own "^"/"$" anchors are a genuinely irreducible equivalent mutation opportunity here, not merely an untested one: `hex` is constructed immediately above as either exactly 6 characters (raw.slice(-6), whenever raw.length >= 6) or fewer than 6 (raw itself, otherwise) — never more. A {6}-quantified pattern can only ever match a 6-character string across its ENTIRE length regardless of anchors (there is no room for a partial match either before or after), and can never match a shorter one at all, so no input this function can ever construct `hex` from can tell an anchored and an unanchored match apart. The same reasoning makes the raw.length ">= 6" vs "> 6" boundary equivalent too: at raw.length exactly 6, slice(-6) returns the whole (unchanged) string, identical to what the ">" branch's bare `raw` would have returned directly.
});
