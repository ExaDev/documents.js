import { describe, expect, it } from "vitest";
import { PptFormatError } from "../errors";
import { readRecordAt } from "../record/tree";
import { RT_DocumentAtom, RT_SlideAtom } from "../record/types";
import { concatBytes, u32le, writeAtom as atom } from "../record/write";
import {
  buildMasterStyleTable,
  readSlideAtom,
  resolveCharacterProperties,
  resolveParagraphProperties,
} from "./master";
import type {
  CharacterProperties,
  MasterStyleLevel,
  MasterTextStyleAtom,
  ParagraphProperties,
} from "../text/style";
import {
  TEXT_TYPE_BODY,
  TEXT_TYPE_CENTER_BODY,
  TEXT_TYPE_CENTER_TITLE,
  TEXT_TYPE_HALF_BODY,
  TEXT_TYPE_NOTES,
  TEXT_TYPE_OTHER,
  TEXT_TYPE_QUARTER_BODY,
  TEXT_TYPE_TITLE,
} from "../text/atoms";

function slideAtomBytes(masterIdRef: number, notesIdRef: number) {
  return atom(
    RT_SlideAtom,
    concatBytes(
      u32le(0), // geom
      new Uint8Array(8), // placeholderTypes
      u32le(masterIdRef),
      u32le(notesIdRef),
      u32le(0), // slideFlags/unused
    ),
    { recVer: 0x2 },
  );
}

describe("readSlideAtom", () => {
  it("reads masterIdRef and notesIdRef from their own fixed offsets", () => {
    const bytes = slideAtomBytes(0x80000000, 512);
    const info = readSlideAtom(readRecordAt(bytes, 0));
    expect(info.masterIdRef).toBe(0x80000000);
    expect(info.notesIdRef).toBe(512);
  });

  it("rejects a record that is not RT_SlideAtom", () => {
    const bytes = atom(RT_DocumentAtom, new Uint8Array(0x28));
    expect(() => readSlideAtom(readRecordAt(bytes, 0))).toThrow(PptFormatError);
    expect(() => readSlideAtom(readRecordAt(bytes, 0))).toThrow(
      `expected RT_SlideAtom (0x${RT_SlideAtom.toString(16)}) at offset 0, found record type 0x${RT_DocumentAtom.toString(16)}`,
    );
  });

  it("rejects a SlideAtom too short for its masterIdRef/notesIdRef fields", () => {
    const bytes = atom(RT_SlideAtom, new Uint8Array(19), { recVer: 0x2 });
    expect(() => readSlideAtom(readRecordAt(bytes, 0))).toThrow(PptFormatError);
    expect(() => readSlideAtom(readRecordAt(bytes, 0))).toThrow(
      "SlideAtom at offset 0 carries 19 bytes, too few for its masterIdRef/notesIdRef fields",
    );
  });

  it("accepts a SlideAtom carrying exactly the 20 bytes its notesIdRef field ends at, with none to spare", () => {
    // The boundary itself: notesIdRef occupies bytes [16, 20), so 20 bytes is the minimum valid length, not the minimum rejected one.
    const bytes = atom(
      RT_SlideAtom,
      concatBytes(
        u32le(0), // geom
        new Uint8Array(8), // placeholderTypes
        u32le(0x80000000), // masterIdRef
        u32le(512), // notesIdRef
      ),
      { recVer: 0x2 },
    );
    expect(readSlideAtom(readRecordAt(bytes, 0))).toEqual({
      masterIdRef: 0x80000000,
      notesIdRef: 512,
    });
  });
});

const EMPTY_PARAGRAPH: ParagraphProperties = {
  indentLevel: 0,
  alignment: undefined,
  lineSpacing: undefined,
  spaceBefore: undefined,
  spaceAfter: undefined,
  leftMargin: undefined,
  indent: undefined,
};

const EMPTY_CHARACTER: CharacterProperties = {
  bold: undefined,
  italic: undefined,
  underline: undefined,
  shadow: undefined,
  emboss: undefined,
  fontRef: undefined,
  sizePt: undefined,
  color: undefined,
};

function level(
  character: Partial<CharacterProperties> = {},
  paragraph: Partial<ParagraphProperties> = {},
): MasterStyleLevel {
  return {
    character: { ...EMPTY_CHARACTER, ...character },
    paragraph: { ...EMPTY_PARAGRAPH, ...paragraph },
  };
}

function atomOf(
  textType: number,
  levels: readonly MasterStyleLevel[],
): MasterTextStyleAtom {
  return { textType, levels };
}

describe("buildMasterStyleTable", () => {
  it("keys each atom by its own textType", () => {
    const table = buildMasterStyleTable(
      [atomOf(TEXT_TYPE_TITLE, [level({ bold: true })])],
      undefined,
    );
    expect(table.byType.get(TEXT_TYPE_TITLE)).toEqual([level({ bold: true })]);
    expect(table.byType.get(TEXT_TYPE_BODY)).toBeUndefined();
  });

  it("falls back to the document default for a type the master itself carries no atom for", () => {
    const table = buildMasterStyleTable(
      [atomOf(TEXT_TYPE_TITLE, [level({ bold: true })])],
      atomOf(TEXT_TYPE_OTHER, [level({ italic: true })]),
    );
    expect(table.byType.get(TEXT_TYPE_OTHER)).toEqual([
      level({ italic: true }),
    ]);
  });

  it("lets the master's own atom for a type override the document default for that same type", () => {
    const table = buildMasterStyleTable(
      [atomOf(TEXT_TYPE_OTHER, [level({ bold: true })])],
      atomOf(TEXT_TYPE_OTHER, [level({ italic: true })]),
    );
    expect(table.byType.get(TEXT_TYPE_OTHER)).toEqual([level({ bold: true })]);
  });
});

describe("resolveCharacterProperties", () => {
  it("keeps the run's own stated fields over anything the master states", () => {
    const table = buildMasterStyleTable(
      [atomOf(TEXT_TYPE_TITLE, [level({ bold: true, sizePt: 44 })])],
      undefined,
    );
    const resolved = resolveCharacterProperties(
      { ...EMPTY_CHARACTER, bold: false },
      table,
      TEXT_TYPE_TITLE,
      0,
    );
    expect(resolved.bold).toBe(false);
    expect(resolved.sizePt).toBe(44);
  });

  it("fills a field the run leaves undefined from the master's own matching level", () => {
    const table = buildMasterStyleTable(
      [atomOf(TEXT_TYPE_BODY, [level({ italic: true })])],
      undefined,
    );
    const resolved = resolveCharacterProperties(
      undefined,
      table,
      TEXT_TYPE_BODY,
      0,
    );
    expect(resolved.italic).toBe(true);
  });

  it("walks from the run's own clamped level down to level 0, taking the first level that states the field", () => {
    const table = buildMasterStyleTable(
      [
        atomOf(TEXT_TYPE_BODY, [
          level({ bold: true }), // level 0
          level({}), // level 1 states nothing
          level({ italic: true }), // level 2
        ]),
      ],
      undefined,
    );
    // A run at level 2 with no italic of its own: level 2 states italic, so it wins outright.
    expect(
      resolveCharacterProperties(undefined, table, TEXT_TYPE_BODY, 2).italic,
    ).toBe(true);
    // Bold is not stated at level 2 or level 1, so the walk continues down to level 0.
    expect(
      resolveCharacterProperties(undefined, table, TEXT_TYPE_BODY, 2).bold,
    ).toBe(true);
  });

  it("clamps a run's indent level to the master atom's own cLevels rather than reading past it", () => {
    const table = buildMasterStyleTable(
      [atomOf(TEXT_TYPE_BODY, [level({ bold: true })])], // one level only
      undefined,
    );
    // A run stating level 4 (the deepest [MS-PPT] allows) still resolves against the atom's own single level, not an out-of-bounds one.
    expect(
      resolveCharacterProperties(undefined, table, TEXT_TYPE_BODY, 4).bold,
    ).toBe(true);
  });

  it("never resolves against a level deeper than the run's own indentLevel, even when a deeper level states the field and a shallower one does not", () => {
    const table = buildMasterStyleTable(
      [
        atomOf(TEXT_TYPE_BODY, [
          level({}), // level 0: states nothing
          level({ bold: true }), // level 1: states bold, but out of reach at indentLevel 0
        ]),
      ],
      undefined,
    );
    expect(
      resolveCharacterProperties(undefined, table, TEXT_TYPE_BODY, 0).bold,
    ).toBeUndefined();
  });

  it.each([
    [TEXT_TYPE_CENTER_BODY, TEXT_TYPE_BODY],
    [TEXT_TYPE_HALF_BODY, TEXT_TYPE_BODY],
    [TEXT_TYPE_QUARTER_BODY, TEXT_TYPE_BODY],
    [TEXT_TYPE_CENTER_TITLE, TEXT_TYPE_TITLE],
  ])(
    "falls through from %i to its family's plain type %i when its own type states nothing",
    (variantType, plainType) => {
      const table = buildMasterStyleTable(
        [atomOf(plainType, [level({ bold: true })])],
        undefined,
      );
      expect(
        resolveCharacterProperties(undefined, table, variantType, 0).bold,
      ).toBe(true);
    },
  );

  it("prefers the variant type's own level over the family fallback's", () => {
    const table = buildMasterStyleTable(
      [
        atomOf(TEXT_TYPE_BODY, [level({ bold: false })]),
        atomOf(TEXT_TYPE_CENTER_BODY, [level({ bold: true })]),
      ],
      undefined,
    );
    expect(
      resolveCharacterProperties(undefined, table, TEXT_TYPE_CENTER_BODY, 0)
        .bold,
    ).toBe(true);
  });

  it("leaves a field undefined when neither the run nor any applicable master level states it", () => {
    const table = buildMasterStyleTable([], undefined);
    expect(
      resolveCharacterProperties(undefined, table, TEXT_TYPE_NOTES, 0).bold,
    ).toBeUndefined();
  });

  it("has no further fallback for NOTES or OTHER", () => {
    const table = buildMasterStyleTable(
      [atomOf(TEXT_TYPE_BODY, [level({ bold: true })])],
      undefined,
    );
    expect(
      resolveCharacterProperties(undefined, table, TEXT_TYPE_NOTES, 0).bold,
    ).toBeUndefined();
  });

  it("fills shadow and emboss from the master, distinctly from every other field", () => {
    const table = buildMasterStyleTable(
      [atomOf(TEXT_TYPE_TITLE, [level({ shadow: true, emboss: false })])],
      undefined,
    );
    const resolved = resolveCharacterProperties(
      undefined,
      table,
      TEXT_TYPE_TITLE,
      0,
    );
    expect(resolved.shadow).toBe(true);
    expect(resolved.emboss).toBe(false);
  });

  it("walks a two-level cascade in nearest-to-furthest order, most specific level's own value winning", () => {
    const table = buildMasterStyleTable(
      [
        atomOf(TEXT_TYPE_BODY, [
          level({ sizePt: 10 }), // level 0
          level({ sizePt: 20 }), // level 1
        ]),
      ],
      undefined,
    );
    // A run at level 1 with no size of its own resolves to level 1's own 20, not level 0's 10 -- proving the walk actually reverses to nearest-first rather than reading level 0 first.
    expect(
      resolveCharacterProperties(undefined, table, TEXT_TYPE_BODY, 1).sizePt,
    ).toBe(20);
  });

  it("resolves a scheme-colour reference the same as any other field, leaving the actual RGB lookup to the caller", () => {
    const table = buildMasterStyleTable(
      [
        atomOf(TEXT_TYPE_TITLE, [
          level({ color: { kind: "scheme", schemeIndex: 5 } }),
        ]),
      ],
      undefined,
    );
    expect(
      resolveCharacterProperties(undefined, table, TEXT_TYPE_TITLE, 0).color,
    ).toEqual({ kind: "scheme", schemeIndex: 5 });
  });
});

describe("resolveParagraphProperties", () => {
  it("never resolves indentLevel itself from the master -- it is always the run's own stated (or default) value", () => {
    const table = buildMasterStyleTable(
      [atomOf(TEXT_TYPE_BODY, [level({}, { indentLevel: 3 })])],
      undefined,
    );
    expect(
      resolveParagraphProperties(undefined, table, TEXT_TYPE_BODY, 0)
        .indentLevel,
    ).toBe(0);
  });

  it("fills alignment and spacing fields from the master when the run states none", () => {
    const table = buildMasterStyleTable(
      [
        atomOf(TEXT_TYPE_TITLE, [
          level({}, { alignment: 1, spaceBefore: -80 }),
        ]),
      ],
      undefined,
    );
    const resolved = resolveParagraphProperties(
      undefined,
      table,
      TEXT_TYPE_TITLE,
      0,
    );
    expect(resolved.alignment).toBe(1);
    expect(resolved.spaceBefore).toBe(-80);
  });
});
