import { describe, expect, it } from "vitest";
import { parseMathTable } from "./math-table";
import type { SfntFont } from "./sfnt";
import { parseSfnt } from "./sfnt";

// A minimal but structurally real 'MATH' table (Microsoft OpenType MATH spec), built field-by-field the same way cmap-table.test.ts's own buildFontWithCmapSubtable builds a synthetic 'cmap' — not mocked, so every one of these tests genuinely exercises math-table.ts's real byte-level parsing rather than a stand-in. Layout, in order: the 10-byte MATH header; a zero-filled MathConstants subtable (every MathValueRecord at 0 is a legitimate, if degenerate, font); a zero-filled MathGlyphInfo subtable (both its own coverage offsets 0, meaning neither italics-correction nor top-accent data); then, only when `variants` is given, a MathVariants subtable built from the caller's own per-axis coverage/construction description.
const HEADER_SIZE = 10;
const CONSTANTS_SIZE = 8 + 51 * 4 + 2; // MATH_VALUE_RECORDS_START + 51 MathValueRecords + the trailing percent field
const GLYPH_INFO_SIZE = 4; // two Offset16 fields (italics, top-accent), both left 0
const VARIANTS_HEADER_SIZE = 10; // minConnectorOverlap + two coverage Offset16s + two counts

interface AxisVariantsFixture {
  // Raw bytes for this axis's own Coverage table (already in final on-disk form), or undefined for an axis with no coverage at all (coverageOffset 0).
  readonly coverage?: Uint8Array<ArrayBuffer>;
  // One MathGlyphConstruction per coverage-array slot, in slot order — each just a variant list, no assembly, which is all these tests need to prove an entry was (or wasn't) resolved.
  readonly constructions: readonly { glyphId: number; advance: number }[];
  // The real construction-ARRAY length recorded in the header (MathVariantCount) — deliberately allowed to differ from `constructions.length` so a test can under-declare it and prove the out-of-range slots this axis's own coverage table still names are skipped rather than read.
  readonly declaredCount: number;
}

function buildMathBytes(
  minConnectorOverlap: number,
  vertical: AxisVariantsFixture | undefined,
  horizontal: AxisVariantsFixture | undefined,
): Uint8Array<ArrayBuffer> {
  const variantsOffset = HEADER_SIZE + CONSTANTS_SIZE + GLYPH_INFO_SIZE;
  // The real parser computes each axis's own construction-array position structurally (immediately after the header, vertical then horizontal — see parseMathVariants's own verticalArrayOffset/horizontalArrayOffset), never from a stored field, so this builder must lay them out the identical way rather than wherever it happens to place other content.
  const verticalCount = vertical?.declaredCount ?? 0;
  const horizontalCount = horizontal?.declaredCount ?? 0;
  const verticalArrayOffset = variantsOffset + VARIANTS_HEADER_SIZE;
  const horizontalArrayOffset = verticalArrayOffset + verticalCount * 2;
  const chunks: { offset: number; bytes: Uint8Array<ArrayBuffer> }[] = [];
  let cursor = horizontalArrayOffset + horizontalCount * 2;

  function place(bytes: Uint8Array<ArrayBuffer>): number {
    const offset = cursor;
    chunks.push({ offset, bytes });
    cursor += bytes.length;
    return offset - variantsOffset; // every stored offset in a MathVariants subtable is relative to its own start
  }

  function placeAxis(
    axis: AxisVariantsFixture | undefined,
    arrayOffset: number,
  ): { coverageOffset: number } {
    if (axis === undefined) {
      return { coverageOffset: 0 };
    }
    const constructionOffsets = axis.constructions.map((construction) => {
      const table = new Uint8Array(4 + 4);
      const view = new DataView(table.buffer);
      view.setUint16(0, 0); // assemblyOffset: none
      view.setUint16(2, 1); // variantCount
      view.setUint16(4, construction.glyphId);
      view.setUint16(6, construction.advance);
      return place(table);
    });
    const array = new Uint8Array(axis.declaredCount * 2);
    const arrayView = new DataView(array.buffer);
    constructionOffsets.forEach((relativeOffset, index) => {
      if (index < axis.declaredCount) {
        arrayView.setUint16(index * 2, relativeOffset);
      }
    });
    chunks.push({ offset: arrayOffset, bytes: array });
    const coverageOffset =
      axis.coverage === undefined ? 0 : place(axis.coverage);
    return { coverageOffset };
  }

  const verticalPlacement = placeAxis(vertical, verticalArrayOffset);
  const horizontalPlacement = placeAxis(horizontal, horizontalArrayOffset);

  const total = new Uint8Array(cursor);
  const view = new DataView(total.buffer);
  view.setUint16(0, 1); // majorVersion
  view.setUint16(2, 0); // minorVersion
  view.setUint16(4, HEADER_SIZE); // mathConstantsOffset
  view.setUint16(6, HEADER_SIZE + CONSTANTS_SIZE); // mathGlyphInfoOffset
  view.setUint16(8, variantsOffset); // mathVariantsOffset
  view.setUint16(variantsOffset + 0, minConnectorOverlap);
  view.setUint16(variantsOffset + 2, verticalPlacement.coverageOffset);
  view.setUint16(variantsOffset + 4, horizontalPlacement.coverageOffset);
  view.setUint16(variantsOffset + 6, verticalCount);
  view.setUint16(variantsOffset + 8, horizontalCount);
  for (const chunk of chunks) {
    total.set(chunk.bytes, chunk.offset);
  }
  return total;
}

function buildMathBytesWithNoVariantsTable(): Uint8Array<ArrayBuffer> {
  const total = new Uint8Array(HEADER_SIZE + CONSTANTS_SIZE + GLYPH_INFO_SIZE);
  const view = new DataView(total.buffer);
  view.setUint16(0, 1);
  view.setUint16(2, 0);
  view.setUint16(4, HEADER_SIZE);
  view.setUint16(6, HEADER_SIZE + CONSTANTS_SIZE);
  view.setUint16(8, 0); // mathVariantsOffset: this font declares no MathVariants subtable at all
  return total;
}

// Format 1 Coverage (ot-layout-common.ts): a plain ascending glyph-ID list, each glyph's own position in it being its coverage index.
function format1Coverage(glyphIds: readonly number[]): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(4 + glyphIds.length * 2);
  const view = new DataView(table.buffer);
  view.setUint16(0, 1); // format
  view.setUint16(2, glyphIds.length); // glyphCount
  glyphIds.forEach((glyphId, index) => {
    view.setUint16(4 + index * 2, glyphId);
  });
  return table;
}

function buildFontWithMathTable(mathBytes: Uint8Array<ArrayBuffer>): SfntFont {
  const DIRECTORY_SIZE = 12 + 16;
  const font = new Uint8Array(DIRECTORY_SIZE + mathBytes.length);
  const view = new DataView(font.buffer);
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1); // numTables
  font.set(Uint8Array.from([0x4d, 0x41, 0x54, 0x48]), 12); // 'MATH'
  view.setUint32(12 + 8, DIRECTORY_SIZE);
  view.setUint32(12 + 12, mathBytes.length);
  font.set(mathBytes, DIRECTORY_SIZE);
  const parsed = parseSfnt(font);
  if (parsed === undefined) {
    throw new Error("synthetic font failed to parse as an sfnt container");
  }
  return parsed;
}

describe("parseMathTable against synthetic MATH tables", () => {
  it("throws its own exact message when the font has no MATH table at all", () => {
    const font: SfntFont = { bytes: new Uint8Array(0), tables: new Map() };
    expect(() => parseMathTable(font)).toThrow("math font has no MATH table");
  });

  it("reports empty vertical and horizontal maps for a font that declares no MathVariants subtable", () => {
    const font = buildFontWithMathTable(buildMathBytesWithNoVariantsTable());
    const math = parseMathTable(font);
    expect(math.variants).toEqual({
      minConnectorOverlap: 0,
      vertical: new Map(),
      horizontal: new Map(),
    });
  });

  it("leaves an axis with no coverage table empty while its sibling axis still resolves normally", () => {
    // The vertical axis carries real coverage; the horizontal axis's own coverageOffset is 0. minConnectorOverlap is deliberately 1 (a Coverage table's own format 1) — reading from the MathVariants subtable's own start (what a mutant that dropped this guard would do for a 0 coverageOffset) means byte 2 of that misread header is the VERTICAL axis's own (nonzero) coverageOffset field, read instead as a bogus glyph count. This is what proves the guard is load-bearing rather than a dead branch: without it, the horizontal axis would resolve extra, wrong entries from that misread instead of staying empty.
    const font = buildFontWithMathTable(
      buildMathBytes(
        1,
        {
          coverage: format1Coverage([40]),
          constructions: [{ glyphId: 41, advance: 111 }],
          declaredCount: 1,
        },
        undefined,
      ),
    );
    const math = parseMathTable(font);
    expect(math.variants.horizontal.size).toBe(0);
    expect(math.variants.vertical.get(40)).toEqual({
      variants: [{ glyphId: 41, advanceMeasurement: 111 }],
    });
  });

  it("skips a coverage entry whose index falls beyond the construction array's own declared length", () => {
    // Two glyphs (50, 51) covered at indices 0 and 1, but the construction array declares a length of only 1 — index 1 names a slot the array was never given, and must be skipped rather than read past the array's own end.
    const font = buildFontWithMathTable(
      buildMathBytes(0, undefined, {
        coverage: format1Coverage([50, 51]),
        constructions: [{ glyphId: 60, advance: 222 }],
        declaredCount: 1,
      }),
    );
    const math = parseMathTable(font);
    expect(math.variants.horizontal.has(50)).toBe(true);
    expect(math.variants.horizontal.has(51)).toBe(false);
    expect(math.variants.horizontal.size).toBe(1);
  });
});
