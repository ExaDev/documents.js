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
  // Read through a DataView rather than indexing `data` directly: the length check above already guarantees every slot's three bytes fall within bounds (max index 28+2 = 30 < 32), so a getUint8 call -- which never returns undefined, only throws on a genuinely out-of-range offset -- states that invariant in a form the type checker can see, rather than a defensive `undefined` guard on an index that can never actually be missing.
  const { data } = record;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const colors: RgbColor[] = [];
  for (let slot = 0; slot < COLOR_SCHEME_SLOT_COUNT; slot += 1) {
    const at = slot * COLOR_STRUCT_SIZE;
    colors.push({
      red: view.getUint8(at),
      green: view.getUint8(at + 1),
      blue: view.getUint8(at + 2),
    });
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

// The SlideSchemeColorSchemeAtom among a container's children, matched on the recInstance that is the record's only distinguishing mark -- a real producer's slide-shaped containers carry further RT_ColorSchemeAtom records alongside it (LibreOffice 26.2.5.2's own main master opens with a run of recInstance 0x006 extra colour schemes ahead of the real one, confirmed by inspecting its raw bytes), so a lookup keyed on the record type alone finds whichever of those happened to come first. readSlideSchemeColorSchemeAtom would then reject that record for its instance, failing a whole file over a lookup that picked the wrong sibling; finding by both fields keeps the failure for a container that genuinely states no scheme of its own, which is the malformed case.
export function findSlideSchemeColorSchemeAtom(
  records: readonly PptRecord[],
): PptRecord | undefined {
  return records.find(
    (record) =>
      record.header.recType === RT_ColorSchemeAtom &&
      record.header.recInstance === SLIDE_SCHEME_REC_INSTANCE,
  );
}
