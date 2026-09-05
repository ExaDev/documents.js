import type { ContentBorder } from "document-schema.js";
import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { readGrpprl } from "../prop/sprm";
import {
  BRC80_SIZE,
  BRC_SIZE,
  SHD_SIZE,
  readBrc,
  readBrc80,
  readShd,
  readShd80,
  readTableBordersOperand,
  readTableBordersOperand80,
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

  it("resolves an ico past the palette's own 0x11 bound to the automatic colour, rather than aborting the whole document read", () => {
    // ico is a full byte, so a malformed or third-party-extended file can state a value the 17-entry palette has no entry for. A run's own sprmCIco has to throw for exactly this -- a colour that is not automatic and has nowhere else to be recovered from -- but a cell border is decorative and already has an automatic-colour fallback of its own (the case above), so one out-of-range byte in one cell must not fail the entire read the way DocFormatError otherwise would.
    expect(readBrc80(bytes([0x08, 0x01, 0x11, 0x00]), 0)).toEqual({
      color: BLACK,
      widthPt: 1,
    });
    expect(readBrc80(bytes([0x08, 0x01, 0xff, 0x00]), 0)).toEqual({
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

  it("states the true rounding-aware floor, 0.1875pt, in a single-line border's own refusal message, not the naive 0.25pt a stored minimum converts back to on read", () => {
    expect(() => writeBrc80({ color: RED, widthPt: 0.1 })).toThrow(
      /outside the 0\.1875\.\.31\.9375pt range/,
    );
    expect(() => writeBrc80({ color: RED, widthPt: 0.1 })).toThrow(
      DocFormatError,
    );
  });

  it("accepts a single-line width the naive 0.25pt floor would have wrongly refused, since Math.round rounds it up to a storable 2 eighths", () => {
    expect(writeBrc80({ color: RED, widthPt: 0.2 })[0]).toBe(2);
  });

  it("accepts a single-line width above the naive 31.875pt ceiling the pre-fix refusal message wrongly implied, since Math.round rounds it down to a storable 255 eighths", () => {
    expect(writeBrc80({ color: RED, widthPt: 31.9 })[0]).toBe(255);
  });

  it("states the true rounding-aware ceiling, 31.9375pt, in a single-line border's own refusal message, not the naive 31.875pt a stored maximum converts back to on read", () => {
    expect(() => writeBrc80({ color: RED, widthPt: 31.9375 })).toThrow(
      /outside the 0\.1875\.\.31\.9375pt range/,
    );
  });

  it("snaps a colour outside the palette to the nearest entry it does have", () => {
    // #f00505 is not a palette colour; Ico 0x06 (pure red) is its nearest, which is what a Brc80 alone can say.
    const written = writeBrc80({
      color: { r: 0xf0 / 255, g: 0x05 / 255, b: 0x05 / 255 },
      widthPt: 1,
    });
    expect(readBrc80(bytes(written), 0)?.color).toEqual(RED);
  });

  describe("double-line border width", () => {
    it("triples dptLineWidth into widthPt for BrcType 0x03, since the field states one of the border's two lines rather than its total rendered width", () => {
      // The exact dptLineWidth a genuine LibreOffice-authored double border was found to carry: read directly as the field's own value, this used to report 0.625pt where LibreOffice's own re-export calls the identical border ~1.8pt double (5 eighths tripled is 1.875pt, matching to LibreOffice's own twip-rounding).
      expect(readBrc80(bytes([0x05, 0x03, 0x00, 0x00]), 0)?.widthPt).toBe(
        1.875,
      );
    });

    it("applies the dptLineWidth floor before tripling, not after", () => {
      // "Values of less than 2 are considered to be equivalent to 2" floors the field itself to 2 eighths, which then triples to 6 eighths (0.75pt) -- not 3 eighths (0.375pt), which tripling the raw sub-floor value of 1 would give.
      expect(readBrc80(bytes([0x01, 0x03, 0x00, 0x00]), 0)?.widthPt).toBe(0.75);
    });

    it("leaves a single-line border's width unmultiplied", () => {
      expect(readBrc80(bytes([0x10, 0x01, 0x00, 0x00]), 0)?.widthPt).toBe(2);
      expect(writeBrc80({ color: RED, widthPt: 2 })[0]).toBe(0x10);
    });

    it("writes a double border's total widthPt as one third of it, the inverse of the read-side tripling", () => {
      // The pre-fix writer stated dptLineWidth as widthPt directly (16 for 2pt), which is exactly what a real LibreOffice reader tripled back into the 6pt double the issue reported; dividing by three first states the same 2pt intent as dptLineWidth 5.
      expect(writeBrc80({ color: RED, widthPt: 2, style: "double" })[0]).toBe(
        5,
      );
    });

    it("refuses a double border below the true 0.1875pt floor, stating that number rather than the naive 0.375pt a stored minimum converts back to on read", () => {
      expect(() =>
        writeBrc80({ color: RED, widthPt: 0.1, style: "double" }),
      ).toThrow(/outside the 0\.1875\.\.95\.8125pt range/);
    });

    it("accepts a double-line width above the naive 95.625pt ceiling the pre-fix refusal message wrongly implied, since Math.round rounds it down to a storable 255 eighths", () => {
      expect(
        writeBrc80({ color: RED, widthPt: 95.8, style: "double" })[0],
      ).toBe(255);
    });

    it("states the true rounding-aware ceiling, 95.8125pt, in a double border's own refusal message, not the naive 95.625pt a stored maximum converts back to on read", () => {
      expect(() =>
        writeBrc80({ color: RED, widthPt: 95.8125, style: "double" }),
      ).toThrow(/outside the 0\.1875\.\.95\.8125pt range/);
    });

    it("writes an ordinary sub-0.75pt double border width, like Word's own 0.5pt UI default, without refusing it", () => {
      // 0.5pt total divided by three and rounded to the nearest eighth is 1 -- below MIN_DPT_LINE_WIDTH's general floor of 2, but not below MIN_DPT_LINE_WIDTH_DOUBLE's own floor of 1, which is what a real producer's own writer floors this same field to rather than ever refusing to state a thin double border at all.
      expect(writeBrc80({ color: RED, widthPt: 0.5, style: "double" })[0]).toBe(
        1,
      );
      expect(writeBrc({ color: RED, widthPt: 0.5, style: "double" })[4]).toBe(
        1,
      );
    });

    it("does not round-trip a 0.5pt double border exactly -- the written dptLineWidth of 1 is below the read-side floor of 2, so it comes back 50% wider than requested", () => {
      // A real, [MS-DOC]-consistent narrowing, not a regression: MIN_DPT_LINE_WIDTH_DOUBLE (1) is lower than MIN_DPT_LINE_WIDTH (2) purely so the writer can state a thin double border at all, but the reader applies MIN_DPT_LINE_WIDTH's own floor to every dptLineWidth regardless of brcType, per [MS-DOC]'s "values less than 2 are considered to be equivalent to 2" -- so the stored 1 reads back as 2, tripled to 0.75pt, not the 0.5pt it was written with.
      const border: ContentBorder = {
        color: RED,
        widthPt: 0.5,
        style: "double",
      };
      const written = writeBrc80(border);
      expect(written[0]).toBe(1);
      expect(readBrc80(bytes(written), 0)?.widthPt).toBe(0.75);
    });

    it("writes and reads back a double border's own total width exactly, for a width the tripled field can state precisely", () => {
      const border: ContentBorder = {
        color: RED,
        widthPt: 1.875,
        style: "double",
      };
      const written = writeBrc80(border);
      expect(written[0]).toBe(5);
      expect(readBrc80(bytes(written), 0)).toEqual(border);
    });

    it("triples on the Brc's own exact-colour encoding too, not just Brc80's palette one", () => {
      const border: ContentBorder = {
        color: RED,
        widthPt: 1.875,
        style: "double",
      };
      const written = writeBrc(border);
      expect(written[4]).toBe(5);
      expect(readBrc(bytes(written), 0)).toEqual(border);
    });

    it("does not round-trip a non-literal collapsed BrcType's own width, since BRC_TYPE_STYLE has already discarded which of the 24 families a 'double'-style border came from by the time it is written back", () => {
      // 0x0e (thinThickMediumGap) is one of the 23 BrcTypes BRC_TYPE_STYLE folds onto 'double' without the literal-0x03 tripling: reading it back reports dptLineWidth's own untripled value directly (16 eighths, 2pt), an approximation of unknown accuracy per DOUBLE_BORDER_WIDTH_MULTIPLIER's own note on the ratios LibreOffice's source actually gives that family. Writing that same ContentBorder back has no way to recover 0x0e -- ContentStrokeStyle names only one 'double' member -- so it re-emits a literal 0x03 and applies this package's own tripling to the 2pt it was given, producing dptLineWidth 5 rather than the original 16: a further, compounding approximation on an already-lossy round trip, not a fresh regression from this file's own read/write pair agreeing with each other.
      const read = readBrc80(bytes([0x10, 0x0e, 0x06, 0x00]), 0);
      expect(read).toEqual({ color: RED, widthPt: 2, style: "double" });
      if (read === undefined) throw new Error("expected a border");
      expect(writeBrc80(read)[0]).toBe(5);
    });
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

describe("TableBordersOperand", () => {
  const GREEN: ContentBorder = { color: { r: 0, g: 1, b: 0 }, widthPt: 1 };
  const BLUE: ContentBorder = {
    color: { r: 0, g: 0, b: 1 },
    widthPt: 0.75,
    style: "dashed",
  };
  const nilBrc = new Array<number>(BRC_SIZE).fill(0xff);

  it("reads all six Brc fields in brcTop/brcLeft/brcBottom/brcRight/brcHorizontalInside/brcVerticalInside order", () => {
    // [MS-DOC] 2.9.302: cb (MUST be 0x30) then six 8-byte Brc fields back to back, in that declared order.
    const top: ContentBorder = { color: RED, widthPt: 1 };
    const left: ContentBorder = { color: BLACK, widthPt: 0.5 };
    const bottom: ContentBorder = { color: RED, widthPt: 1.5 };
    const right: ContentBorder = { color: BLACK, widthPt: 2 };
    const operand = bytes([
      0x30,
      ...writeBrc(top),
      ...writeBrc(left),
      ...writeBrc(bottom),
      ...writeBrc(right),
      ...writeBrc(GREEN),
      ...writeBrc(BLUE),
    ]);
    expect(readTableBordersOperand(operand)).toEqual({
      top,
      left,
      bottom,
      right,
      insideHorizontal: GREEN,
      insideVertical: BLUE,
    });
  });

  it("reads a NilBrc field as no border for that side, leaving the others intact", () => {
    const top: ContentBorder = { color: RED, widthPt: 1 };
    const operand = bytes([
      0x30,
      ...writeBrc(top),
      ...nilBrc,
      ...nilBrc,
      ...nilBrc,
      ...nilBrc,
      ...nilBrc,
    ]);
    expect(readTableBordersOperand(operand)).toEqual({ top });
  });

  it("reads a whole-nil operand as a set with no side stated at all", () => {
    const operand = bytes([
      0x30,
      ...nilBrc,
      ...nilBrc,
      ...nilBrc,
      ...nilBrc,
      ...nilBrc,
      ...nilBrc,
    ]);
    expect(readTableBordersOperand(operand)).toEqual({});
  });
});

describe("TableBordersOperand80", () => {
  const nilBrc80 = new Array<number>(BRC80_SIZE).fill(0xff);

  it("reads all six Brc80 fields in the same order, palette-indexed", () => {
    // [MS-DOC] 2.9.303: cb (MUST be 0x18) then six 4-byte Brc80MayBeNil fields, same order as TableBordersOperand.
    const top: ContentBorder = { color: RED, widthPt: 0.5 };
    const insideVertical: ContentBorder = {
      color: BLACK,
      widthPt: 1,
      style: "dotted",
    };
    const operand = bytes([
      0x18,
      ...writeBrc80(top),
      ...nilBrc80,
      ...nilBrc80,
      ...nilBrc80,
      ...nilBrc80,
      ...writeBrc80(insideVertical),
    ]);
    expect(readTableBordersOperand80(operand)).toEqual({
      top,
      insideVertical,
    });
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

  it("resolves an icoFore/icoBack past the palette's own 0x11 bound to no background, rather than aborting the whole document read", () => {
    // icoFore and icoBack are each a 5-bit field (0-31), so a value the 17-entry palette has no entry for is a real possibility this reader must not fail the whole document over -- see decoration.ts's own readBrc80 note and color.ts's decorativeIcoColor.
    expect(readShd80(0x03e0)).toBeUndefined(); // ipatAuto (bits 10-15 = 0), icoFore 0, icoBack 0x1f (bits 5-9)
    expect(readShd80(0x041f)).toBeUndefined(); // ipatSolid (bits 10-15 = 1), icoFore 0x1f (bits 0-4), icoBack 0
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
          ? { vertMerge: 0, horzMerge: 0, background: { r: 1, g: 0, b: 1 } }
          : { vertMerge: 0, horzMerge: 0 },
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
          ? { vertMerge: 0, horzMerge: 0 }
          : { vertMerge: 0, horzMerge: 0, background };
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
      { vertMerge: 3, horzMerge: 0, background: { r: 1, g: 1, b: 0 } },
      { vertMerge: 1, horzMerge: 0 },
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
        [
          { vertMerge: 0, horzMerge: 0 },
          { vertMerge: 0, horzMerge: 0 },
        ],
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
          horzMerge: 0,
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
