import { describe, expect, it } from "vitest";
import { parseChpxFkp, parsePapxFkp } from "./fkp";
import {
  buildChpxPages,
  buildPapxPages,
  buildPropertyBinTable,
  firstFcOfPage,
  fitsAloneOnPapxPage,
  type ChpxRunToWrite,
  type PapxParagraphToWrite,
} from "./fkp-write";

// buildChpxPages/buildPapxPages return Uint8Array[], so noUncheckedIndexedAccess types every pages[index] as possibly undefined even though these tests always construct enough input to guarantee the index exists -- this narrows that genuinely-non-optional value without an `as`/`!` assertion, both of which this package's own lint config forbids in production and test files alike once past the assertionStyle carve-out `as` itself still gets in tests.
function pageAt(pages: readonly Uint8Array[], index: number): Uint8Array {
  const page = pages[index];
  if (page === undefined) {
    throw new Error(`test built too few pages to have one at index ${index}`);
  }
  return page;
}

describe("buildChpxPages", () => {
  it("rejects an empty run list", () => {
    expect(() => buildChpxPages([], 0)).toThrow(
      "buildChpxPages requires at least one run",
    );
  });

  it("builds one page for a single run, readable back through parseChpxFkp", () => {
    const pages = buildChpxPages(
      [{ fc: 0x400, grpprl: [0x35, 0x08, 0x01] }],
      0x410,
    );
    expect(pages).toHaveLength(1);
    const fkp = parseChpxFkp(pageAt(pages, 0));
    expect(fkp.rgfc).toEqual([0x400, 0x410]);
    expect(fkp.grpprl(0)).toEqual(new Uint8Array([0x35, 0x08, 0x01]));
  });

  it("writes rgb 0 for a run with no grpprl, reading back as undefined", () => {
    const pages = buildChpxPages([{ fc: 0x400, grpprl: undefined }], 0x410);
    const fkp = parseChpxFkp(pageAt(pages, 0));
    expect(fkp.grpprl(0)).toBeUndefined();
  });

  it("names the first byte offset the page covers via firstFcOfPage", () => {
    const pages = buildChpxPages([{ fc: 0x400, grpprl: undefined }], 0x410);
    expect(firstFcOfPage(pageAt(pages, 0))).toBe(0x400);
  });

  it("splits across two pages once the run count exceeds 0x65 (MAX_CRUN)", () => {
    const runs: ChpxRunToWrite[] = Array.from(
      { length: 0x66 },
      (_u, index) => ({
        fc: index * 2,
        grpprl: undefined,
      }),
    );
    const pages = buildChpxPages(runs, 0x66 * 2);
    expect(pages).toHaveLength(2);
    const first = parseChpxFkp(pageAt(pages, 0));
    const second = parseChpxFkp(pageAt(pages, 1));
    expect(first.rgfc).toHaveLength(0x66); // 0x65 runs + the bracketing fcLim.
    expect(second.rgfc).toHaveLength(2); // The one leftover run + its own fcLim.
  });

  it("gives an earlier page's own trailing rgfc the next page's own first run fc, not the whole sequence's own fcLim", () => {
    const runs: ChpxRunToWrite[] = Array.from(
      { length: 0x66 },
      (_u, index) => ({
        fc: index * 2,
        grpprl: undefined,
      }),
    );
    const pages = buildChpxPages(runs, 0x1000);
    const first = parseChpxFkp(pageAt(pages, 0));
    // The bracketing rgfc entry on the first page is the second page's own first run fc (0x65 * 2), not the far-off overall fcLim (0x1000).
    expect(first.rgfc[first.rgfc.length - 1]).toBe(0x65 * 2);
  });

  it("splits earlier than the count limit once a page's own record region would overflow the page", () => {
    // Large grpprls exhaust the 512-byte page's own record region long before 0x65 runs accumulate.
    const bigGrpprl = Array.from({ length: 0xff }, (_u, index) => index & 0xff);
    const runs: ChpxRunToWrite[] = Array.from({ length: 10 }, (_u, index) => ({
      fc: index * 2,
      grpprl: bigGrpprl,
    }));
    const pages = buildChpxPages(runs, 100);
    expect(pages.length).toBeGreaterThan(1);
  });

  it("throws when a single run's own grpprl cannot fit even alone on a page", () => {
    const tooLarge = Array.from({ length: 0x100 }, (_u, index) => index & 0xff); // 256 > MAX_CHPX_RECORD_GRPPRL (0xff).
    expect(() => buildChpxPages([{ fc: 0, grpprl: tooLarge }], 10)).toThrow(
      /a single character-formatting run does not fit/,
    );
  });
});

describe("buildPapxPages", () => {
  it("rejects an empty paragraph list", () => {
    expect(() => buildPapxPages([], 0)).toThrow(
      "buildPapxPages requires at least one paragraph",
    );
  });

  it("builds one page for a single paragraph, readable back through parsePapxFkp", () => {
    const pages = buildPapxPages(
      [{ fc: 0x400, istd: 2, grpprl: [0x2a, 0x24, 0x01] }],
      0x410,
    );
    expect(pages).toHaveLength(1);
    const fkp = parsePapxFkp(pageAt(pages, 0));
    const record = fkp.papx(0);
    expect(record?.istd).toBe(2);
    expect(record?.grpprl).toEqual(new Uint8Array([0x2a, 0x24, 0x01]));
  });

  it("writes the odd-length (cb) spelling for an odd GrpPrlAndIstd length", () => {
    // istd (2 bytes) + a 3-byte grpprl = 5 bytes, odd.
    const pages = buildPapxPages(
      [{ fc: 0x400, istd: 0, grpprl: [1, 2, 3] }],
      0x410,
    );
    const record = parsePapxFkp(pageAt(pages, 0)).papx(0);
    expect(record?.grpprl).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("writes the even-length (cb') spelling for an even GrpPrlAndIstd length", () => {
    // istd (2 bytes) + a 4-byte grpprl = 6 bytes, even.
    const pages = buildPapxPages(
      [{ fc: 0x400, istd: 0, grpprl: [1, 2, 3, 4] }],
      0x410,
    );
    const record = parsePapxFkp(pageAt(pages, 0)).papx(0);
    expect(record?.grpprl).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("splits across two pages once the paragraph count exceeds 0x1D (MAX_CPARA)", () => {
    const paragraphs: PapxParagraphToWrite[] = Array.from(
      { length: 0x1e },
      (_u, index) => ({ fc: index * 2, istd: 0, grpprl: [] }),
    );
    const pages = buildPapxPages(paragraphs, 0x1e * 2);
    expect(pages).toHaveLength(2);
  });

  it("gives an earlier page's own trailing rgfc the next page's own first paragraph fc, not the far-off overall fcLim", () => {
    const paragraphs: PapxParagraphToWrite[] = Array.from(
      { length: 0x1e },
      (_u, index) => ({ fc: index * 2, istd: 0, grpprl: [] }),
    );
    const pages = buildPapxPages(paragraphs, 0x1000);
    expect(pages).toHaveLength(2);
    const first = parsePapxFkp(pageAt(pages, 0));
    const second = parsePapxFkp(pageAt(pages, 1));
    // The first page's own bracketing rgfc entry matches the second page's own first paragraph fc exactly, whatever that split point turns out to be -- not the far-off overall fcLim (0x1000).
    expect(first.rgfc[first.rgfc.length - 1]).toBe(second.rgfc[0]);
    expect(first.rgfc[first.rgfc.length - 1]).not.toBe(0x1000);
  });

  it("throws when a single paragraph's own GrpPrlAndIstd cannot fit even alone on a page", () => {
    const tooLarge = Array.from({ length: 0x1fe }, (_u, index) => index & 0xff); // + 2-byte istd exceeds MAX_GRP_PRL_AND_ISTD (0x1fe).
    expect(() =>
      buildPapxPages([{ fc: 0, istd: 0, grpprl: tooLarge }], 10),
    ).toThrow(/a single paragraph-formatting record does not fit/);
  });
});

describe("fitsAloneOnPapxPage", () => {
  it("accepts a small grpprl", () => {
    expect(fitsAloneOnPapxPage([0x2a, 0x24, 0x01])).toBe(true);
  });

  it("rejects a grpprl too large to fit even alone", () => {
    const tooLarge = Array.from({ length: 0x1fe }, (_u, index) => index & 0xff);
    expect(fitsAloneOnPapxPage(tooLarge)).toBe(false);
  });

  it("defaults istd to 0", () => {
    expect(fitsAloneOnPapxPage([])).toBe(true);
  });
});

describe("firstFcOfPage", () => {
  it("reads the page's own first rgfc entry as a little-endian uint32", () => {
    const pages = buildChpxPages(
      [{ fc: 0x12345678, grpprl: undefined }],
      0x12345680,
    );
    expect(firstFcOfPage(pageAt(pages, 0))).toBe(0x12345678);
  });
});

describe("buildPropertyBinTable", () => {
  it("rejects a key count that is not exactly one more than the page-number count", () => {
    expect(() => buildPropertyBinTable([0, 100], [1, 2])).toThrow(
      /needs exactly one more key than element/,
    );
  });

  it("writes ascending fcs then one page number per entry", () => {
    const bytes = buildPropertyBinTable([0, 100, 200], [1, 2]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0);
    expect(view.getUint32(4, true)).toBe(100);
    expect(view.getUint32(8, true)).toBe(200);
    expect(view.getUint32(12, true)).toBe(1);
    expect(view.getUint32(16, true)).toBe(2);
  });
});
