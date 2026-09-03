import { PptFormatError } from "../errors";
import { type PptRecord, childRecords } from "../record/tree";
import {
  RT_SlideListWithText,
  RT_SlidePersistAtom,
  RT_TextHeaderAtom,
} from "../record/types";
import { readTextHeaderAtom } from "../text/atoms";

// SlideListWithTextContainer: the document's list of presentation slides, and -- for placeholder text specifically -- the text itself. A slide's title and body text are stored here rather than in the slide, and the slide's own shape points back at this list through an OutlineTextRefAtom; a reader that only walked slide drawings would find those shapes empty. [MS-PPT] 2.4.14.3: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/307e6d12-7304-47a8-acbd-3e7b8041ad3c [MS-PPT] 2.4.14.5 SlidePersistAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/48dce412-9692-4f93-aeb7-3d9fdd3a0a5a

// [MS-PPT] 2.4.14.5: "rh.recLen MUST be 0x00000014."
const SLIDE_PERSIST_ATOM_LEN = 0x00000014;

// One text body from the list: its TextHeaderAtom's type, plus every record the grammar attaches to that header -- the text atom itself, its StyleTextPropAtom, and the metacharacter/bookmark/special-info records following them.
export interface OutlineText {
  readonly textType: number;
  readonly records: readonly PptRecord[];
}

export interface SlidePersist {
  readonly persistIdRef: number;
  readonly slideId: number;
  // The i-th entry is what an OutlineTextRefAtom with index i on this slide refers to.
  readonly texts: readonly OutlineText[];
}

interface MutableSlidePersist {
  readonly persistIdRef: number;
  readonly slideId: number;
  readonly texts: { textType: number; records: PptRecord[] }[];
}

// Reads the list's slides and their placeholder texts. The container's grammar is positional rather than nested -- a SlidePersistAtom opens a slide, a TextHeaderAtom opens a text, and everything after one belongs to it until the next opener -- so this is a single pass with two current-item cursors rather than a tree walk.
export function readSlideListWithText(
  listContainer: PptRecord,
): SlidePersist[] {
  if (listContainer.header.recType !== RT_SlideListWithText) {
    throw new PptFormatError(
      `expected RT_SlideListWithText (0x${RT_SlideListWithText.toString(16)}), found record type 0x${listContainer.header.recType.toString(16)}`,
    );
  }
  const slides: MutableSlidePersist[] = [];
  let currentSlide: MutableSlidePersist | undefined;
  let currentText: { textType: number; records: PptRecord[] } | undefined;

  for (const record of childRecords(listContainer)) {
    if (record.header.recType === RT_SlidePersistAtom) {
      if (record.data.length < SLIDE_PERSIST_ATOM_LEN) {
        throw new PptFormatError(
          `SlidePersistAtom at offset ${record.offset} carries ${record.data.length} bytes, fewer than the mandated 0x${SLIDE_PERSIST_ATOM_LEN.toString(16)}`,
        );
      }
      const view = new DataView(
        record.data.buffer,
        record.data.byteOffset,
        record.data.byteLength,
      );
      currentSlide = {
        persistIdRef: view.getUint32(0, true),
        // Bytes 4-7 are the fShouldCollapse/fNonOutlineData flags word, and bytes 8-11 cTexts, whose value the text list below reproduces by construction.
        slideId: view.getUint32(12, true),
        texts: [],
      };
      currentText = undefined;
      slides.push(currentSlide);
      continue;
    }
    if (record.header.recType === RT_TextHeaderAtom) {
      if (currentSlide === undefined) {
        throw new PptFormatError(
          `TextHeaderAtom at offset ${record.offset} precedes any SlidePersistAtom, so it belongs to no slide`,
        );
      }
      currentText = { textType: readTextHeaderAtom(record), records: [] };
      currentSlide.texts.push(currentText);
      continue;
    }
    currentText?.records.push(record);
  }
  return slides;
}
