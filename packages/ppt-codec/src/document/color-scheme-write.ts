import { concatBytes, writeAtom } from "../record/write";
import { RT_ColorSchemeAtom } from "../record/types";

// The SlideSchemeColorSchemeAtom every slide-shaped container is required to carry. Its own module rather than a private helper of one of them because [MS-PPT] gives the identical record to four different containers -- 2.9.51 is "Referenced by: HandoutContainer, MainMasterContainer, NotesContainer, SlideContainer" -- and this package writes two of them (the main master and each notes slide), so neither owns it. [MS-PPT] 2.9.51 SlideSchemeColorSchemeAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/9cfca750-dabb-4967-b133-2583a9f8c392

// [MS-PPT] 2.9.51: rgSchemeColor is "an array of ColorStruct structures... The count of items in this array MUST be 8", each four bytes of red/green/blue/unused, giving the mandated rh.recLen of 0x00000020. The eight slots are, in the spec's own order (2.12.2 ColorIndexStruct's own index table, which this same order matches slot for slot), background, text, shadow, title text, fill, Accent 1, Accent 2 and Accent 3 -- PowerPoint's own default light scheme, since this writer has no scheme of its own to state.
const DEFAULT_SCHEME_COLORS: readonly (readonly [number, number, number])[] = [
  [0xff, 0xff, 0xff], // background
  [0x00, 0x00, 0x00], // text
  [0x80, 0x80, 0x80], // shadow
  [0x00, 0x00, 0x00], // title text
  [0xbb, 0xe0, 0xe3], // fill
  [0x33, 0x33, 0x99], // Accent 1
  [0x00, 0x00, 0xcc], // Accent 2
  [0x80, 0x00, 0x80], // Accent 3
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
