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
  SLIDE_LIST_INSTANCE_NOTES,
} from "../record/types";
import type { NotesPersist } from "./notes-list";

// The write-side mirror of document/notes-list.ts: one NotesPersistAtom per notes slide, in a container distinguished from the master and slide lists by rh.recInstance alone. The read and write sides share NotesPersist rather than each declaring their own two-field shape, because a notes list entry states exactly one fact in both directions -- which persist object holds a notes slide, and what that notes slide's own identifier is. [MS-PPT] 2.4.14.6 NotesListWithTextContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/55453e37-0674-4703-bd8d-fcaba335f840 [MS-PPT] 2.4.14.7 NotesPersistAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/b595ad14-a46c-4fcc-b4bd-7298712043a4

function writeNotesPersistAtom(persist: NotesPersist): Uint8Array<ArrayBuffer> {
  return writeAtom(
    RT_SlidePersistAtom,
    concatBytes(
      u32le(persist.persistIdRef),
      // reserved1/fNonOutlineData/reserved2. fNonOutlineData says the notes slide holds something other than placeholder text; every notes slide this writer produces is text alone, so it stays clear.
      u32le(0),
      i32le(0), // reserved3
      u32le(persist.notesId),
      u32le(0), // reserved4
    ),
  );
}

export function writeNotesListWithText(
  persists: readonly NotesPersist[],
): Uint8Array<ArrayBuffer> {
  return writeContainer(
    RT_SlideListWithText,
    persists.map(writeNotesPersistAtom),
    {
      recInstance: SLIDE_LIST_INSTANCE_NOTES,
    },
  );
}
