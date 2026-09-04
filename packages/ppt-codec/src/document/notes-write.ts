import type { ContentShape, PageSize } from "document-schema.js";
import { writeSlideDrawing } from "../drawing/shapes-write";
import {
  DEFAULT_INSET_LEFT_RIGHT_PT,
  DEFAULT_INSET_TOP_BOTTOM_PT,
} from "../read";
import {
  concatBytes,
  u16le,
  u32le,
  writeAtom,
  writeContainer,
} from "../record/write";
import { RT_Notes, RT_NotesAtom } from "../record/types";

// The write-side mirror of document/notes.ts: one NotesContainer per slide that actually has speaker notes, each carrying the NotesAtom naming its own slide and a DrawingContainer holding the notes text. The drawing is built by the same writeSlideDrawing every presentation slide's own drawing goes through, because a notes slide's text really is stored the same way a plain slide text box's is -- a shape's own OfficeArtClientTextbox holding a TextHeaderAtom, a TextCharsAtom and a StyleTextPropAtom, with no placeholder linkage and no OutlineTextRefAtom indirection. That this is what a real producer writes was confirmed against LibreOffice's own `soffice --convert-to ppt` output rather than assumed: its notes body is an un-placeholdered text box, not a PT_NotesBody placeholder. [MS-PPT] 2.5.6 NotesContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/50bfc0f7-c101-4c32-8754-6ca59772b785 [MS-PPT] 2.5.7 NotesAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/9bb3e352-1014-477b-b286-cd43127c3b74

// A notes page is conventionally the slide's own image on the upper half and the notes text on the lower half -- what both PowerPoint's and Impress's notes view render, and where odf.js's writeOdp places its own presentation:notes frame for the same reason. ContentSlide carries no notes-page geometry of its own, so the notes text box's rectangle is derived from the notes page size rather than stated: the lower half of the page, inset from each edge. These are the notes page's proportions, not a threshold anything is tested against -- nothing this package reads back depends on them, since readNotesText finds a notes slide's text by walking every shape in its drawing regardless of where that shape sits.
const NOTES_BODY_TOP_FRACTION = 0.5;
const NOTES_BODY_MARGIN_FRACTION = 0.05;

// One shape holding the whole of a slide's notes: one paragraph per line, matching how ContentSlide.notes spells a multi-paragraph note and how odf.js's odp writer splits the same string across its own text:p elements.
function notesBodyShape(notes: string, notesPageSize: PageSize): ContentShape {
  const marginXPt = notesPageSize.widthPt * NOTES_BODY_MARGIN_FRACTION;
  const marginYPt = notesPageSize.heightPt * NOTES_BODY_MARGIN_FRACTION;
  const topPt = notesPageSize.heightPt * NOTES_BODY_TOP_FRACTION;
  return {
    frame: {
      xPt: marginXPt,
      yPt: topPt,
      widthPt: notesPageSize.widthPt - marginXPt * 2,
      heightPt: notesPageSize.heightPt - topPt - marginYPt,
    },
    // The insets a read of this shape would report, since this writer builds no OfficeArtFOPT property table to state a per-shape override in.
    insetLeftPt: DEFAULT_INSET_LEFT_RIGHT_PT,
    insetTopPt: DEFAULT_INSET_TOP_BOTTOM_PT,
    insetRightPt: DEFAULT_INSET_LEFT_RIGHT_PT,
    insetBottomPt: DEFAULT_INSET_TOP_BOTTOM_PT,
    blocks: notes.split("\n").map((line) => ({
      kind: "paragraph" as const,
      runs: [{ text: line }],
    })),
  };
}

// [MS-PPT] 2.5.7's 8-byte NotesAtom, recVer 0x1. slideFlags is left clear: its three bits each say that this notes slide inherits something (objects, colour scheme, background) from the notes master, and this writer produces no notes master for them to inherit from -- see the package README's write-scope section.
export function writeNotesAtom(slideIdRef: number): Uint8Array<ArrayBuffer> {
  return writeAtom(
    RT_NotesAtom,
    concatBytes(
      u32le(slideIdRef),
      u16le(0), // slideFlags
      u16le(0), // unused
    ),
    { recVer: 0x1 },
  );
}

export function writeNotesContainer(
  slideIdRef: number,
  notes: string,
  notesPageSize: PageSize,
  fontIndexOf: (family: string) => number,
): Uint8Array<ArrayBuffer> {
  return writeContainer(RT_Notes, [
    writeNotesAtom(slideIdRef),
    writeSlideDrawing([notesBodyShape(notes, notesPageSize)], fontIndexOf),
  ]);
}
