import type { SfntFont } from "./sfnt";
import { sfntTableBytes, u16 } from "./sfnt";

// A glyph ID -> advance width (design units) lookup built from a font's own 'hmtx' table (ISO/IEC 14496-22 clause 5.2.4), sized against 'hhea's own numberOfHMetrics (clause 5.2.3): every glyph ID at or beyond that count reuses the LAST explicit entry's width (the standard sfnt convention for a font whose trailing glyphs — typically composites/marks with no independent advance — share one common width, saving table space).
export interface HmtxTable {
  advanceWidth: (glyphId: number) => number;
}

// Byte offset of 'hhea's own numberOfHMetrics field (ISO/IEC 14496-22 clause 5.2.3, Table 7): a uint16 following the table's fixed-size version/ascender/descender/lineGap/... run of metrics and four reserved int16 fields.
const HHEA_NUMBER_OF_H_METRICS_OFFSET = 34;

// Size in bytes of one 'hmtx' longHorMetric record (ISO/IEC 14496-22 clause 5.2.4): a uint16 advanceWidth followed by an int16 left side bearing.
const HMTX_LONG_HOR_METRIC_SIZE_BYTES = 4;

export function parseHmtx(font: SfntFont): HmtxTable {
  const hheaBytes = sfntTableBytes(font, "hhea");
  const hmtxBytes = sfntTableBytes(font, "hmtx");
  if (hheaBytes === undefined || hmtxBytes === undefined) {
    throw new Error("font has no hhea/hmtx table");
  }
  const numberOfHMetrics = u16(hheaBytes, HHEA_NUMBER_OF_H_METRICS_OFFSET);
  if (numberOfHMetrics === 0) {
    throw new Error("font hhea numberOfHMetrics is zero");
  }
  const lastWidth = u16(
    hmtxBytes,
    (numberOfHMetrics - 1) * HMTX_LONG_HOR_METRIC_SIZE_BYTES,
  );

  return {
    advanceWidth(glyphId: number): number {
      if (glyphId < numberOfHMetrics) {
        return u16(hmtxBytes, glyphId * HMTX_LONG_HOR_METRIC_SIZE_BYTES);
      }
      return lastWidth;
    },
  };
}
