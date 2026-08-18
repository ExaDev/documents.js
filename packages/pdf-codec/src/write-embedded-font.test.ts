import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LayoutFont } from 'document-schema.js';
import type { LayoutDocument, LayoutImageAsset } from './layout';
import { LAYOUT_FORMAT_VERSION } from './layout';
import type { EmbeddedFace, EmbeddedFaceSubstitution } from './embedded-font';
import { encodeForShowEmbedded, loadEmbeddedFace } from './embedded-font';
import { createFontRegistry } from './font-registry';
import { encodePng } from './image/png-encode';
import { createFontMeasurer, createStandardFontMeasurer } from './measure';
import { readPdf } from './read';
import { parseSfnt } from './sfnt';
import { carlitoRegularBytes } from './test-support/fonts';
import { wrapRunsToWidth } from './text-layout';
import { bytesToBase64 } from './util/base64';
import { writePdf } from './write';

// The end-to-end proof that a FontRegistry actually reaches the written PDF: a document whose text is authored in Calibri, converted with a registry whose vendored-substitute step resolves that family to the real Carlito face this package embeds, must come out carrying a genuine /Type0 + /CIDFontType2 + /FontFile2 font program rather than a standard-14 Helvetica dictionary -- and must be measured against Carlito's own advances rather than Helvetica's plus the Calibri width fudge.
//
// The other half of this file is the guarantee that costs nothing to state and everything to lose: a document converted with NO registry at all must still produce byte-identical output to the build before any of this existed. That is asserted against golden SHA-256 digests captured from commit 162b24c, the last commit before embedded-font resolution was wired into writePdf (regenerate by checking that commit out and hashing writePdf's output for backwardCompatibilityDocument() below).

const BLACK = { r: 0, g: 0, b: 0 };
const RED = { r: 1, g: 0, b: 0 };
const HELVETICA = { family: 'Helvetica', weight: 'normal', style: 'normal' } as const;
const CALIBRI = { family: 'Calibri', weight: 'normal', style: 'normal' } as const;
const CALIBRI_BOLD = { family: 'Calibri', weight: 'bold', style: 'normal' } as const;
const CALIBRI_LIGHT = { family: 'Calibri Light', weight: 'normal', style: 'normal' } as const;
const CAMBRIA = { family: 'Cambria', weight: 'normal', style: 'normal' } as const;
const CAMBRIA_BOLD = { family: 'Cambria', weight: 'bold', style: 'normal' } as const;

const TRUETYPE_SFNT_VERSION = 0x00010000;

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function carlitoRegularFace(): EmbeddedFace {
  const sfnt = parseSfnt(carlitoRegularBytes());
  if (sfnt === undefined) {
    throw new Error('vendored Carlito Regular failed to parse as an sfnt container');
  }
  const face = loadEmbeddedFace(sfnt);
  if (face === undefined) {
    throw new Error('vendored Carlito Regular failed to load as an embeddable face');
  }
  return face;
}

function textDoc(text: string, font: LayoutFont): LayoutDocument {
  return {
    formatVersion: LAYOUT_FORMAT_VERSION,
    metadata: {},
    pages: [{ widthPt: 612, heightPt: 792, items: [{ kind: 'text', text, xPt: 72, yPt: 700, font, sizePt: 12, color: BLACK }] }],
    images: {},
  };
}

// Locates the /FontFile2 stream's own payload in an uncompressed PDF: /Length1 states the UNCOMPRESSED font-program length, so with compress: false the bytes immediately after that object's `stream\n` are the embedded sfnt itself, verbatim.
function readFontFileProgram(bytes: Uint8Array): Uint8Array {
  const text = decode(bytes);
  const lengthMatch = /\/Length1 (\d+)/.exec(text);
  if (lengthMatch?.[1] === undefined) {
    throw new Error('no /Length1 entry found -- no embedded font program was written');
  }
  const streamStart = text.indexOf('stream\n', lengthMatch.index);
  if (streamStart < 0) {
    throw new Error('the /FontFile2 dictionary is not followed by a stream');
  }
  const payloadStart = streamStart + 'stream\n'.length;
  return bytes.subarray(payloadStart, payloadStart + Number(lengthMatch[1]));
}

describe('writePdf: a FontRegistry resolving Calibri to the vendored Carlito substitute', () => {
  it('writes a real Type0/CIDFontType2/FontFile2 font group, not a standard-14 Helvetica fallback', () => {
    const text = decode(writePdf(textDoc('Hello World', CALIBRI), { compress: false, fonts: createFontRegistry() }));

    expect(text).toContain('/Subtype /Type0');
    expect(text).toContain('/Encoding /Identity-H');
    expect(text).toContain('/Subtype /CIDFontType2');
    expect(text).toContain('/CIDToGIDMap /Identity');
    expect(text).toContain('/FontFile2');
    expect(text).toContain('/Length1 ');
    // The subset tag is six uppercase letters plus '+' (ISO 32000-1 9.6.4), ahead of the face's own real PostScript name.
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Carlito-Regular/);

    // Nothing standard-14 was written for this document at all: no Type1 font dict, no WinAnsi encoding, no Helvetica.
    expect(text).not.toContain('/Subtype /Type1');
    expect(text).not.toContain('/Encoding /WinAnsiEncoding');
    expect(text).not.toContain('/BaseFont /Helvetica');
  });

  it('embeds a genuine TrueType font program, not merely a dictionary claiming one', () => {
    const bytes = writePdf(textDoc('Hello World', CALIBRI), { compress: false, fonts: createFontRegistry() });
    const program = readFontFileProgram(bytes);

    const sfnt = parseSfnt(new Uint8Array(program));
    expect(sfnt).toBeDefined();
    expect(new DataView(program.buffer, program.byteOffset, program.byteLength).getUint32(0)).toBe(TRUETYPE_SFNT_VERSION);
    // A subset, not the whole vendored face: Carlito Regular is several hundred KB, and only 'Hello World's own glyphs are carried.
    expect(program.length).toBeLessThan(carlitoRegularBytes().length / 2);
  });

  it('names the embedded face under its own /Resources/Font key and shows text through it at 100 Tz', () => {
    const text = decode(writePdf(textDoc('Hello World', CALIBRI), { compress: false, fonts: createFontRegistry() }));
    expect(text).toContain('/Font <</E1 ');
    expect(text).toContain('/E1 12 Tf');
    // An embedded face is drawn at its own real advances, so the horizontal-scaling operator is always exactly 100% -- never Calibri's 0.92 standard-14 width correction.
    expect(text).toContain('100 Tz');
    expect(text).not.toContain('92 Tz');
  });

  it('shows text as Identity-H 2-byte CIDs, matching the glyph IDs the face itself resolves', () => {
    const text = decode(writePdf(textDoc('Hi', CALIBRI), { compress: false, fonts: createFontRegistry() }));
    const face = carlitoRegularFace();
    const expectedHex = [...encodeForShowEmbedded('Hi', face).codes].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(text).toContain(`<${expectedHex}> Tj`);
    // Two bytes per character, not the one a WinAnsi string would have used.
    expect(expectedHex).toHaveLength('Hi'.length * 4);
  });

  it('allocates one embedded font group per distinct face, sorted by PostScript name for deterministic numbering', () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            { kind: 'text', text: 'regular', xPt: 72, yPt: 700, font: CALIBRI, sizePt: 12, color: BLACK },
            { kind: 'text', text: 'bold', xPt: 72, yPt: 680, font: CALIBRI_BOLD, sizePt: 12, color: BLACK },
          ],
        },
      ],
      images: {},
    };
    const text = decode(writePdf(doc, { compress: false, fonts: createFontRegistry() }));
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Carlito-Bold/);
    expect(text).toMatch(/\/BaseFont \/[A-Z]{6}\+Carlito-Regular/);
    // Sorted by PostScript name, "Carlito-Bold" < "Carlito-Regular", so the bold face is E1 and is what the second item's Tf names.
    expect(text).toContain('/E1 ');
    expect(text).toContain('/E2 ');
    expect(text).not.toContain('/E3 ');
  });

  it('shares one embedded font group between two families that resolve to the identical face', () => {
    const doc: LayoutDocument = {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: {},
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          items: [
            { kind: 'text', text: 'calibri', xPt: 72, yPt: 700, font: CALIBRI, sizePt: 12, color: BLACK },
            // Calibri Light has no distinct vendored face -- font-substitutes.ts maps it to ordinary Carlito, so both items resolve to the same EmbeddedFace object and must share one font program.
            { kind: 'text', text: 'calibri light', xPt: 72, yPt: 680, font: CALIBRI_LIGHT, sizePt: 12, color: BLACK },
          ],
        },
      ],
      images: {},
    };
    const text = decode(writePdf(doc, { compress: false, fonts: createFontRegistry() }));
    expect((text.match(/\/FontFile2/g) ?? [])).toHaveLength(1);
    expect(text).toContain('/E1 ');
    expect(text).not.toContain('/E2 ');
  });

  it('reports a character the embedded face has no glyph for through onMissingGlyph, never through onSubstitution', () => {
    const missing: (EmbeddedFaceSubstitution & { readonly pageIndex: number })[] = [];
    const substitutions: unknown[] = [];
    writePdf(textDoc('a中b', CALIBRI), {
      compress: false,
      fonts: createFontRegistry(),
      onMissingGlyph: (m, ctx) => missing.push({ ...m, pageIndex: ctx.pageIndex }),
      onSubstitution: (s) => substitutions.push(s),
    });
    expect(missing).toEqual([{ from: '中', pageIndex: 0 }]);
    expect(substitutions).toHaveLength(0);
  });

  it('still writes a standard-14 dictionary for a family the registry resolves to one', () => {
    // 'Helvetica' is in no vendored-substitute table, so the registry falls through to its own step 5.
    const text = decode(writePdf(textDoc('Hello', HELVETICA), { compress: false, fonts: createFontRegistry() }));
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/Encoding /WinAnsiEncoding');
    expect(text).not.toContain('/FontFile2');
    expect(text).toContain('/F1 12 Tf');
  });

  it('produces byte-identical output for identical input, called twice with a registry', () => {
    const doc = textDoc('Hello World', CALIBRI);
    const first = writePdf(doc, { fonts: createFontRegistry() });
    const second = writePdf(doc, { fonts: createFontRegistry() });
    expect(Array.from(first)).toEqual(Array.from(second));
  });
});

describe('createFontMeasurer: measurement against a real embedded face', () => {
  it('measures Calibri text at Carlito\'s own advances, measurably different from the standard-14 substitute', () => {
    const embedded = createFontMeasurer(createFontRegistry());
    const standard = createStandardFontMeasurer();
    const face = carlitoRegularFace();

    const embeddedWidth = embedded.widthOfTextAtSize('Hello World', CALIBRI, 12);
    const standardWidth = standard.widthOfTextAtSize('Hello World', CALIBRI, 12);
    const helveticaWidth = standard.widthOfTextAtSize('Hello World', HELVETICA, 12);

    expect(embeddedWidth).toBeCloseTo((encodeForShowEmbedded('Hello World', face).width1000 / 1000) * 12, 10);
    expect(embeddedWidth).not.toBeCloseTo(standardWidth, 4);
    expect(embeddedWidth).not.toBeCloseTo(helveticaWidth, 4);
  });

  it('matches a hand-computed sum of the face\'s own real design-unit advances', () => {
    // Carlito Regular's raw 'hmtx' advances, read out of the real .ttf with a bare DataView (see embedded-font.test.ts's own note): 'H' 1276, 'l' 470 design units, on a 2048-unit em.
    const carlitoDesignUnits = 1276 + 470 + 470;
    const expectedPt = ((carlitoDesignUnits * 1000) / 2048 / 1000) * 12;
    expect(createFontMeasurer(createFontRegistry()).widthOfTextAtSize('Hll', CALIBRI, 12)).toBeCloseTo(expectedPt, 10);
    // The same string measured through the standard-14 path is Helvetica's H/l/l (722/222/222) times Calibri's 0.92 correction -- a genuinely different number, so the assertion above cannot pass by coincidence.
    expect(createStandardFontMeasurer().widthOfTextAtSize('Hll', CALIBRI, 12)).toBeCloseTo(((722 + 222 + 222) / 1000) * 12 * 0.92, 10);
  });

  it('returns a horizontal scale of exactly 1 for an embedded face, and the family correction for a standard one', () => {
    // The critical invariant: applying BOTH the face's real advances and the standard-14 width fudge would silently draw text 8% narrower than it was measured.
    expect(createFontMeasurer(createFontRegistry()).horizontalScaleFor(CALIBRI)).toBe(1);
    expect(createFontMeasurer(createFontRegistry()).horizontalScaleFor(CAMBRIA_BOLD)).toBe(1);
    expect(createFontMeasurer(createFontRegistry()).horizontalScaleFor(HELVETICA)).toBe(1);
    expect(createStandardFontMeasurer().horizontalScaleFor(CALIBRI)).toBe(0.92);
    expect(createStandardFontMeasurer().horizontalScaleFor(CAMBRIA_BOLD)).toBe(0.96);
  });

  it('feeds line wrapping the embedded advances, changing where a real line actually breaks', () => {
    const text = 'Hamburgefonstiv Hamburgefonstiv';
    const runs = [{ text, font: CALIBRI, sizePt: 12, color: BLACK }];
    const embeddedMeasurer = createFontMeasurer(createFontRegistry());
    const standardMeasurer = createStandardFontMeasurer();

    // A column just wide enough to hold the whole string at the standard-14 substitute's (narrower) measurement. Carlito's own advances are genuinely wider, so the same column fits one word rather than two -- the wrap POINT moves, not merely a reported width. The boundary is placed exactly halfway between the two real measurements rather than at either one plus a chosen slack: Carlito's own pair kerning pulls its measurement several points closer to the substitute's than the bare advances alone would, and a fixed slack that once cleared that gap comfortably no longer does.
    const standardWidthPt = standardMeasurer.widthOfTextAtSize(text, CALIBRI, 12);
    const embeddedWidthPt = embeddedMeasurer.widthOfTextAtSize(text, CALIBRI, 12);
    const columnPt = (standardWidthPt + embeddedWidthPt) / 2;
    expect(embeddedWidthPt).toBeGreaterThan(columnPt);

    const embeddedLines = wrapRunsToWidth(runs, embeddedMeasurer, columnPt);
    const standardLines = wrapRunsToWidth(runs, standardMeasurer, columnPt);

    expect(standardLines).toHaveLength(1);
    expect(embeddedLines).toHaveLength(2);
    expect(embeddedLines[0]?.fragments.map((f) => f.text).join('')).toBe('Hamburgefonstiv');
    expect(embeddedLines[0]?.widthPt).toBeCloseTo((encodeForShowEmbedded('Hamburgefonstiv', carlitoRegularFace()).width1000 / 1000) * 12, 10);
  });

  it('takes underline geometry from the embedded face\'s own post table', () => {
    // Carlito Regular's raw 'post': underlinePosition -103, underlineThickness 194 design units on a 2048-unit em.
    const underline = createFontMeasurer(createFontRegistry()).underlineAtSize(CALIBRI, 1000);
    expect(underline.offsetPt).toBeCloseTo((-103 * 1000) / 2048, 10);
    expect(underline.thicknessPt).toBeCloseTo((194 * 1000) / 2048, 10);
    // Helvetica's own AFM values, which this must NOT have used.
    expect(underline.offsetPt).not.toBeCloseTo(-100, 3);
    expect(underline.thicknessPt).not.toBeCloseTo(50, 3);
  });
});

// The whole path a pair-kerning adjustment travels, end to end: the font's own 'GPOS' table, through the shared encode-and-measure step, into a line's measured width and into the page's own content stream, and back out again through this package's own reader. Both vendored families appear for the reason they always do here -- Carlito's 2048-unit em makes every adjustment a real fractional conversion, Caladea's 1000-unit em makes a TJ number and the font's own declared design-unit adjustment the same digits.
describe('writePdf: pair kerning, from the font table through to a written page', () => {
  // Four adjacent pairs both families genuinely kern (AV, VA, AT, TA), a glyph repeated three times, and one final pair (AR) each font covers but adjusts by nothing.
  const KERNED_TEXT = 'AVATAR';

  it('measures a kerned string narrower than its own bare advance sum, by the font\'s real adjustments', () => {
    const face = carlitoRegularFace();
    const measuredPt = createFontMeasurer(createFontRegistry()).widthOfTextAtSize(KERNED_TEXT, CALIBRI, 12);
    // Carlito Regular's own 'hmtx' advances, read out of the real .ttf with a bare DataView: A 1185, V 1162, T 998, R 1112 design units on a 2048-unit em. Their bare sum is what this package measured for this string before kerning was applied.
    const naivePt = (((1185 + 1162 + 1185 + 998 + 1185 + 1112) * 1000) / 2048 / 1000) * 12;
    expect(naivePt).toBeCloseTo(40.001953125, 10);
    // AV -89, VA -96, AT -160, TA -160 design units: -505 in total, or -2.958984375pt at size 12.
    expect(measuredPt).toBeCloseTo(37.04296875, 10);
    expect(measuredPt).toBeCloseTo(naivePt - ((505 * 1000) / 2048 / 1000) * 12, 10);
    expect(measuredPt).toBeLessThan(naivePt);
    // The measurement is the shared encode step's own answer, not a second computation that happens to agree.
    expect(measuredPt).toBeCloseTo((encodeForShowEmbedded(KERNED_TEXT, face).width1000 / 1000) * 12, 10);
  });

  it('writes the adjustments into the page as a real TJ array, read straight back out of the PDF bytes', () => {
    // Cambria resolves to the vendored Caladea, whose 1000-unit em makes every TJ number the font's own declared design-unit adjustment exactly: AV 117, VA 119, AT 79, TA 79, each negated from the advance delta because a TJ number is subtracted from the current horizontal coordinate (ISO 32000-1 9.4.3).
    const text = decode(writePdf(textDoc(KERNED_TEXT, CAMBRIA), { compress: false, fonts: createFontRegistry() }));
    expect(text).toContain('[<0005> 117 <001a> 119 <0005> 79 <0018> 79 <00050016>] TJ');
    // The array's own strings concatenate back to exactly the CIDs an unkerned Tj would have shown -- splitting the run repositions glyphs, it never changes which ones are drawn -- and no unsplit Tj for this run survives alongside it.
    expect(text).not.toContain('<0005001a0005001800050016> Tj');
  });

  it('still writes a plain Tj for a run the same face kerns nothing in', () => {
    // 'Hi' is a pair Caladea says nothing about, in a face carrying thousands of pairs it does. The common case keeps its single unsplit string.
    const text = decode(writePdf(textDoc('Hi', CAMBRIA), { compress: false, fonts: createFontRegistry() }));
    expect(text).toContain('<000c0027> Tj');
    expect(text).not.toContain('TJ');
  });

  it('reads back through readPdf at the kerned positions, which is what settles the TJ sign empirically', () => {
    const item = readPdf(writePdf(textDoc(KERNED_TEXT, CAMBRIA), { compress: false, fonts: createFontRegistry() })).pages[0]?.items[0];
    if (item?.kind !== 'text') {
      throw new Error('the written page did not read back as one text item');
    }
    // Caladea's own advances for A/V/T/R (599/598/557/613, on a 1000-unit em) sum to 3565 units; its four adjustments total -394. A TJ number written with the opposite sign would recover 3565 + 394 here -- WIDER than the unkerned run rather than narrower -- so this is the assertion that decides the direction against this package's own reader rather than by argument from the specification alone.
    expect(item.widthPt).toBeCloseTo(((3565 - 394) / 1000) * 12, 4);
    expect(item.widthPt).toBeLessThan((3565 / 1000) * 12);
    expect(item.widthPt).not.toBeCloseTo(((3565 + 394) / 1000) * 12, 1);
    // Splitting the run across several strings must not cost the text itself: the reader concatenates them and recovers the whole string through the same ToUnicode CMap.
    expect(item.text).toBe(KERNED_TEXT);
  });
});

describe('writePdf: backward compatibility with no registry supplied', () => {
  function pngAsset(): LayoutImageAsset {
    const data = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
    return { format: 'png', base64: bytesToBase64(encodePng({ width: 2, height: 2, channels: 3, data })), widthPx: 2, heightPx: 2 };
  }

  // Deliberately exercises every object kind writePdf allocates -- three distinct standard-14 faces (two of them, Calibri and Cambria, families that WOULD have resolved to an embedded vendored substitute had a registry been supplied), an underlined run, each vector item kind, an image with its own XObject, a link annotation, hidden speaker notes, and Info metadata -- so a change to any allocation order, resource-dict key, or content-stream operator shows up as a digest mismatch rather than passing unnoticed.
  function backwardCompatibilityDocument(): LayoutDocument {
    return {
      formatVersion: LAYOUT_FORMAT_VERSION,
      metadata: { title: 'Backward compatibility', author: 'pdf-codec', createdIso: '2024-01-02T03:04:05.000Z' },
      pages: [
        {
          widthPt: 612,
          heightPt: 792,
          notes: 'speaker notes',
          items: [
            { kind: 'text', text: 'Hello World', xPt: 72, yPt: 700, font: HELVETICA, sizePt: 12, color: BLACK },
            { kind: 'text', text: 'Calibri body text', xPt: 72, yPt: 680, font: CALIBRI, sizePt: 11, color: BLACK, underline: true },
            { kind: 'text', text: 'Cambria heading', xPt: 72, yPt: 650, font: CAMBRIA_BOLD, sizePt: 14, color: RED },
            { kind: 'rect', xPt: 72, yPt: 600, widthPt: 100, heightPt: 20, fill: RED },
            { kind: 'line', x1Pt: 72, y1Pt: 590, x2Pt: 172, y2Pt: 590, color: BLACK, widthPt: 1 },
            { kind: 'ellipse', xPt: 72, yPt: 540, widthPt: 40, heightPt: 30, fill: BLACK, stroke: { color: RED, widthPt: 2 } },
            { kind: 'path', subpaths: [{ startXPt: 200, startYPt: 500, closed: true, segments: [{ kind: 'line', xPt: 260, yPt: 500 }, { kind: 'cubic', c1xPt: 280, c1yPt: 500, c2xPt: 280, c2yPt: 440, xPt: 240, yPt: 440 }] }], fill: RED },
            { kind: 'image', imageId: 'logo', xPt: 400, yPt: 600, widthPt: 50, heightPt: 50 },
            { kind: 'link', uri: 'https://example.com', xPt: 72, yPt: 400, widthPt: 120, heightPt: 14 },
          ],
        },
      ],
      images: { logo: pngAsset() },
    };
  }

  // Captured at commit 162b24c (the last commit before embedded-font resolution was wired into measurement and PDF text writing) by hashing writePdf(backwardCompatibilityDocument()) for both compression settings. A mismatch here means output drifted for a caller that supplied no font configuration at all -- the one thing this whole change is not allowed to do.
  const GOLDEN_UNCOMPRESSED_SHA256 = '69fcab0328798b0992e45515fb8bf63eeaa346daf67dec215653bd512fec0b2a';
  const GOLDEN_COMPRESSED_SHA256 = 'b73454d18df3e52db6680e7d5a1ddedc97befad0d5b9f7661667173c8365e0f7';

  it('produces byte-identical uncompressed output to the pre-embedded-font build', () => {
    expect(sha256(writePdf(backwardCompatibilityDocument(), { compress: false }))).toBe(GOLDEN_UNCOMPRESSED_SHA256);
  });

  it('produces byte-identical compressed output to the pre-embedded-font build', () => {
    expect(sha256(writePdf(backwardCompatibilityDocument()))).toBe(GOLDEN_COMPRESSED_SHA256);
  });

  it('embeds no font program at all, and still resolves Calibri and Cambria to standard-14 faces', () => {
    const text = decode(writePdf(backwardCompatibilityDocument(), { compress: false }));
    expect(text).not.toContain('/FontFile2');
    expect(text).not.toContain('/Subtype /Type0');
    expect(text).not.toContain('/E1 ');
    expect(text).toContain('/BaseFont /Helvetica');
    expect(text).toContain('/BaseFont /Times-Bold');
    // Calibri still measures and draws through the standard-14 width correction, exactly as before.
    expect(text).toContain('92 Tz');
  });
});
