import { readDrawingShapes } from "../drawing/shapes";
import { PptFormatError } from "../errors";
import { type PptRecord, childRecords, findChild } from "../record/tree";
import { RT_Drawing, RT_Notes, RT_NotesAtom } from "../record/types";
import { readTextBody, splitParagraphs } from "../text/atoms";

// A notes slide: the NotesContainer persist object holding one presentation slide's speaker notes, and the atom naming which slide those notes belong to. A notes slide is shaped exactly like a presentation slide -- an identifying atom, then a DrawingContainer of OfficeArt shapes -- which is why the whole drawing walk is reused here unchanged rather than reimplemented. [MS-PPT] 2.5.6 NotesContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/50bfc0f7-c101-4c32-8754-6ca59772b785 [MS-PPT] 2.5.7 NotesAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/9bb3e352-1014-477b-b286-cd43127c3b74 [MS-PPT] 3.5.3 Notes Slides, whose worked example states the association rule this module implements: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/0d430f90-17fc-4730-92c9-90198d19c13b

// [MS-PPT] 2.5.7: "rh.recLen MUST be 0x00000008."
const NOTES_ATOM_LEN = 0x00000008;

// The slideIdRef value reserved for a notes MASTER slide. [MS-PPT] 2.5.7: slideIdRef "MUST be 0x00000000 if the NotesContainer record that contains this NotesAtom record represents the notes master slide", and MUST NOT be for a notes slide -- so the same record type carries both, and only this field tells them apart.
export const NOTES_MASTER_SLIDE_ID_REF = 0x00000000;

export interface NotesAtom {
  // The slideId of the presentation slide these notes belong to, or NOTES_MASTER_SLIDE_ID_REF when this container is the notes master rather than a notes slide.
  readonly slideIdRef: number;
  // The SlideFlags word saying which content this notes slide inherits from the notes master ([MS-PPT] 2.13.7): fMasterObjects, fMasterScheme, fMasterBackground.
  readonly slideFlags: number;
}

export function readNotesAtom(record: PptRecord): NotesAtom {
  if (record.header.recType !== RT_NotesAtom) {
    throw new PptFormatError(
      `expected RT_NotesAtom (0x${RT_NotesAtom.toString(16)}), found record type 0x${record.header.recType.toString(16)}`,
    );
  }
  if (record.data.length < NOTES_ATOM_LEN) {
    throw new PptFormatError(
      `NotesAtom carries ${record.data.length} bytes, fewer than the mandated 0x${NOTES_ATOM_LEN.toString(16)}`,
    );
  }
  const view = new DataView(
    record.data.buffer,
    record.data.byteOffset,
    record.data.byteLength,
  );
  return {
    slideIdRef: view.getUint32(0, true),
    slideFlags: view.getUint16(4, true),
    // Bytes 6-7 are the atom's own trailing unused field, which the spec requires to be ignored.
  };
}

// The NotesAtom every NotesContainer is required to carry, or a structural failure: without it the container states neither which slide it belongs to nor whether it is the notes master, and there is no other record that could.
export function readNotesContainerAtom(notesContainer: PptRecord): NotesAtom {
  if (notesContainer.header.recType !== RT_Notes) {
    throw new PptFormatError(
      `expected RT_Notes (0x${RT_Notes.toString(16)}), found record type 0x${notesContainer.header.recType.toString(16)}`,
    );
  }
  const atom = findChild(childRecords(notesContainer), RT_NotesAtom);
  if (atom === undefined) {
    throw new PptFormatError(
      `the NotesContainer at offset ${notesContainer.offset} has no NotesAtom, so the presentation slide its notes belong to is unstated`,
    );
  }
  return readNotesAtom(atom);
}

// One notes slide's speaker-notes text: every text body its drawing carries, in document order, paragraphs joined by newlines -- the plain-string shape ContentSlide.notes is, and the same joining ooxml.js's pptx reader and odf.js's odp reader produce for their own formats.
//
// Every text body counts, rather than only the one on a PT_NotesBody placeholder shape, because a real producer does not necessarily place the notes text on a placeholder at all: LibreOffice writes the notes body as a plain, un-placeholdered text box carrying a TextHeaderAtom of Tx_TYPE_OTHER (verified against real `soffice --convert-to ppt` output), and reserves the PT_NotesBody placeholder spelling for a notes page whose text is empty. Sweeping every body is also safe here in a way it would not be on a presentation slide: [MS-PPT] 2.13.21's date, slide-number, header and footer placeholder kinds are all defined as belonging to a notes MASTER slide, and the notes master is reached through DocumentAtom.notesMasterPersistIdRef rather than through the notes list, so it is never walked by this reader.
//
// Unlike read.ts's own slide walk, a shape with no anchor is not skipped: an unanchored shape has no rectangle to give ContentShape, but its text is still this notes slide's text.
export function readNotesText(notesContainer: PptRecord): string {
  const drawing = findChild(childRecords(notesContainer), RT_Drawing);
  if (drawing === undefined) {
    return "";
  }
  const bodies: string[] = [];
  for (const shape of readDrawingShapes(drawing)) {
    if (shape.clientTextbox === undefined) {
      continue;
    }
    // No OutlineTextRefAtom indirection to follow: that atom indexes the texts a slide's own entry in the SlideListWithTextContainer carries, and [MS-PPT] 2.4.14.6 gives the notes list no texts at all to index into.
    const text = readTextBody(childRecords(shape.clientTextbox));
    if (text === undefined || text.length === 0) {
      continue;
    }
    bodies.push(
      splitParagraphs(text)
        .map((paragraph) => paragraph.text)
        .join("\n"),
    );
  }
  return bodies.join("\n");
}
