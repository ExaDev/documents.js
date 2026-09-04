import { PptFormatError } from "../errors";
import { type PptRecord, childRecords } from "../record/tree";
import { RT_SlideListWithText, RT_SlidePersistAtom } from "../record/types";

// NotesListWithTextContainer: the document's list of notes slides. Structurally the notes-side twin of document/slide-list.ts, but with two differences that make it its own module rather than a parameter of that one. The container carries nothing but NotesPersistAtom records -- unlike SlideListWithTextContainer, whose grammar interleaves the placeholder texts a slide's own OutlineTextRefAtom points back into -- so there is no text-grouping pass here, and a notes slide's text is therefore always stored on its own shapes rather than in this list. And the atom's own fields differ from SlidePersistAtom's despite sharing RT_SlidePersistAtom and its 0x14 length: the field SlidePersistAtom spends on cTexts is reserved here, and the identifier at offset 12 is a NotesId rather than a SlideId. [MS-PPT] 2.4.14.6 NotesListWithTextContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/55453e37-0674-4703-bd8d-fcaba335f840 [MS-PPT] 2.4.14.7 NotesPersistAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/b595ad14-a46c-4fcc-b4bd-7298712043a4

// [MS-PPT] 2.4.14.7: "rh.recLen MUST be 0x00000014."
const NOTES_PERSIST_ATOM_LEN = 0x00000014;

export interface NotesPersist {
  // The persist object directory entry naming this notes slide's own NotesContainer.
  readonly persistIdRef: number;
  // This notes slide's own identifier, which a slide's SlideAtom names in its notesIdRef field.
  readonly notesId: number;
}

// Reads the notes list's entries. [MS-PPT] 3.5.3's own worked example states that, unlike the slide list, "the order of the NotesPersistAtom records is not meaningful" -- a notes slide is associated with its presentation slide by the slideIdRef field of its own NotesContainer, never by its position here -- so this returns the entries as stated and leaves the association to document/notes.ts.
export function readNotesListWithText(
  listContainer: PptRecord,
): NotesPersist[] {
  if (listContainer.header.recType !== RT_SlideListWithText) {
    throw new PptFormatError(
      `expected RT_SlideListWithText (0x${RT_SlideListWithText.toString(16)}), found record type 0x${listContainer.header.recType.toString(16)}`,
    );
  }
  const persists: NotesPersist[] = [];
  for (const record of childRecords(listContainer)) {
    if (record.header.recType !== RT_SlidePersistAtom) {
      continue;
    }
    if (record.data.length < NOTES_PERSIST_ATOM_LEN) {
      throw new PptFormatError(
        `NotesPersistAtom at offset ${record.offset} carries ${record.data.length} bytes, fewer than the mandated 0x${NOTES_PERSIST_ATOM_LEN.toString(16)}`,
      );
    }
    const view = new DataView(
      record.data.buffer,
      record.data.byteOffset,
      record.data.byteLength,
    );
    persists.push({
      persistIdRef: view.getUint32(0, true),
      // Bytes 4-7 are the reserved1/fNonOutlineData/reserved2 flags word and bytes 8-11 reserved3, both of which the spec requires to be ignored.
      notesId: view.getUint32(12, true),
    });
  }
  return persists;
}
