// The named border weights Excel's own formats quantise a stroke width to, and the bucketing between them and ContentBorder's continuous `widthPt`. ContentBorderSchema models a border as a real point width crossed with a ContentStrokeStyle pattern; xlsx's CT_BorderStyle (ECMA-376 Part 1 SS18.18.3) and BIFF8's BorderStyle enumeration ([MS-XLS] 2.4.353) both instead conflate pattern and weight into one token drawn from a fixed vocabulary, so a codec for either has to map between the two -- in both directions, and identically, or a border read through one codec and written through the other changes weight in transit.
//
// This is the canonical home for that mapping. It lived twice before -- once in ooxml.js's typed/xlsx/styles.ts for xlsx's string tokens, once in xls-codec's biff/xf-colors.ts for BIFF8's numeric ones -- as two hand-maintained copies of the identical constants with nothing tying them together, which is exactly the divergence hazard excel-number-format was extracted to close for the number-format mini-language these same two formats also share. It sits here rather than in either codec because document-schema.js is the one layer both already depend on, and because the quantity being quantised (ContentBorder.widthPt) is this package's own.
//
// What stays with each codec is its own token vocabulary: which style token names a dashed medium stroke is an xlsx or BIFF8 question, and neither package's table of those belongs here.

// Excel's own documented convention renders each named weight at a fixed pixel count at 96 DPI (1px = 0.75pt): hair is sub-pixel (rendered thinner than thin), thin is 1px, medium is 2px, thick is 3px. These derived point widths are the honest inverse of that convention -- named constants with a stated derivation, not arbitrary numbers.
export const BORDER_WIDTH_PT = {
  hair: 0.5,
  thin: 0.75,
  medium: 1.5,
  thick: 2.25,
} as const;

export type BorderWeight = keyof typeof BORDER_WIDTH_PT;

// The width-bucket midpoints between the four named weights -- (hair+thin)/2, (thin+medium)/2, (medium+thick)/2 -- so a ContentBorder whose widthPt came from BORDER_WIDTH_PT above buckets back to the same named weight. A width exactly on a midpoint falls into the heavier bucket, which is the same tie-break Excel's own rendering implies.
const BORDER_WEIGHT_UPPER_PT = {
  hair: 0.625,
  thin: 1.125,
  medium: 1.875,
} as const;

// The named weight a border's own widthPt quantises to, for a format whose vocabulary offers all four. The exact inverse of BORDER_WIDTH_PT for any width that came from it, and the closest named weight for any other.
export function borderWeightForWidthPt(widthPt: number): BorderWeight {
  if (widthPt < BORDER_WEIGHT_UPPER_PT.hair) {
    return "hair";
  }
  if (widthPt < BORDER_WEIGHT_UPPER_PT.thin) {
    return "thin";
  }
  if (widthPt < BORDER_WEIGHT_UPPER_PT.medium) {
    return "medium";
  }
  return "thick";
}

// The narrower two-way bucketing a DASHED border quantises to. Both xlsx and BIFF8 name only two dashed tokens -- a plain one and a medium one -- with no hair or thick dashed spelling at all, so a dashed border's own width picks between those two at the thin/medium boundary rather than through the four-way split above. Returning the weight rather than a boolean keeps the answer in the same vocabulary as borderWeightForWidthPt, so a caller maps weight to token in one place.
export function dashedBorderWeightForWidthPt(
  widthPt: number,
): Extract<BorderWeight, "thin" | "medium"> {
  return widthPt >= BORDER_WEIGHT_UPPER_PT.thin ? "medium" : "thin";
}
