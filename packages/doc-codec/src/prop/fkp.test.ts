import { describe, expect, it } from "vitest";
import { buildBinTable, buildChpxFkp, buildPapxFkp } from "../test-support/fkp";
import { DocFormatError } from "../errors";
import {
  FKP_PAGE_SIZE,
  parseChpxFkp,
  parsePapxFkp,
  PropertyBinTable,
} from "./fkp";

describe("parseChpxFkp", () => {
  it("rejects a page that is not exactly 512 bytes", () => {
    expect(() => parseChpxFkp(new Uint8Array(FKP_PAGE_SIZE - 1))).toThrow(
      DocFormatError,
    );
    expect(() => parseChpxFkp(new Uint8Array(FKP_PAGE_SIZE - 1))).toThrow(
      /ChpxFkp/,
    );
  });

  it("rejects crun 0, below the 0x01 minimum", () => {
    const page = new Uint8Array(FKP_PAGE_SIZE);
    page[FKP_PAGE_SIZE - 1] = 0;
    expect(() => parseChpxFkp(page)).toThrow(/crun 0/);
  });

  it("accepts crun at its maximum, 0x65", () => {
    const runs = Array.from({ length: 0x65 }, (_unused, index) => ({
      fc: index * 2,
    }));
    const page = buildChpxFkp(runs, 0x65 * 2);
    expect(() => parseChpxFkp(page)).not.toThrow();
  });

  it("rejects crun one past its maximum, 0x66", () => {
    const page = new Uint8Array(FKP_PAGE_SIZE);
    page[FKP_PAGE_SIZE - 1] = 0x66;
    expect(() => parseChpxFkp(page)).toThrow(/crun 102/);
  });

  it("reads a run's own rgfc entries and its grpprl", () => {
    const fkp = parseChpxFkp(
      buildChpxFkp([{ fc: 0x400, grpprl: [0x35, 0x08, 0x01] }], 0x410),
    );
    expect(fkp.rgfc).toEqual([0x400, 0x410]);
    expect(fkp.grpprl(0)).toEqual(new Uint8Array([0x35, 0x08, 0x01]));
  });

  it("resolves a zero rgb entry to undefined rather than an offset", () => {
    const fkp = parseChpxFkp(buildChpxFkp([{ fc: 0x400 }], 0x410));
    expect(fkp.grpprl(0)).toBeUndefined();
  });

  it("rejects a negative run index", () => {
    const fkp = parseChpxFkp(buildChpxFkp([{ fc: 0x400 }], 0x410));
    expect(() => fkp.grpprl(-1)).toThrow(DocFormatError);
  });

  it("rejects a non-integer run index", () => {
    const fkp = parseChpxFkp(buildChpxFkp([{ fc: 0x400 }], 0x410));
    expect(() => fkp.grpprl(0.5)).toThrow(DocFormatError);
  });

  it("rejects a run index equal to crun", () => {
    const fkp = parseChpxFkp(buildChpxFkp([{ fc: 0x400 }], 0x410));
    expect(() => fkp.grpprl(1)).toThrow(/covers 1 runs; run 1 was requested/);
  });

  it("accepts the last valid run index (crun - 1)", () => {
    const fkp = parseChpxFkp(
      buildChpxFkp([{ fc: 0x400 }, { fc: 0x410 }], 0x420),
    );
    expect(() => fkp.grpprl(1)).not.toThrow();
  });
});

describe("parsePapxFkp", () => {
  it("rejects a page that is not exactly 512 bytes", () => {
    expect(() => parsePapxFkp(new Uint8Array(FKP_PAGE_SIZE + 1))).toThrow(
      DocFormatError,
    );
    expect(() => parsePapxFkp(new Uint8Array(FKP_PAGE_SIZE + 1))).toThrow(
      /PapxFkp/,
    );
  });

  it("rejects cpara 0, below the 0x01 minimum", () => {
    const page = new Uint8Array(FKP_PAGE_SIZE);
    page[FKP_PAGE_SIZE - 1] = 0;
    expect(() => parsePapxFkp(page)).toThrow(/cpara 0/);
  });

  it("accepts cpara at its maximum, 0x1D", () => {
    const paragraphs = Array.from({ length: 0x1d }, (_unused, index) => ({
      fc: index * 2,
      istd: 0,
    }));
    const page = buildPapxFkp(paragraphs, 0x1d * 2);
    expect(() => parsePapxFkp(page)).not.toThrow();
  });

  it("rejects cpara one past its maximum, 0x1E", () => {
    const page = new Uint8Array(FKP_PAGE_SIZE);
    page[FKP_PAGE_SIZE - 1] = 0x1e;
    expect(() => parsePapxFkp(page)).toThrow(
      /cpara 30, outside the 0x01\.\.0x1D range/,
    );
  });

  it("resolves bOffset 0 to undefined -- the paragraph takes the document defaults", () => {
    const fkp = parsePapxFkp(
      buildPapxFkp([{ fc: 0x400, istd: 0, omitPapx: true }], 0x410),
    );
    expect(fkp.papx(0)).toBeUndefined();
  });

  it("reads a paragraph's own istd and grpprl through the odd-length (cb) spelling", () => {
    // istd (2 bytes) + a 3-byte grpprl = 5 bytes, odd, so buildPapxFkp takes the one-byte cb form.
    const fkp = parsePapxFkp(
      buildPapxFkp([{ fc: 0x400, istd: 7, grpprl: [0x2a, 0x24, 0x01] }], 0x410),
    );
    const record = fkp.papx(0);
    expect(record?.istd).toBe(7);
    expect(record?.grpprl).toEqual(new Uint8Array([0x2a, 0x24, 0x01]));
  });

  it("reads a paragraph's own istd and grpprl through the even-length (cb') spelling", () => {
    // istd (2 bytes) + a 4-byte grpprl = 6 bytes, even, so buildPapxFkp takes the two-byte cb' form.
    const fkp = parsePapxFkp(
      buildPapxFkp(
        [{ fc: 0x400, istd: 3, grpprl: [0x2a, 0x24, 0x01, 0x00] }],
        0x410,
      ),
    );
    const record = fkp.papx(0);
    expect(record?.istd).toBe(3);
    expect(record?.grpprl).toEqual(new Uint8Array([0x2a, 0x24, 0x01, 0x00]));
  });

  it("reads a paragraph carrying no grpprl at all (istd alone)", () => {
    const fkp = parsePapxFkp(buildPapxFkp([{ fc: 0x400, istd: 1 }], 0x410));
    const record = fkp.papx(0);
    expect(record?.istd).toBe(1);
    expect(record?.grpprl).toEqual(new Uint8Array(0));
  });

  it("rejects cb 0 with cb' 0, below cb''s own 1 minimum", () => {
    const page = new Uint8Array(FKP_PAGE_SIZE);
    const view = new DataView(page.buffer);
    view.setUint32(0, 0x40, true);
    view.setUint32(4, 0x50, true);
    page[FKP_PAGE_SIZE - 1] = 1;
    const bxPapAt = 8;
    page[bxPapAt] = 0x40 / 2; // bOffset -> papxAt 0x40.
    page[0x40] = 0; // cb.
    page[0x41] = 0; // cb' -- below its own minimum of 1.
    expect(() => parsePapxFkp(page).papx(0)).toThrow(
      /cb 0 and cb' 0, but \[MS-DOC\] requires cb' to be at least 1/,
    );
  });

  it("rejects a GrpPrlAndIstd shorter than the 2-byte istd it must begin with", () => {
    // cb 1 gives a GrpPrlAndIstd of 2*1-1 = 1 byte, too short to hold even the istd.
    const page = new Uint8Array(FKP_PAGE_SIZE);
    const view = new DataView(page.buffer);
    view.setUint32(0, 0x40, true);
    view.setUint32(4, 0x50, true);
    page[FKP_PAGE_SIZE - 1] = 1;
    const bxPapAt = 8;
    page[bxPapAt] = 0x40 / 2;
    page[0x40] = 1; // cb 1 -> GrpPrlAndIstd size 1.
    expect(() => parsePapxFkp(page).papx(0)).toThrow(
      /declares a 1-byte GrpPrlAndIstd, too short/,
    );
  });

  it("accepts a GrpPrlAndIstd of exactly 2 bytes -- the istd alone, no grpprl", () => {
    // cb' 1 gives a GrpPrlAndIstd of 2*1 = 2 bytes, exactly the istd with an empty grpprl.
    const page = new Uint8Array(FKP_PAGE_SIZE);
    const view = new DataView(page.buffer);
    view.setUint32(0, 0x40, true);
    view.setUint32(4, 0x50, true);
    page[FKP_PAGE_SIZE - 1] = 1;
    const bxPapAt = 8;
    page[bxPapAt] = 0x40 / 2;
    page[0x40] = 0; // cb 0 -> read cb'.
    page[0x41] = 1; // cb' 1 -> GrpPrlAndIstd size 2.
    view.setUint16(0x42, 5, true); // istd.
    const record = parsePapxFkp(page).papx(0);
    expect(record?.istd).toBe(5);
    expect(record?.grpprl).toEqual(new Uint8Array(0));
  });

  it("rejects a negative paragraph index", () => {
    const fkp = parsePapxFkp(buildPapxFkp([{ fc: 0x400, istd: 0 }], 0x410));
    expect(() => fkp.papx(-1)).toThrow(DocFormatError);
  });

  it("rejects a non-integer paragraph index", () => {
    const fkp = parsePapxFkp(buildPapxFkp([{ fc: 0x400, istd: 0 }], 0x410));
    expect(() => fkp.papx(0.5)).toThrow(DocFormatError);
  });

  it("rejects a paragraph index equal to cpara", () => {
    const fkp = parsePapxFkp(buildPapxFkp([{ fc: 0x400, istd: 0 }], 0x410));
    expect(() => fkp.papx(1)).toThrow(
      /covers 1 paragraphs; paragraph 1 was requested/,
    );
  });

  it("accepts the last valid paragraph index (cpara - 1)", () => {
    const fkp = parsePapxFkp(
      buildPapxFkp(
        [
          { fc: 0x400, istd: 0 },
          { fc: 0x408, istd: 1 },
        ],
        0x410,
      ),
    );
    expect(() => fkp.papx(1)).not.toThrow();
  });

  describe("fcLimAt", () => {
    it("reads rgfc[index + 1], the paragraph's own bracketing end offset", () => {
      const fkp = parsePapxFkp(
        buildPapxFkp(
          [
            { fc: 0x400, istd: 0 },
            { fc: 0x408, istd: 1 },
          ],
          0x410,
        ),
      );
      expect(fkp.fcLimAt(0)).toBe(0x408);
      expect(fkp.fcLimAt(1)).toBe(0x410);
    });

    it("throws for an index one past rgfc's own last bracketing pair, naming the actual paragraph count", () => {
      const fkp = parsePapxFkp(buildPapxFkp([{ fc: 0x400, istd: 0 }], 0x410));
      expect(() => fkp.fcLimAt(1)).toThrow(
        /covers 1 paragraphs; no bracketing end offset exists for paragraph 1/,
      );
    });
  });
});

describe("PropertyBinTable", () => {
  function wordDocumentWith(pageNumber: number, page: Uint8Array): Uint8Array {
    const wordDocument = new Uint8Array((pageNumber + 1) * FKP_PAGE_SIZE);
    wordDocument.set(page, pageNumber * FKP_PAGE_SIZE);
    return wordDocument;
  }

  it("resolves chpxGrpprl to undefined for an fc exactly on the table's own trailing boundary key, one past every real page", () => {
    // The bin table's own last key marks the exclusive end of its last page's coverage rather than the start of a further one -- findLargestAtMost itself already treats landing on it as out of range, the same "final key terminates rather than opens a range" rule a PLC's own keys follow.
    const page = buildChpxFkp([{ fc: 0x400 }], 0x410);
    const wordDocument = wordDocumentWith(2, page);
    const bin = new PropertyBinTable(
      wordDocument,
      buildBinTable([0x400, 0x410], [2]),
      "PlcBteChpx",
    );
    expect(bin.chpxGrpprl(0x410)).toBeUndefined();
  });

  it("resolves chpxGrpprl for an fc inside the bin table's own range", () => {
    const page = buildChpxFkp(
      [{ fc: 0x400, grpprl: [0x35, 0x08, 0x01] }],
      0x410,
    );
    const wordDocument = wordDocumentWith(2, page);
    const bin = new PropertyBinTable(
      wordDocument,
      buildBinTable([0x400, 0x410], [2]),
      "PlcBteChpx",
    );
    expect(bin.chpxGrpprl(0x405)).toEqual(new Uint8Array([0x35, 0x08, 0x01]));
  });

  it("resolves chpxGrpprl to undefined for an fc before the table's own first key", () => {
    const page = buildChpxFkp([{ fc: 0x400 }], 0x410);
    const wordDocument = wordDocumentWith(2, page);
    const bin = new PropertyBinTable(
      wordDocument,
      buildBinTable([0x400, 0x410], [2]),
      "PlcBteChpx",
    );
    expect(bin.chpxGrpprl(0x100)).toBeUndefined();
  });

  it("resolves papx and its fcLim for an fc inside the bin table's own range", () => {
    const page = buildPapxFkp(
      [
        { fc: 0x400, istd: 0 },
        { fc: 0x408, istd: 1, grpprl: [0x2a, 0x24, 0x01] },
      ],
      0x410,
    );
    const wordDocument = wordDocumentWith(3, page);
    const bin = new PropertyBinTable(
      wordDocument,
      buildBinTable([0x400, 0x410], [3]),
      "PlcBtePapx",
    );
    const record = bin.papx(0x409);
    expect(record?.istd).toBe(1);
    expect(record?.fcLim).toBe(0x410);
  });

  it("resolves papx to undefined for an fc before the table's own first key", () => {
    const page = buildPapxFkp([{ fc: 0x400, istd: 0 }], 0x410);
    const wordDocument = wordDocumentWith(3, page);
    const bin = new PropertyBinTable(
      wordDocument,
      buildBinTable([0x400, 0x410], [3]),
      "PlcBtePapx",
    );
    expect(bin.papx(0x100)).toBeUndefined();
  });

  it("resolves papx to undefined when the covering paragraph carries no PapxInFkp of its own", () => {
    const page = buildPapxFkp([{ fc: 0x400, istd: 0, omitPapx: true }], 0x410);
    const wordDocument = wordDocumentWith(1, page);
    const bin = new PropertyBinTable(
      wordDocument,
      buildBinTable([0x400, 0x410], [1]),
      "PlcBtePapx",
    );
    expect(bin.papx(0x405)).toBeUndefined();
  });

  it("genuinely reuses the first papx lookup's own parsed page rather than re-parsing on every call", () => {
    const page = buildPapxFkp([{ fc: 0x400, istd: 0 }], 0x410);
    const wordDocument = wordDocumentWith(3, page);
    const bin = new PropertyBinTable(
      wordDocument,
      buildBinTable([0x400, 0x410], [3]),
      "PlcBtePapx",
    );
    expect(bin.papx(0x401)?.istd).toBe(0);
    wordDocument[3 * FKP_PAGE_SIZE + (FKP_PAGE_SIZE - 1)] = 0; // cpara 0, below the 0x01 minimum parsePapxFkp enforces.
    expect(bin.papx(0x401)?.istd).toBe(0);
  });

  it("memoises a parsed page across two lookups landing on the same page", () => {
    const page = buildChpxFkp(
      [
        { fc: 0x400, grpprl: [0x35, 0x08, 0x01] },
        { fc: 0x408, grpprl: [0x36, 0x08, 0x01] },
      ],
      0x410,
    );
    const wordDocument = wordDocumentWith(4, page);
    const bin = new PropertyBinTable(
      wordDocument,
      buildBinTable([0x400, 0x410], [4]),
      "PlcBteChpx",
    );
    expect(bin.chpxGrpprl(0x401)).toEqual(new Uint8Array([0x35, 0x08, 0x01]));
    expect(bin.chpxGrpprl(0x409)).toEqual(new Uint8Array([0x36, 0x08, 0x01]));
  });

  it("genuinely reuses the first lookup's own parsed page rather than re-parsing on every call", () => {
    // Corrupting the page's own byte-511 crun field between the two lookups would make a fresh parse throw -- a cache that actually stores the first parse survives it; one that only silently succeeded twice by coincidence (the same input parsed identically) would not.
    const page = buildChpxFkp(
      [{ fc: 0x400, grpprl: [0x35, 0x08, 0x01] }],
      0x410,
    );
    const wordDocument = wordDocumentWith(4, page);
    const bin = new PropertyBinTable(
      wordDocument,
      buildBinTable([0x400, 0x410], [4]),
      "PlcBteChpx",
    );
    expect(bin.chpxGrpprl(0x401)).toEqual(new Uint8Array([0x35, 0x08, 0x01]));
    wordDocument[4 * FKP_PAGE_SIZE + (FKP_PAGE_SIZE - 1)] = 0; // crun 0, below the 0x01 minimum parseChpxFkp enforces.
    expect(bin.chpxGrpprl(0x401)).toEqual(new Uint8Array([0x35, 0x08, 0x01]));
  });
});
