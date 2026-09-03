import {
  concatBytes,
  i32le,
  u32le,
  writeAtom,
  writeContainer,
} from "../record/write";
import {
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  SLIDE_LIST_INSTANCE_SLIDES,
} from "../record/types";

// The write-side mirror of document/slide-list.ts's readSlideListWithText, narrowed to what this writer actually needs: one SlidePersistAtom per slide, naming that slide's persist reference and slide id, with no placeholder texts. Every shape this writer emits carries its own text directly on its OfficeArtClientTextbox (drawing/shapes-write.ts) rather than through the OutlineTextRefAtom indirection into this list -- so cTexts is always 0, and readSlideListWithText's own text-grouping loop (which only fires on a TextHeaderAtom appearing in this container) never finds one. [MS-PPT] 2.4.14.3 SlideListWithTextContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/307e6d12-7304-47a8-acbd-3e7b8041ad3c [MS-PPT] 2.4.14.5 SlidePersistAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/48dce412-9692-4f93-aeb7-3d9fdd3a0a5a

export interface SlidePersistRef {
  readonly persistIdRef: number;
  readonly slideId: number;
}

function writeSlidePersistAtom(ref: SlidePersistRef): Uint8Array<ArrayBuffer> {
  return writeAtom(
    RT_SlidePersistAtom,
    concatBytes(
      u32le(ref.persistIdRef),
      u32le(0), // fShouldCollapse/fNonOutlineData flags -- never set by this writer
      i32le(0), // cTexts -- always 0, see the module comment
      u32le(ref.slideId),
      u32le(0), // reserved
    ),
  );
}

export function writeSlideListWithText(
  slides: readonly SlidePersistRef[],
): Uint8Array<ArrayBuffer> {
  return writeContainer(
    RT_SlideListWithText,
    slides.map(writeSlidePersistAtom),
    { recInstance: SLIDE_LIST_INSTANCE_SLIDES },
  );
}
