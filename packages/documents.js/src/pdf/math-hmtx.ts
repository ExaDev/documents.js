import type { SfntFont } from './sfnt';
import { sfntTableBytes, u16 } from './sfnt';

// A glyph ID -> advance width (design units) lookup built from a font's own 'hmtx' table (ISO/IEC 14496-22 clause 5.2.4), sized against 'hhea's own numberOfHMetrics (clause 5.2.3): every glyph ID at or beyond that count reuses the LAST explicit entry's width (the standard sfnt convention for a font whose trailing glyphs -- typically composites/marks with no independent advance -- share one common width, saving table space).
export interface HmtxTable {
  advanceWidth(glyphId: number): number;
}

export function parseHmtx(font: SfntFont): HmtxTable {
  const hheaBytes = sfntTableBytes(font, 'hhea');
  const hmtxBytes = sfntTableBytes(font, 'hmtx');
  if (hheaBytes === undefined || hmtxBytes === undefined) {
    throw new Error('math font has no hhea/hmtx table');
  }
  const numberOfHMetrics = u16(hheaBytes, 34);
  if (numberOfHMetrics === 0) {
    throw new Error('math font hhea numberOfHMetrics is zero');
  }
  const lastWidth = u16(hmtxBytes, (numberOfHMetrics - 1) * 4);

  return {
    advanceWidth(glyphId: number): number {
      if (glyphId < numberOfHMetrics) {
        return u16(hmtxBytes, glyphId * 4);
      }
      return lastWidth;
    },
  };
}
