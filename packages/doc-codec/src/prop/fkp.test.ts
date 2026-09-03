import { describe, expect, it } from "vitest";
import { DocFormatError } from "../errors";
import { buildBinTable, buildChpxFkp, buildPapxFkp } from "../test-support/fkp";
import {
  FKP_PAGE_SIZE,
  parseChpxFkp,
  parsePapxFkp,
  PropertyBinTable,
} from "./fkp";

describe("parseChpxFkp", () => {
  it("reads crun from the page's last byte and rgfc from its front", () => {
    const page = buildChpxFkp(
      [
        { fc: 0x400, grpprl: [0x35, 0x08, 0x01] },
        { fc: 0x420, grpprl: [0x36, 0x08, 0x01] },
      ],
      0x440,
    );
    const fkp = parseChpxFkp(page);
    expect(fkp.rgfc).toEqual([0x400, 0x420, 0x440]);
  });

  it("finds each run's Chpx at rgb[i] doubled, the offset spelling the page uses", () => {
    const page = buildChpxFkp(
      [
        { fc: 0x400, grpprl: [0x35, 0x08, 0x01] },
        { fc: 0x420, grpprl: [0x43, 0x4a, 0x18, 0x00] },
      ],
      0x440,
    );
    const fkp = parseChpxFkp(page);
    expect(Array.from(fkp.grpprl(0) ?? [])).toEqual([0x35, 0x08, 0x01]);
    expect(Array.from(fkp.grpprl(1) ?? [])).toEqual([0x43, 0x4a, 0x18, 0x00]);
  });

  it("reports a run whose rgb entry is zero as carrying no Chpx at all", () => {
    const page = buildChpxFkp(
      [{ fc: 0x400 }, { fc: 0x420, grpprl: [0x35, 0x08, 0x01] }],
      0x440,
    );
    const fkp = parseChpxFkp(page);
    expect(fkp.grpprl(0)).toBeUndefined();
    expect(fkp.grpprl(1)).toBeDefined();
  });

  it("rejects a page that is not the fixed 512 bytes", () => {
    expect(() => parseChpxFkp(new Uint8Array(256))).toThrow(DocFormatError);
  });

  it("rejects a crun outside the 0x01..0x65 range the specification permits", () => {
    const page = buildChpxFkp([{ fc: 0x400, grpprl: [0] }], 0x420);
    page[FKP_PAGE_SIZE - 1] = 0x66;
    expect(() => parseChpxFkp(page)).toThrow(/crun/);
    page[FKP_PAGE_SIZE - 1] = 0x00;
    expect(() => parseChpxFkp(page)).toThrow(/crun/);
  });
});

describe("parsePapxFkp", () => {
  it("reads cpara from the page's last byte and rgfc from its front", () => {
    const page = buildPapxFkp(
      [
        { fc: 0x400, istd: 0 },
        { fc: 0x420, istd: 1 },
      ],
      0x440,
    );
    expect(parsePapxFkp(page).rgfc).toEqual([0x400, 0x420, 0x440]);
  });

  // PapxInFkp's one-byte length spelling gives a GrpPrlAndIstd of 2xcb-1 bytes, always odd, so it carries an odd-length grpprl: here one 3-byte sprmPJc Prl after the 2-byte istd.
  it("reads the istd and grpprl out of a one-byte-length PapxInFkp", () => {
    const page = buildPapxFkp(
      [{ fc: 0x400, istd: 5, grpprl: [0x61, 0x24, 0x01] }],
      0x420,
    );
    const papx = parsePapxFkp(page).papx(0);
    expect(papx?.istd).toBe(5);
    expect(Array.from(papx?.grpprl ?? [])).toEqual([0x61, 0x24, 0x01]);
  });

  // The two-byte spelling gives 2xcb' bytes, always even, so it carries an even-length grpprl: here a 4-byte sprmPDyaBefore Prl.
  it("reads a record through the two-byte length spelling, where cb is zero and the next byte carries the count", () => {
    const page = buildPapxFkp(
      [{ fc: 0x400, istd: 9, grpprl: [0x13, 0xa4, 0x40, 0x01] }],
      0x420,
    );
    const papx = parsePapxFkp(page).papx(0);
    expect(papx?.istd).toBe(9);
    expect(Array.from(papx?.grpprl ?? [])).toEqual([0x13, 0xa4, 0x40, 0x01]);
  });

  // [MS-DOC] 2.9.176's own example ends with exactly this record: cb 0, cb' 1, a 2-byte GrpPrlAndIstd that is the istd alone -- "GrpPrl.istd element takes up two bytes; this means that GrpPrl has no Prl elements".
  it("reads an istd with no grpprl at all, the shortest record the format permits", () => {
    const page = buildPapxFkp([{ fc: 0x400, istd: 3 }], 0x420);
    const papx = parsePapxFkp(page).papx(0);
    expect(papx?.istd).toBe(3);
    expect(Array.from(papx?.grpprl ?? [])).toEqual([]);
  });

  it("reports a paragraph whose BxPap.bOffset is zero as carrying no PapxInFkp", () => {
    const page = buildPapxFkp([{ fc: 0x400, istd: 0, omitPapx: true }], 0x420);
    expect(parsePapxFkp(page).papx(0)).toBeUndefined();
  });

  it("rejects a cpara outside the 0x01..0x1D range the specification permits", () => {
    const page = buildPapxFkp([{ fc: 0x400, istd: 0 }], 0x420);
    page[FKP_PAGE_SIZE - 1] = 0x1e;
    expect(() => parsePapxFkp(page)).toThrow(/cpara/);
  });

  it("rejects a long-form record whose cb' is zero, which the specification forbids", () => {
    const page = buildPapxFkp([{ fc: 0x400, istd: 0 }], 0x420);
    // Locate the record through the BxPap the builder wrote, then break its length bytes.
    const bxPapAt = 2 * 4;
    const recordAt = (page[bxPapAt] ?? 0) * 2;
    page[recordAt] = 0x00;
    page[recordAt + 1] = 0x00;
    expect(() => parsePapxFkp(page).papx(0)).toThrow(DocFormatError);
  });
});

// The two bin tables ([MS-DOC] 2.8.6 and 2.8.7) map a WordDocument byte offset to the 512-byte page holding the properties for the text there, via a page number that must be multiplied by 512.
describe("PropertyBinTable", () => {
  // A WordDocument stream with a ChpxFkp at page 2 (byte offset 0x400) and a PapxFkp at page 3 (0x600).
  function stream(): Uint8Array {
    const bytes = new Uint8Array(4 * FKP_PAGE_SIZE);
    bytes.set(
      buildChpxFkp(
        [
          { fc: 0x800, grpprl: [0x35, 0x08, 0x01] },
          { fc: 0x820, grpprl: [0x36, 0x08, 0x01] },
        ],
        0x840,
      ),
      2 * FKP_PAGE_SIZE,
    );
    bytes.set(
      buildPapxFkp([{ fc: 0x800, istd: 7, grpprl: [0x61, 0x24, 0x02] }], 0x840),
      3 * FKP_PAGE_SIZE,
    );
    return bytes;
  }

  it("resolves a byte offset to the character properties covering it", () => {
    const table = new PropertyBinTable(
      stream(),
      buildBinTable([0x800, 0x840], [2]),
      "PlcBteChpx",
    );
    expect(Array.from(table.chpxGrpprl(0x800) ?? [])).toEqual([
      0x35, 0x08, 0x01,
    ]);
    expect(Array.from(table.chpxGrpprl(0x81f) ?? [])).toEqual([
      0x35, 0x08, 0x01,
    ]);
    expect(Array.from(table.chpxGrpprl(0x820) ?? [])).toEqual([
      0x36, 0x08, 0x01,
    ]);
  });

  it("resolves a byte offset to the paragraph properties covering it", () => {
    const table = new PropertyBinTable(
      stream(),
      buildBinTable([0x800, 0x840], [3]),
      "PlcBtePapx",
    );
    const papx = table.papx(0x810);
    expect(papx?.istd).toBe(7);
    expect(papx?.fcLim).toBe(0x840);
  });

  it("returns nothing for a byte offset outside every range the table covers", () => {
    const table = new PropertyBinTable(
      stream(),
      buildBinTable([0x800, 0x840], [2]),
      "PlcBteChpx",
    );
    expect(table.chpxGrpprl(0x700)).toBeUndefined();
    expect(table.chpxGrpprl(0x840)).toBeUndefined();
  });

  it("multiplies the page number by 512, so a page number is never a byte offset", () => {
    // Naming page 1 rather than 2 must find a different page, proving the multiplier is applied rather than the value being used raw.
    const table = new PropertyBinTable(
      stream(),
      buildBinTable([0x800, 0x840], [1]),
      "PlcBteChpx",
    );
    expect(() => table.chpxGrpprl(0x800)).toThrow(DocFormatError);
  });
});
