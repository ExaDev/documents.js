import {
  coreFaceTextsOfNumberedGlyphs,
  coreFaceTextsOfType3Glyphs,
} from "./core-font-glyph-orders";
import type { PdfObjectResolver } from "./interpret-types";
import type { PdfDict } from "./objects";
import { asArray, asName, asNumber, dictGet } from "./objects";

const THOUSANDTHS_PER_TEXT_SPACE_UNIT = 1000;

// A Type 3 font's /Widths are in its own glyph space, which its /FontMatrix maps to text space (ISO 32000-1 9.6.5), where other simple fonts' widths are already thousandths of text space. The factor taking a Type 3 width to those thousandths, for a matrix that neither rotates nor skews a glyph, so that a width is a horizontal distance alone; `undefined` for a font with no such matrix.
function type3WidthScale(
  fontDict: PdfDict,
  resolver: Readonly<PdfObjectResolver>,
): number | undefined {
  const matrix = asArray(
    resolver.resolve(dictGet(fontDict, "FontMatrix")),
  )?.map((entry) => asNumber(resolver.resolve(entry)));
  const [a, b, c] = matrix ?? [];
  return a === undefined || b !== 0 || c !== 0
    ? undefined
    : a * THOUSANDTHS_PER_TEXT_SPACE_UNIT;
}

/**
 * What the core face a simple font's numbered glyph names follow draws at each of them: through the face a CFF subset's `/BaseFont` spells for `G<id>` names (`coreFaceTextsOfNumberedGlyphs`), or, for a Type 3 font, which has no `/BaseFont` or program to name a face, through the face its widths alone identify for `c<id>` names (`coreFaceTextsOfType3Glyphs`).
 * @param fontDict - The font dictionary.
 * @param baseFont - Its `/BaseFont`.
 * @param differences - The glyph name its `/Differences` array gives each code.
 * @param widthOf - The width its `/Widths` gives a code, in the font's own units (glyph space for a Type 3 font, thousandths of text space for any other).
 * @param resolver - Resolves an indirect object.
 * @returns The character each numbered glyph name draws, or `undefined` when no core face is taken for the font.
 */
export function coreFaceTextsOfDifferences(
  fontDict: PdfDict,
  baseFont: string,
  differences: ReadonlyMap<number, string>,
  widthOf: (code: number) => number,
  resolver: Readonly<PdfObjectResolver>,
): ReadonlyMap<string, string> | undefined {
  const glyphsScaledBy = (scale: number) =>
    [...differences].map(([code, name]) => ({
      name,
      width: widthOf(code) * scale,
    }));
  if (asName(dictGet(fontDict, "Subtype")) !== "Type3") {
    return coreFaceTextsOfNumberedGlyphs(baseFont, glyphsScaledBy(1));
  }
  const scale = type3WidthScale(fontDict, resolver);
  return scale === undefined
    ? undefined
    : coreFaceTextsOfType3Glyphs(glyphsScaledBy(scale));
}
