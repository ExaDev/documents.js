// -- WordPerfect's units of measure, per WPFF Document Structure, "Units of Measure" --
//
// "WPU stands for WordPerfect Unit, which is one 1200th of an inch. Dimensions are usually given in WordPerfect Units." Every length the shared content schema carries is a PostScript point, one 72nd of an inch, so the conversion is exact: a WPU is 72/1200 of a point, or 3/50.
//
// Font sizes are the one dimension WordPerfect does NOT state in WPU -- "Font point sizes are given in 3600ths of an inch", per the same glossary -- so that divisor lives beside the Font Size Change function that uses it rather than here.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_DocumentStructure.htm

export const WPU_PER_INCH = 1200;
export const POINTS_PER_INCH = 72;

export function pointsFromWpu(wpu: number): number {
  return (wpu * POINTS_PER_INCH) / WPU_PER_INCH;
}
