import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import { describe, expect, it } from "vitest";

import {
  packSetupFlags,
  pageSizeFromSetup,
  paperSelectionFor,
  unpackSetupFlags,
  type SetupFields,
} from "./print-setup";

// Every expected page size here is stated as the dimensions [MS-XLS] 2.4.257's own iPaperSize table names for that code, converted independently of the module under test, rather than copied from what it returns.

const PORTRAIT_LETTER: SetupFields = {
  paperCode: 1,
  scalePercent: 100,
  fitWidth: 1,
  fitHeight: 1,
  leftToRight: false,
  portrait: true,
  noPls: false,
  noOrientation: false,
};

describe("pageSizeFromSetup", () => {
  it("resolves US Letter (code 1) to the same 612 x 792 pt the shared schema constant carries", () => {
    expect(pageSizeFromSetup(PORTRAIT_LETTER)).toEqual(PAGE_SIZE_LETTER);
  });

  it("resolves A4 (code 9) to the same 595.28 x 841.89 pt the shared schema constant carries", () => {
    expect(pageSizeFromSetup({ ...PORTRAIT_LETTER, paperCode: 9 })).toEqual(
      PAGE_SIZE_A4,
    );
  });

  it("transposes a code's own portrait dimensions when fPortrait is clear", () => {
    // A paper code names the sheet's paper in portrait regardless of how it prints, so landscape A4 is the same code with the dimensions the other way round.
    expect(
      pageSizeFromSetup({ ...PORTRAIT_LETTER, paperCode: 9, portrait: false }),
    ).toEqual({
      widthPt: PAGE_SIZE_A4.heightPt,
      heightPt: PAGE_SIZE_A4.widthPt,
    });
  });

  it("prints portrait when fNoOrient is set, whatever fPortrait says", () => {
    // [MS-XLS] 2.4.257's own fNoOrient table: value 1 means "Pages are printed using portrait mode", and fPortrait "is undefined and MUST be ignored".
    expect(
      pageSizeFromSetup({
        ...PORTRAIT_LETTER,
        portrait: false,
        noOrientation: true,
      }),
    ).toEqual(PAGE_SIZE_LETTER);
  });

  it("resolves a metric code from the millimetres its own table entry states", () => {
    // A3, 297 x 420 mm -> 297/25.4*72 x 420/25.4*72 pt, rounded to hundredths.
    expect(pageSizeFromSetup({ ...PORTRAIT_LETTER, paperCode: 8 })).toEqual({
      widthPt: 841.89,
      heightPt: 1190.55,
    });
  });

  it("resolves nothing for a code outside the table", () => {
    // 0 and everything from 256 up are [MS-XLS]'s own "custom printer paper sizes", resolvable only through a Pls record this package neither reads nor writes.
    expect(
      pageSizeFromSetup({ ...PORTRAIT_LETTER, paperCode: 0 }),
    ).toBeUndefined();
    expect(
      pageSizeFromSetup({ ...PORTRAIT_LETTER, paperCode: 300 }),
    ).toBeUndefined();
  });
});

describe("paperSelectionFor", () => {
  it("names US Letter portrait for the shared schema constant", () => {
    expect(paperSelectionFor(PAGE_SIZE_LETTER)).toEqual({
      code: 1,
      portrait: true,
    });
  });

  it("names A4 landscape for a transposed A4 page", () => {
    expect(
      paperSelectionFor({
        widthPt: PAGE_SIZE_A4.heightPt,
        heightPt: PAGE_SIZE_A4.widthPt,
      }),
    ).toEqual({ code: 9, portrait: false });
  });

  it("absorbs a fraction of a point of drift", () => {
    // A page size crossing between codecs picks up conversion drift; a fifth of a point is well under any real difference between two papers.
    expect(paperSelectionFor({ widthPt: 595.08, heightPt: 841.69 })).toEqual({
      code: 9,
      portrait: true,
    });
  });

  it("names no paper at all for a size no code covers", () => {
    // BIFF8's Setup record addresses paper only by code, so this is a real limit rather than a fallback: the caller refuses instead of substituting a paper the document never asked for.
    expect(paperSelectionFor({ widthPt: 500, heightPt: 500 })).toBeUndefined();
  });

  it("round-trips every resolvable code back to a page size that resolves the same way", () => {
    for (let code = 0; code <= 300; code += 1) {
      const size = pageSizeFromSetup({ ...PORTRAIT_LETTER, paperCode: code });
      if (size === undefined) {
        continue;
      }
      const selection = paperSelectionFor(size);
      expect(selection).toBeDefined();
      // Not necessarily the SAME code: several entries of [MS-XLS]'s own table are duplicates or transposes of one another (US Letter/US Letter Small/US Note all state 8.5 x 11 in; US Tabloid 11 x 17 in and US Ledger 17 x 11 in are one sheet entered both ways round), so what has to hold is that the selection resolves back to the identical page size, not that it picks the code it started from.
      expect(
        pageSizeFromSetup({
          ...PORTRAIT_LETTER,
          paperCode: selection?.code ?? -1,
          portrait: selection?.portrait ?? true,
        }),
      ).toEqual(size);
    }
  });
});

describe("Setup flag packing", () => {
  it("round-trips every combination of the four flags this package acts on", () => {
    for (let combination = 0; combination < 16; combination += 1) {
      const flags = {
        leftToRight: (combination & 1) !== 0,
        portrait: (combination & 2) !== 0,
        noPls: (combination & 4) !== 0,
        noOrientation: (combination & 8) !== 0,
      };
      expect(
        unpackSetupFlags(packSetupFlags({ ...PORTRAIT_LETTER, ...flags })),
      ).toEqual(flags);
    }
  });

  it("packs each flag into the bit position [MS-XLS] 2.4.257 assigns it", () => {
    // Fields A, B, C and G of that section's own bit table: fLeftToRight, fPortrait, fNoPls, then fNoOrient after fNoColor, fDraft and fNotes.
    expect(
      packSetupFlags({
        ...PORTRAIT_LETTER,
        portrait: false,
        leftToRight: true,
      }),
    ).toBe(0x0001);
    expect(packSetupFlags(PORTRAIT_LETTER)).toBe(0x0002);
    expect(packSetupFlags({ ...PORTRAIT_LETTER, noPls: true })).toBe(0x0006);
    expect(packSetupFlags({ ...PORTRAIT_LETTER, noOrientation: true })).toBe(
      0x0042,
    );
  });

  it("reads the flags word a real LibreOffice-written Setup record carries", () => {
    // The grbit of the Setup record in a .xls LibreOffice wrote for a landscape sheet printed left-to-right: fLeftToRight and fUsePage set, fPortrait clear.
    expect(unpackSetupFlags(0x0081)).toEqual({
      leftToRight: true,
      portrait: false,
      noPls: false,
      noOrientation: false,
    });
  });
});
