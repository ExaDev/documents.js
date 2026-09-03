import { uint16At } from "../bytes/view";
import { pointsFromWpu } from "./units";

// -- Page geometry, per WPFF "D1 Page Functions" and "D2 Column Functions" --
//
// A WordPerfect document's page setup is not one record: the four margins and the paper form are four independent functions in two groups, each stating one number and each taking effect from where it sits in the stream onwards. The vertical pair lives in the Page group ("The Page Group subfunctions have page orientation"), and the horizontal pair lives in the Column group ("The Column Group subfunctions have column orientation") -- a left or right margin is a column-oriented fact in this format, because text columns subdivide the space those margins bound.
//
// https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D1-Page.htm https://github.com/OneWingedShark/WordPerfect/blob/master/doc/SDK_Help/FileFormats/WPFF_D2-Column.htm

export const PAGE_GROUP = 0xd1;
export const COLUMN_GROUP = 0xd2;

// "<209 (0xD1)> <0 (0x00)> ... [top margin (WPU)] distance from top edge of paper to text".
export const PAGE_TOP_MARGIN_SET = 0x00;
// "<209 (0xD1)> <1 (0x01)> ... [bottom margin (WPU)] distance from bottom edge of paper to text (WPU)".
export const PAGE_BOTTOM_MARGIN_SET = 0x01;
// "<209 (0xD1)> <17 (0x11)>", the Form function: which paper this page is printed on.
export const PAGE_FORM = 0x11;

// "<210 (0xD2)> <0 (0x00)> ... [left margin (WPU)] distance from left edge of paper to text".
export const COLUMN_LEFT_MARGIN_SET = 0x00;
// "<210 (0xD2)> <1 (0x01)> ... [right margin (WPU)] distance from right edge of paper to text".
export const COLUMN_RIGHT_MARGIN_SET = 0x01;

// WordPerfect's own default page for a US-English installation: US Letter with a one-inch margin on every side. Used only for a dimension the document itself never states -- each of the five is replaced independently the moment its own function appears, so a document that overrides only its top margin keeps Letter and the other three inches rather than falling back to the whole default set.
export const DEFAULT_PAGE_WIDTH_PT = 612;
export const DEFAULT_PAGE_HEIGHT_PT = 792;
export const DEFAULT_MARGIN_PT = 72;

// The Form function's non-deletable data, whose "[size of non-deletable information = 82]" the field list below accounts for exactly: <matched form hash table index> 1, [matched form hash value] 2, [desired length (WPU)] 2, [desired width (WPU)] 2, <type> 1, <orientation> 1, <type name length> 1, [type name] x 36 = 72. One through eighty-two, with no slack -- which is what pins these offsets without a real file to check them against.
const FORM_DESIRED_LENGTH_OFFSET = 3;
const FORM_DESIRED_WIDTH_OFFSET = 5;
const FORM_ORIENTATION_OFFSET = 8;
const FORM_NON_DELETABLE_SIZE = 82;

// "<orientation> 0 = portrait, 1 = landscape".
const FORM_ORIENTATION_LANDSCAPE = 1;

export interface WpdPageForm {
  readonly widthPt: number;
  readonly heightPt: number;
  // The orientation byte, reported rather than applied. The SDK states the form's desired width and its desired length as two independent fields and the orientation as a third, and says nothing about whether the pair is stated before or after the rotation -- so rotating the two numbers here would be this package's inference, not the file's statement. PageSize carries no orientation of its own, so the two dimensions go through exactly as written and a landscape form is reported through the diagnostic sink instead.
  readonly landscape: boolean;
}

// Reads the Form function's page dimensions. Returns undefined when the function's non-deletable data is shorter than the eighty-two bytes its own field list occupies, or when either dimension is zero -- a form with no size is missing information, not a zero-sized page.
export function readPageForm(
  nonDeletable: Uint8Array,
): WpdPageForm | undefined {
  if (nonDeletable.length < FORM_NON_DELETABLE_SIZE) {
    return undefined;
  }
  const lengthWpu = uint16At(nonDeletable, FORM_DESIRED_LENGTH_OFFSET);
  const widthWpu = uint16At(nonDeletable, FORM_DESIRED_WIDTH_OFFSET);
  if (lengthWpu <= 0 || widthWpu <= 0) {
    return undefined;
  }
  return {
    widthPt: pointsFromWpu(widthWpu),
    heightPt: pointsFromWpu(lengthWpu),
    landscape:
      nonDeletable[FORM_ORIENTATION_OFFSET] === FORM_ORIENTATION_LANDSCAPE,
  };
}

// Reads a margin function's single "[size of non-deletable information = 2]" word. All four margin functions share this one shape, so one reader serves the Page group's vertical pair and the Column group's horizontal pair alike.
export function readMarginPt(nonDeletable: Uint8Array): number | undefined {
  if (nonDeletable.length < 2) {
    return undefined;
  }
  return pointsFromWpu(uint16At(nonDeletable, 0));
}
