import type { ContentBorder } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { readGrpprl } from "../prop/sprm";
import {
  BRC80_SIZE,
  BRC_SIZE,
  SHD_SIZE,
  readBrc,
  readBrc80,
  readShd,
  readShd80,
  writeBrc,
  writeBrc80,
  writeShd,
} from "./decoration";
import { applyTableSprms } from "./tap";
import { encodeTableRowGrpprl, type TableCellToWrite } from "./tap-write";

// The border/shading vocabulary on its own, at the level table/tap.ts and table/tap-write.ts actually exchange it. write.test.ts's own round trips cover what a whole document does with a cell's decoration; this file covers the encodings a real third-party producer may state that this package's own writer never emits -- every BrcType outside the four it writes, both no-border spellings, the Word 97-era Shd80 array, the ipatSolid pattern, and the automatic colours -- since a reader-only path has no round trip to be verified by.

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };

function bytes(values: readonly number[]): Uint8Array {
  return Uint8Array.from(values);
}

describe("Brc80", () => {
  it("reads the all-bits-set Brc80MayBeNil sentinel as no border", () => {
    expect(readBrc80(bytes([0xff, 0xff, 0xff, 0xff]), 0)).toBeUndefined();
  });

  it("reads an all-zero Brc80 as no border, the brcType 0x00 spelling a real producer writes", () => {
    // LibreOffice 26.2.5.2 writes this rather than the 0xFFFFFFFF sentinel for an undecorated cell; both mean "no border" and both have to read as one.
    expect(readBrc80(bytes([0x00, 0x00, 0x00, 0x00]), 0)).toBeUndefined();
  });

  it("reads dptLineWidth as 1/8-point increments and ico through the fixed palette", () => {
    // The exact bytes LibreOffice wrote for a 0.5pt solid #ff0000 top border.
    expect(readBrc80(bytes([0x04, 0x01, 0x06, 0x00]), 0)).toEqual({
      color: RED,
      widthPt: 0.5,
    });
  });

  it("applies [MS-DOC]'s own floor of 2 to a dptLineWidth below it", () => {
    // "Values of less than 2 are considered to be equivalent to 2" -- and a widthPt of 0 would fail ContentBorderSchema's own positive() bound anyway.
    expect(readBrc80(bytes([0x00, 0x01, 0x01, 0x00]), 0)?.widthPt).toBe(0.25);
    expect(readBrc80(bytes([0x01, 0x01, 0x01, 0x00]), 0)?.widthPt).toBe(0.25);
  });

  it("resolves an automatic border colour to black rather than dropping the border", () => {
    // Ico 0x00 is cvAuto and names no components, but ContentBorder.color is required and the border genuinely renders.
    expect(readBrc80(bytes([0x08, 0x01, 0x00, 0x00]), 0)).toEqual({
      color: BLACK,
      widthPt: 1,
    });
  });

  it("ignores dptSpace, fShadow and fFrame, which ContentBorder cannot express", () => {
    const withFlags = readBrc80(bytes([0x08, 0x01, 0x01, 0xff]), 0);
    const withoutFlags = readBrc80(bytes([0x08, 0x01, 0x01, 0x00]), 0);
    expect(withFlags).toEqual(withoutFlags);
  });

  it.each([
    [0x01, undefined], // single
    [0x05, undefined], // a thin single solid line
    [0x14, undefined], // wave -- one continuous stroke
    [0x03, "double"],
    [0x0a, "double"], // triple
    [0x0b, "double"], // thinThickSmallGap
    [0x13, "double"], // thinThickThinLargeGap
    [0x15, "double"], // doubleWave
    [0x18, "double"], // threeDEmboss
    [0x1b, "double"], // inset
    [0x06, "dotted"],
    [0x07, "dashed"],
    [0x08, "dashed"], // dotDash
    [0x09, "dashed"], // dotDotDash
    [0x16, "dashed"], // dashSmallGap
    [0x17, "dashed"], // dashDotStroked
  ])(
    "maps brcType 0x%s onto the ContentStrokeStyle member it collapses to",
    (brcType, style) => {
      expect(readBrc80(bytes([0x08, brcType, 0x01, 0x00]), 0)?.style).toBe(
        style,
      );
    },
  );

  it("reads an art/image border as no border, since [MS-DOC] permits one only on a page", () => {
    // "Values that are larger than 0x1B are not valid unless they describe a page border" -- 0x40 is `apples`.
    expect(readBrc80(bytes([0x08, 0x40, 0x01, 0x00]), 0)).toBeUndefined();
    // 0xFF: "This MUST be ignored."
    expect(readBrc80(bytes([0x08, 0xff, 0x01, 0x00]), 0)).toBeUndefined();
  });

  it("writes an absent border as the Brc80MayBeNil sentinel", () => {
    expect(writeBrc80(undefined)).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it("writes a border into the four bytes readBrc80 reads back", () => {
    const border: ContentBorder = { color: RED, widthPt: 0.5 };
    const written = writeBrc80(border);
    expect(written).toHaveLength(BRC80_SIZE);
    expect(readBrc80(bytes(written), 0)).toEqual(border);
  });

  it("snaps a colour outside the palette to the nearest entry it does have", () => {
    // #f00505 is not a palette colour; Ico 0x06 (pure red) is its nearest, which is what a Brc80 alone can say.
    const written = writeBrc80({
      color: { r: 0xf0 / 255, g: 0x05 / 255, b: 0x05 / 255 },
      widthPt: 1,
    });
    expect(readBrc80(bytes(written), 0)?.color).toEqual(RED);
  });
});

describe("Brc", () => {
  it("reads a NilBrc -- the last four bytes all set -- as no border", () => {
    expect(
      readBrc(bytes([0x11, 0x22, 0x33, 0x00, 0xff, 0xff, 0xff, 0xff]), 0),
    ).toBeUndefined();
  });

  it("reads the exact COLORREF, unlike Brc80's palette index", () => {
    // The exact bytes LibreOffice wrote alongside the Brc80 above, for the same 0.5pt solid #ff0000 border.
    expect(
      readBrc(bytes([0xff, 0x00, 0x00, 0x00, 0x04, 0x01, 0x00, 0x00]), 0),
    ).toEqual({ color: RED, widthPt: 0.5 });
  });

  it("resolves a cvAuto colour to black, matching Brc80's own automatic handling", () => {
    expect(
      readBrc(bytes([0x00, 0x00, 0x00, 0xff, 0x08, 0x01, 0x00, 0x00]), 0)
        ?.color,
    ).toEqual(BLACK);
  });

  it("writes a border into the eight bytes readBrc reads back, colour intact", () => {
    const border: ContentBorder = {
      color: { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255 },
      widthPt: 1.25,
      style: "dashed",
    };
    const written = writeBrc(border);
    expect(written).toHaveLength(BRC_SIZE);
    expect(readBrc(bytes(written), 0)).toEqual(border);
  });
});

describe("Shd", () => {
  it("reads ipatAuto's own cvBack as the cell's background", () => {
    // The exact bytes LibreOffice wrote for a #ffff00 cell fill.
    const shd = [0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00];
    expect(readShd(bytes(shd), 0)).toEqual({ r: 1, g: 1, b: 0 });
  });

  it("reads ipatSolid's own cvFore as the cell's background", () => {
    const shd = [0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0xff, 0x01, 0x00];
    expect(readShd(bytes(shd), 0)).toEqual({ r: 0, g: 0, b: 1 });
  });

  it("reads ShdAuto -- both colours automatic under ipatAuto -- as no background", () => {
    const shdAuto = [
      0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00,
    ];
    expect(readShd(bytes(shdAuto), 0)).toBeUndefined();
  });

  it("reads a genuine pattern as no background rather than as one of its two colours", () => {
    // ipatPct50 (0x0008): a 50% fill of cvFore over cvBack, which one flat Color cannot represent -- the same judgment xls-codec makes for BIFF8's non-solid FillPattern values.
    const pct50 = [0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x08, 0x00];
    expect(readShd(bytes(pct50), 0)).toBeUndefined();
    // ipatNil (0xFFFF), ST_Shd nil.
    const nil = [0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0xff, 0xff];
    expect(readShd(bytes(nil), 0)).toBeUndefined();
  });

  it("writes a background into the ten bytes readShd reads back", () => {
    const background = { r: 0x4c / 255, g: 0x7f / 255, b: 0xbf / 255 };
    const written = writeShd(background);
    expect(written).toHaveLength(SHD_SIZE);
    expect(readShd(bytes(written), 0)).toEqual(background);
  });

  it("writes an absent background as ShdAuto, which reads back as absent", () => {
    expect(readShd(bytes(writeShd(undefined)), 0)).toBeUndefined();
  });
});

describe("Shd80", () => {
  it("reads icoBack under ipatAuto as the background", () => {
    // The exact word LibreOffice wrote in its legacy sprmTDefTableShd80 array beside the #ffff00 Shd above: icoBack 0x07 (yellow).
    expect(readShd80(0x00e0)).toEqual({ r: 1, g: 1, b: 0 });
    // The third cell of the same array: icoBack 0x03 (cyan).
    expect(readShd80(0x0060)).toEqual({ r: 0, g: 1, b: 1 });
  });

  it("reads an all-automatic Shd80 as no background", () => {
    expect(readShd80(0x0000)).toBeUndefined();
  });

  it("reads Shd80Nil -- every bit set -- as no background", () => {
    expect(readShd80(0xffff)).toBeUndefined();
  });
});

// The row-level grpprl both directions actually exchange: encodeTableRowGrpprl's own bytes, walked back through the same readGrpprl/applyTableSprms chain a real file's row mark goes through. This is the only place the three DefTableShdOperand arrays can be exercised past the first one, since a row wide enough to reach the second (23 cells) already exceeds the 510-byte PapxInFkp ceiling a whole-document write has to fit inside (see prop/fkp-write.ts and the README's own note on the bound).
describe("encodeTableRowGrpprl", () => {
  function roundTripRow(cells: readonly TableCellToWrite[]) {
    const boundaries = cells.map((_unused, index) => index * 100);
    boundaries.push(cells.length * 100);
    const grpprl = encodeTableRowGrpprl(boundaries, cells, undefined);
    const properties = applyTableSprms(readGrpprl(Uint8Array.from(grpprl)), {});
    const definition = properties.definition;
    if (definition === undefined) throw new Error("expected a row definition");
    return definition.cells;
  }

  it("round-trips a background stated past the first 22-cell shading array", () => {
    const cells: TableCellToWrite[] = Array.from(
      { length: 25 },
      (_unused, index): TableCellToWrite =>
        index === 24
          ? { vertMerge: 0, background: { r: 1, g: 0, b: 1 } }
          : { vertMerge: 0 },
    );
    const read = roundTripRow(cells);
    expect(read[24]?.background).toEqual({ r: 1, g: 0, b: 1 });
    expect(read[0]?.background).toBeUndefined();
  });

  it("round-trips a background in each of the three shading arrays at once", () => {
    const shaded = new Map([
      [0, { r: 1, g: 0, b: 0 }],
      [30, { r: 0, g: 1, b: 0 }],
      [50, { r: 0, g: 0, b: 1 }],
    ]);
    const cells: TableCellToWrite[] = Array.from(
      { length: 60 },
      (_unused, index): TableCellToWrite => {
        const background = shaded.get(index);
        return background === undefined
          ? { vertMerge: 0 }
          : { vertMerge: 0, background };
      },
    );
    const read = roundTripRow(cells);
    for (const [index, background] of shaded) {
      expect(read[index]?.background).toEqual(background);
    }
    expect(read[1]?.background).toBeUndefined();
    expect(read[31]?.background).toBeUndefined();
  });

  it("keeps a cell's vertical-merge state alongside its decoration", () => {
    const read = roundTripRow([
      { vertMerge: 3, background: { r: 1, g: 1, b: 0 } },
      { vertMerge: 1 },
    ]);
    expect(read[0]?.vertMerge).toBe(3);
    expect(read[0]?.background).toEqual({ r: 1, g: 1, b: 0 });
    expect(read[1]?.vertMerge).toBe(1);
    expect(read[1]?.background).toBeUndefined();
  });

  it("emits byte-for-byte the same grpprl for an undecorated row as it did before decoration was written at all", () => {
    // The bytes are spelled out rather than compared against a recorded fixture, so they can be checked against [MS-DOC] 2.9.321's own TDefTableOperand field table by hand: sprmTDefTable (0xD608), cb (the 47-byte remainder plus 1), NumberOfColumns, three rgdxaCenter XAS values, then two TC80s of tcgrf/wWidth zero followed by four Brc80MayBeNil no-border sentinels each.
    //
    // This is what makes the decoration work safe for every table that carries none: no shading array, no sprmTSetBrc, and TC80's own border fields still the all-bits-set sentinel this writer always wrote there. An undecorated table's file is unchanged, so the third-party table-recognition results ExaDev/documents.js#892 and #895 established still stand on the identical bytes they were established on.
    const tc80 = [
      0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    ];
    expect(
      encodeTableRowGrpprl(
        [0, 100, 200],
        [{ vertMerge: 0 }, { vertMerge: 0 }],
        undefined,
      ),
    ).toEqual([
      0x08,
      0xd6,
      0x30,
      0x00,
      0x02,
      0x00,
      0x00,
      0x64,
      0x00,
      0xc8,
      0x00,
      ...tc80,
      ...tc80,
    ]);
  });

  it("groups a cell's four identical exact-colour borders into one sprmTSetBrc rather than four", () => {
    const border: ContentBorder = {
      color: { r: 0x33 / 255, g: 0x66 / 255, b: 0x99 / 255 },
      widthPt: 1,
    };
    const grpprl = encodeTableRowGrpprl(
      [0, 100],
      [
        {
          vertMerge: 0,
          borders: {
            top: border,
            left: border,
            bottom: border,
            right: border,
          },
        },
      ],
      undefined,
    );
    const setBrc = readGrpprl(Uint8Array.from(grpprl)).filter(
      (prl) => prl.sprm.value === 0xd62f,
    );
    expect(setBrc).toHaveLength(1);
    // bordersToApply, the operand's fourth byte: top | left | bottom | right.
    expect(setBrc[0]?.operand[3]).toBe(0x0f);
  });
});
