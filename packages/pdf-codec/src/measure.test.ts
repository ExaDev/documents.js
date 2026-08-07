import type { TextMeasurer } from 'document-schema.js';
import { describe, expect, it } from 'vitest';
import { createFontRegistry } from './font-registry';
import type { VerticalMetricPolicy } from './measure';
import { DEFAULT_VERTICAL_METRIC_POLICY, createFontMeasurer, createStandardFontMeasurer } from './measure';
import { caladeaRegularBytes, carlitoRegularBytes } from './test-support/fonts';

const HELVETICA_REGULAR = { family: 'Arial', weight: 'normal', style: 'normal' } as const;
const CALIBRI_REGULAR = { family: 'Calibri', weight: 'normal', style: 'normal' } as const;

describe('createStandardFontMeasurer', () => {
  it('widthOfTextAtSize scales linearly with size', () => {
    const measurer = createStandardFontMeasurer();
    const at12 = measurer.widthOfTextAtSize('AA', HELVETICA_REGULAR, 12);
    const at24 = measurer.widthOfTextAtSize('AA', HELVETICA_REGULAR, 24);
    expect(at24).toBeCloseTo(at12 * 2, 6);
  });

  it('matches the known Helvetica "A" width at size 1000 (667 units)', () => {
    const measurer = createStandardFontMeasurer();
    expect(measurer.widthOfTextAtSize('A', HELVETICA_REGULAR, 1000)).toBeCloseTo(667, 6);
  });

  it('applies the default Calibri width correction, making it measurably narrower than Helvetica', () => {
    const measurer = createStandardFontMeasurer();
    const helveticaWidth = measurer.widthOfTextAtSize('Hello World', HELVETICA_REGULAR, 12);
    const calibriWidth = measurer.widthOfTextAtSize('Hello World', CALIBRI_REGULAR, 12);
    expect(calibriWidth).toBeLessThan(helveticaWidth);
    expect(calibriWidth / helveticaWidth).toBeCloseTo(0.92, 5);
  });

  it('a custom correction table overrides the default', () => {
    const measurer = createStandardFontMeasurer({ widthCorrectionByFamily: { calibri: 1 } });
    const helveticaWidth = measurer.widthOfTextAtSize('Hello', HELVETICA_REGULAR, 12);
    const calibriWidth = measurer.widthOfTextAtSize('Hello', CALIBRI_REGULAR, 12);
    expect(calibriWidth).toBeCloseTo(helveticaWidth, 6);
  });

  it('horizontalScaleFor matches the width correction actually applied by widthOfTextAtSize', () => {
    const measurer = createStandardFontMeasurer();
    const scale = measurer.horizontalScaleFor(CALIBRI_REGULAR);
    const uncorrectedWidth =
      measurer.widthOfTextAtSize('Hello World', CALIBRI_REGULAR, 12) / scale;
    const helveticaWidth = measurer.widthOfTextAtSize('Hello World', HELVETICA_REGULAR, 12);
    expect(uncorrectedWidth).toBeCloseTo(helveticaWidth, 6);
  });

  it('lineHeightAtSize/ascenderAtSize/descenderAtSize scale with size and match known Helvetica ratios', () => {
    const measurer = createStandardFontMeasurer();
    expect(measurer.lineHeightAtSize(HELVETICA_REGULAR, 100)).toBeCloseTo(115, 6); // 1.150 em
    expect(measurer.ascenderAtSize(HELVETICA_REGULAR, 1000)).toBeCloseTo(718, 6);
    expect(measurer.descenderAtSize(HELVETICA_REGULAR, 1000)).toBeCloseTo(-207, 6);
  });

  it('underlineAtSize returns metrics scaled from the AFM UnderlinePosition/UnderlineThickness', () => {
    const measurer = createStandardFontMeasurer();
    const underline = measurer.underlineAtSize(HELVETICA_REGULAR, 1000);
    expect(underline.offsetPt).toBeCloseTo(-100, 6);
    expect(underline.thicknessPt).toBeCloseTo(50, 6);
  });

  it('an unknown family defaults to no correction (scale 1.0)', () => {
    const measurer = createStandardFontMeasurer();
    expect(measurer.horizontalScaleFor({ family: 'SomeUnknownFont', weight: 'normal', style: 'normal' })).toBe(1);
  });
});

// The vertical-metric policy is the single least-specified part of embedding a real face: an sfnt declares three competing ascent/descent/line-gap sets and no specification settles which a line-layout consumer should use, so the choice is a named, overridable option rather than a baked-in guess. These tests pin what each policy actually reads, against design-unit values read straight out of the real vendored .ttf files with a bare DataView (not through this package's own parsers) -- the same external-cross-check convention embedded-font.test.ts states.
//
// The two vendored families discriminate different policies, which is why both appear here rather than one standing in for the other: Carlito  (2048 upem) -- hhea 1950/-550/0, OS/2 typo 1536/-512/452, OS/2 win 1950/550. The typo set has the same TOTAL (2500 design units) as hhea but a materially different ascent/descent split, so it discriminates ascenderAtSize/descenderAtSize while leaving lineHeightAtSize identical. Caladea (1000 upem) -- hhea 900/-250/0, OS/2 typo 900/-250/0, OS/2 win 1050/250. Here typo matches hhea exactly and the win set is the outlier, so it discriminates lineHeightAtSize.
const CARLITO_UNITS_PER_EM = 2048;
const CALADEA_UNITS_PER_EM = 1000;
const HOUSE_SANS = { family: 'HouseSans', weight: 'normal', style: 'normal' } as const;
const HOUSE_SERIF = { family: 'HouseSerif', weight: 'normal', style: 'normal' } as const;

function glyphSpace(designUnits: number, unitsPerEm: number): number {
  return (designUnits * 1000) / unitsPerEm;
}

function houseRegistry(options: { readonly verticalMetrics?: VerticalMetricPolicy } = {}): TextMeasurer {
  const registry = createFontRegistry({
    fonts: [
      { family: 'HouseSans', bold: false, italic: false, bytes: carlitoRegularBytes() },
      { family: 'HouseSerif', bold: false, italic: false, bytes: caladeaRegularBytes() },
    ],
  });
  return createFontMeasurer(registry, options);
}

describe('createFontMeasurer: VerticalMetricPolicy on an embedded face', () => {
  it('defaults to hhea, matching how STANDARD_METRICS.lineHeightEm was itself derived', () => {
    expect(DEFAULT_VERTICAL_METRIC_POLICY).toBe('hhea');
    const measurer = houseRegistry();
    expect(measurer.ascenderAtSize(HOUSE_SANS, 1000)).toBeCloseTo(glyphSpace(1950, CARLITO_UNITS_PER_EM), 10);
    expect(measurer.descenderAtSize(HOUSE_SANS, 1000)).toBeCloseTo(glyphSpace(-550, CARLITO_UNITS_PER_EM), 10);
    expect(measurer.lineHeightAtSize(HOUSE_SANS, 1000)).toBeCloseTo(glyphSpace(1950 + 550, CARLITO_UNITS_PER_EM), 10);
  });

  it("'os2Typo' reads OS/2's own sTypoAscender/sTypoDescender/sTypoLineGap instead", () => {
    const measurer = houseRegistry({ verticalMetrics: 'os2Typo' });
    expect(measurer.ascenderAtSize(HOUSE_SANS, 1000)).toBeCloseTo(glyphSpace(1536, CARLITO_UNITS_PER_EM), 10);
    expect(measurer.descenderAtSize(HOUSE_SANS, 1000)).toBeCloseTo(glyphSpace(-512, CARLITO_UNITS_PER_EM), 10);
    expect(measurer.lineHeightAtSize(HOUSE_SANS, 1000)).toBeCloseTo(glyphSpace(1536 + 512 + 452, CARLITO_UNITS_PER_EM), 10);
    // Genuinely different from hhea's split, not a coincidentally equal reading of the same fields.
    expect(measurer.ascenderAtSize(HOUSE_SANS, 1000)).not.toBeCloseTo(houseRegistry().ascenderAtSize(HOUSE_SANS, 1000), 3);
  });

  it("'os2Win' reads usWinAscent/usWinDescent, negating the descent and adding no line gap", () => {
    const measurer = houseRegistry({ verticalMetrics: 'os2Win' });
    expect(measurer.ascenderAtSize(HOUSE_SERIF, 1000)).toBeCloseTo(glyphSpace(1050, CALADEA_UNITS_PER_EM), 10);
    // usWinDescent is declared as a positive 250; every descent this interface reports is negative.
    expect(measurer.descenderAtSize(HOUSE_SERIF, 1000)).toBeCloseTo(glyphSpace(-250, CALADEA_UNITS_PER_EM), 10);
    expect(measurer.lineHeightAtSize(HOUSE_SERIF, 1000)).toBeCloseTo(glyphSpace(1050 + 250, CALADEA_UNITS_PER_EM), 10);
    // Caladea's hhea set is 900/-250/0, so this is a genuinely looser line than the default policy gives.
    expect(measurer.lineHeightAtSize(HOUSE_SERIF, 1000)).toBeGreaterThan(houseRegistry().lineHeightAtSize(HOUSE_SERIF, 1000));
  });

  it('falls back to hhea for a face whose OS/2 table is not readable at all', () => {
    const registry = createFontRegistry({ fonts: [{ family: 'HouseSans', bold: false, italic: false, bytes: withoutOs2Table(carlitoRegularBytes()) }] });
    for (const policy of ['hhea', 'os2Typo', 'os2Win'] as const) {
      const measurer = createFontMeasurer(registry, { verticalMetrics: policy });
      expect(measurer.ascenderAtSize(HOUSE_SANS, 1000)).toBeCloseTo(glyphSpace(1950, CARLITO_UNITS_PER_EM), 10);
      expect(measurer.descenderAtSize(HOUSE_SANS, 1000)).toBeCloseTo(glyphSpace(-550, CARLITO_UNITS_PER_EM), 10);
      expect(measurer.lineHeightAtSize(HOUSE_SANS, 1000)).toBeCloseTo(glyphSpace(1950 + 550, CARLITO_UNITS_PER_EM), 10);
    }
  });

  it('the policy never touches a standard-14 resolution, which has only one metric set to read', () => {
    for (const policy of ['hhea', 'os2Typo', 'os2Win'] as const) {
      const measurer = createFontMeasurer(undefined, { verticalMetrics: policy });
      expect(measurer.lineHeightAtSize(HELVETICA_REGULAR, 100)).toBeCloseTo(115, 6);
      expect(measurer.ascenderAtSize(HELVETICA_REGULAR, 1000)).toBeCloseTo(718, 6);
    }
  });
});

// Removes the 'OS/2' record from a font's table directory, leaving every other record and all table data byte-for-byte where they were: table offsets are absolute from the start of the file, so dropping one 16-byte record and decrementing numTables makes that table undiscoverable without moving anything else. That is exactly what "a face with no readable OS/2" means to every reader in this package, and it needs a real font to test against rather than a synthetic stub, since the fallback has to be observed against genuine hhea values.
function withoutOs2Table(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const TABLE_DIRECTORY_HEADER_SIZE = 12;
  const TABLE_RECORD_SIZE = 16;
  const NUM_TABLES_OFFSET = 4;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = view.getUint16(NUM_TABLES_OFFSET);
  const decoder = new TextDecoder('ascii');
  let recordIndex = -1;
  for (let i = 0; i < numTables; i++) {
    const offset = TABLE_DIRECTORY_HEADER_SIZE + i * TABLE_RECORD_SIZE;
    if (decoder.decode(bytes.subarray(offset, offset + 4)) === 'OS/2') {
      recordIndex = i;
      break;
    }
  }
  if (recordIndex < 0) {
    throw new Error('the vendored font has no OS/2 table to remove -- this helper is testing nothing');
  }
  const stripped = new Uint8Array(bytes.length);
  stripped.set(bytes);
  const removedAt = TABLE_DIRECTORY_HEADER_SIZE + recordIndex * TABLE_RECORD_SIZE;
  const directoryEnd = TABLE_DIRECTORY_HEADER_SIZE + numTables * TABLE_RECORD_SIZE;
  stripped.copyWithin(removedAt, removedAt + TABLE_RECORD_SIZE, directoryEnd);
  new DataView(stripped.buffer).setUint16(NUM_TABLES_OFFSET, numTables - 1);
  return stripped;
}
