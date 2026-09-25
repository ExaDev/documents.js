import { concatBytes, writeAtom } from "../record/write";
import { RT_ColorSchemeAtom } from "../record/types";

// The SlideSchemeColorSchemeAtom every slide-shaped container is required to carry. Its own module rather than a private helper of one of them because [MS-PPT] gives the identical record to four different containers — 2.9.51 is "Referenced by: HandoutContainer, MainMasterContainer, NotesContainer, SlideContainer" — and this package writes two of them (the main master and each notes slide), so neither owns it. [MS-PPT] 2.9.51 SlideSchemeColorSchemeAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/9cfca750-dabb-4967-b133-2583a9f8c392

// [MS-PPT] 2.9.51: rgSchemeColor is "an array of ColorStruct structures... The count of items in this array MUST be 8", each four bytes of red/green/blue/unused, giving the mandated rh.recLen of 0x00000020. The eight slots are, in the spec's own order (2.12.2 ColorIndexStruct's own index table, which this same order matches slot for slot), background, text, shadow, title text, fill, Accent 1, Accent 2 and Accent 3 — PowerPoint's own default light scheme, since this writer has no scheme of its own to state.
//
// Each slot's own red/green/blue named separately from its tuple, since @typescript-eslint/no-magic-numbers checks an array literal's own elements independently of the array they compose.
const BACKGROUND_RGB = 0xff;
const SHADOW_RGB = 0x80;
const FILL_RED = 0xbb;
const FILL_GREEN = 0xe0;
const FILL_BLUE = 0xe3;
const ACCENT_1_RED = 0x33;
const ACCENT_1_GREEN = 0x33;
const ACCENT_1_BLUE = 0x99;
const ACCENT_2_BLUE = 0xcc;
const ACCENT_3_RED = 0x80;
const ACCENT_3_BLUE = 0x80;
const DEFAULT_SCHEME_COLORS: readonly (readonly [number, number, number])[] = [
  [BACKGROUND_RGB, BACKGROUND_RGB, BACKGROUND_RGB], // background
  [0x00, 0x00, 0x00], // text
  [SHADOW_RGB, SHADOW_RGB, SHADOW_RGB], // shadow
  [0x00, 0x00, 0x00], // title text
  [FILL_RED, FILL_GREEN, FILL_BLUE], // fill
  [ACCENT_1_RED, ACCENT_1_GREEN, ACCENT_1_BLUE], // Accent 1
  [0x00, 0x00, ACCENT_2_BLUE], // Accent 2
  [ACCENT_3_RED, 0x00, ACCENT_3_BLUE], // Accent 3
];

// [MS-PPT] 2.9.51: rh.recVer MUST be 0x0 (writeAtom's own default) and rh.recInstance MUST be 0x001, which is what tells this record apart from the SchemeListElementColorSchemeAtom sharing its RT_ColorSchemeAtom type.
const SLIDE_SCHEME_REC_INSTANCE = 0x001;

export function writeSlideSchemeColorSchemeAtom(): Uint8Array<ArrayBuffer> {
  return writeAtom(
    RT_ColorSchemeAtom,
    concatBytes(
      ...DEFAULT_SCHEME_COLORS.map(
        ([red, green, blue]) => new Uint8Array([red, green, blue, 0]),
      ),
    ),
    { recInstance: SLIDE_SCHEME_REC_INSTANCE },
  );
}
