import { PptFormatError } from "../errors";
import { type PptRecord } from "../record/tree";
import { RT_ColorSchemeAtom } from "../record/types";
import { COLOR_SCHEME_SLOT_COUNT, type RgbColor } from "../text/style";

// SlideSchemeColorSchemeAtom, the read-side mirror of color-scheme-write.ts's own writeSlideSchemeColorSchemeAtom -- see that file's own top comment for why the record is shared across HandoutContainer/MainMasterContainer/NotesContainer/SlideContainer rather than owned by any one of them. [MS-PPT] 2.9.51: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/9cfca750-dabb-4967-b133-2583a9f8c392
//
// Every slide-shaped container is spec-mandated to carry its own complete instance of this atom -- confirmed against Apache POI's Slide.java, whose own from-scratch constructor synthesizes one rather than leaving it to a master fallback. A slide that visually "follows the master's scheme" (SlideFlags.fMasterScheme) does so by a real producer duplicating the master's own RGB values into its own atom, not by omitting one -- so resolving a ColorIndexStruct's scheme index never needs to walk up to a master the way master-style text-formatting resolution does.

// [MS-PPT] 2.9.51: rh.recVer MUST be 0x0 and rh.recInstance MUST be 0x001, distinguishing this from the SchemeListElementColorSchemeAtom that shares RT_ColorSchemeAtom.
const SLIDE_SCHEME_REC_INSTANCE = 0x001;
// Four bytes (red, green, blue, unused) per scheme slot.
const COLOR_STRUCT_SIZE = 4;

export function readSlideSchemeColorSchemeAtom(
  record: PptRecord,
): readonly RgbColor[] {
  if (record.header.recType !== RT_ColorSchemeAtom) {
    throw new PptFormatError(
      `expected RT_ColorSchemeAtom (0x${RT_ColorSchemeAtom.toString(16)}) at offset ${record.offset}, found record type 0x${record.header.recType.toString(16)}`,
    );
  }
  if (record.header.recInstance !== SLIDE_SCHEME_REC_INSTANCE) {
    throw new PptFormatError(
      `ColorSchemeAtom at offset ${record.offset} declares recInstance 0x${record.header.recInstance.toString(16)}, not the SlideSchemeColorSchemeAtom's own 0x${SLIDE_SCHEME_REC_INSTANCE.toString(16)}`,
    );
  }
  const expectedLength = COLOR_SCHEME_SLOT_COUNT * COLOR_STRUCT_SIZE;
  if (record.data.length !== expectedLength) {
    throw new PptFormatError(
      `SlideSchemeColorSchemeAtom at offset ${record.offset} carries ${record.data.length} bytes, not the mandated ${expectedLength} (${COLOR_SCHEME_SLOT_COUNT} four-byte scheme slots)`,
    );
  }
  const { data } = record;
  const colors: RgbColor[] = [];
  for (let slot = 0; slot < COLOR_SCHEME_SLOT_COUNT; slot += 1) {
    const at = slot * COLOR_STRUCT_SIZE;
    const red = data[at];
    const green = data[at + 1];
    const blue = data[at + 2];
    if (red === undefined || green === undefined || blue === undefined) {
      throw new PptFormatError(
        `SlideSchemeColorSchemeAtom slot ${slot} at offset ${record.offset + at} is missing bytes`,
      );
    }
    colors.push({ red, green, blue });
  }
  return colors;
}

/** Resolves a scheme-slot index (0-7, see text/style.ts's own ColorIndexStruct table) against a resolved 8-entry colour scheme. Throws rather than returning undefined for an out-of-range index: readColorIndexStruct already rejects any index outside 0x00-0x07/0xFE/0xFF at parse time, so a RunColor of kind "scheme" reaching this function always carries a genuinely valid slot. */
export function resolveSchemeColor(
  schemeIndex: number,
  colorScheme: readonly RgbColor[],
): RgbColor {
  const color = colorScheme[schemeIndex];
  if (color === undefined) {
    throw new PptFormatError(
      `colour scheme slot ${schemeIndex} has no entry in a ${colorScheme.length}-entry colour scheme`,
    );
  }
  return color;
}
