import {
  readCompoundFile,
  readSummaryInformation,
  summaryInformationToLayoutMetadata,
} from "archive-codec";
import {
  type ContentBlock,
  type ContentDocument,
  type ContentShape,
  type ContentSlide,
  type DocumentTree,
  type LayoutMetadata,
  type PageSize,
  assembleTree,
} from "document-schema.js";
import { buildParagraphs } from "./content";
import { readDocumentAtom } from "./document/document-atom";
import { readFontNames } from "./document/fonts";
import { readNotesListWithText } from "./document/notes-list";
import { readNotesContainerAtom, readNotesText } from "./document/notes";
import {
  type SlidePersist,
  readSlideListWithText,
} from "./document/slide-list";
import { readDrawingShapes } from "./drawing/shapes";
import { PptEncryptedError, PptFormatError } from "./errors";
import { type PptRecord, childRecords, findChild } from "./record/tree";
import {
  RT_Document,
  RT_DocumentAtom,
  RT_Drawing,
  RT_Environment,
  RT_OutlineTextRefAtom,
  RT_Slide,
  RT_SlideListWithText,
  RT_StyleTextPropAtom,
  SLIDE_LIST_INSTANCE_NOTES,
  SLIDE_LIST_INSTANCE_SLIDES,
} from "./record/types";
import { readCurrentUserAtom } from "./stream/current-user";
import { buildPersistDirectory, resolvePersistObject } from "./stream/persist";
import { characterCountOf, readTextBody } from "./text/atoms";
import { type StyleTextProps, readStyleTextPropAtom } from "./text/style";
import { POINTS_PER_INCH, masterUnitsToPoints } from "./units";

// The read path, top to bottom: an [MS-CFB] compound file's two required streams, the persist directory that says which of the file's appended edits is live, the document container that edit names, and then each slide's drawing and text mapped onto document-schema.js's presentation content model -- the same ContentSlide/ContentShape/ContentParagraph/ContentRun vocabulary ooxml.js's pptx reader and odf.js's odp reader produce, so a .ppt reaches every consumer of that schema without a second representation of a slide existing anywhere. [MS-PPT] 2.1.1 Current User Stream: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/76cfa657-07a6-464b-81ab-4c017c611f64 [MS-PPT] 2.1.2 PowerPoint Document Stream: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/1fc22d56-28f9-4818-bd45-67c2bf721ccf

// [MS-PPT] 2.1.1/2.1.2: both stream names are mandated exactly, including the space.
export const CURRENT_USER_STREAM = "Current User";
export const POWERPOINT_DOCUMENT_STREAM = "PowerPoint Document";

/** The [MS-OLEPS] Property Set Stream a .ppt's title/author/dates live in when present ([MS-OSHARED] 2.3.3.2.2) -- a genuinely optional stream, unlike the two above, since a valid PowerPoint binary document need not carry document properties at all. */
export const SUMMARY_INFORMATION_STREAM = "\x05SummaryInformation";

// PowerPoint's own default text insets: 0.1 inch left and right, 0.05 inch top and bottom -- the same figures ECMA-376 later wrote into a:bodyPr's defaults, and the ones ooxml.js applies to a pptx shape stating none. A per-shape override lives in the shape's OfficeArtFOPT text properties, which this reader does not yet read; see the README's scope note. Exported because the write side needs them too: ContentShape requires all four insets, and a shape the writer builds for itself (a notes body, a master placeholder) has to state the same defaults a read of that shape would report rather than invent its own.
export const DEFAULT_INSET_LEFT_RIGHT_PT = 0.1 * POINTS_PER_INCH;
export const DEFAULT_INSET_TOP_BOTTOM_PT = 0.05 * POINTS_PER_INCH;

const NO_STYLE: StyleTextProps = { paragraphRuns: [], characterRuns: [] };

// The flat form: metadata plus slides, matching the shape ooxml.js's readPptxContent and odf.js's readOdpContent return, rather than a full ContentDocument envelope. readPpt below is what wraps it.
export interface PptDocument {
  readonly metadata: LayoutMetadata;
  readonly slides: readonly ContentSlide[];
}

function requireStream(
  streams: readonly { path: string; bytes: Uint8Array<ArrayBuffer> }[],
  name: string,
): Uint8Array<ArrayBuffer> {
  const stream = streams.find((candidate) => candidate.path === name);
  if (stream === undefined) {
    throw new PptFormatError(
      `compound file has no "${name}" stream, which [MS-PPT] requires of every PowerPoint binary document`,
    );
  }
  return stream.bytes;
}

// A shape's text, whether it is stored on the shape itself or -- for a placeholder -- in the document's slide list, which the shape points into with an OutlineTextRefAtom. The two spellings are not alternatives a producer picks freely: a title or body placeholder's text is genuinely absent from the slide's own drawing, so a reader that only looked at the client textbox would report those shapes as empty.
function textRecordsFor(
  clientTextbox: PptRecord,
  persist: SlidePersist,
): readonly PptRecord[] {
  const children = childRecords(clientTextbox);
  const outlineRef = findChild(children, RT_OutlineTextRefAtom);
  if (outlineRef === undefined) {
    return children;
  }
  if (outlineRef.data.length < 4) {
    throw new PptFormatError(
      `OutlineTextRefAtom at offset ${outlineRef.offset} carries ${outlineRef.data.length} bytes, fewer than the 4 its index field needs`,
    );
  }
  const view = new DataView(
    outlineRef.data.buffer,
    outlineRef.data.byteOffset,
    outlineRef.data.byteLength,
  );
  const index = view.getInt32(0, true);
  const outlineText = persist.texts[index];
  if (outlineText === undefined) {
    throw new PptFormatError(
      `OutlineTextRefAtom references text ${index} of slide ${persist.slideId}, which has only ${persist.texts.length} texts in the slide list`,
    );
  }
  return outlineText.records;
}

function blocksFor(
  clientTextbox: PptRecord | undefined,
  persist: SlidePersist,
  fontNames: readonly string[],
): ContentBlock[] {
  if (clientTextbox === undefined) {
    return [];
  }
  const records = textRecordsFor(clientTextbox, persist);
  const text = readTextBody(records);
  if (text === undefined) {
    return [];
  }
  const styleRecord = findChild(records, RT_StyleTextPropAtom);
  const style =
    styleRecord === undefined
      ? NO_STYLE
      : readStyleTextPropAtom(styleRecord, characterCountOf(text));
  return buildParagraphs(text, style, fontNames);
}

// Every notes slide's text, keyed by the slideId of the presentation slide it belongs to. [MS-PPT] 3.5.3 makes this the association: "A notes slide is associated with its presentation slide by means of the slideIdRef field in the NotesContainer record", and it explicitly warns that the notes list's own order is not meaningful, so the mapping has to be built from each container's own atom rather than by pairing the two lists positionally. A NotesContainer naming the notes master states slideIdRef 0x00000000, which no presentation slide's own slideId can be, so such an entry simply matches nothing.
//
// A real producer does not always write that mandated 0x00000000, though: LibreOffice 26.2.5.2's own notes master states slideIdRef 0x80000001 instead, confirmed by inspecting its raw bytes. That is harmless here only because a presentation slide's own slideId (this package writes 256 + index, and no other producer this package has been checked against uses anything near it) never reaches that high -- [MS-PPT] 2.2.13 reserves 0x80000000 and above for MasterId, so a real slideId that large would already be spec-nonconformant. If a slideId this package's own write.ts mints (see FIRST_SLIDE_ID's own note) ever moved up into that range, or a third-party file's own genuine slideId did, this lookup would risk pairing a slide with the wrong notes -- or with the master's own sentinel entry -- rather than with none. Nothing here currently guards that bound, since it would take roughly two billion slides to reach it from this package's own writer, but a future notes-aware reader keying on slideIdRef anywhere else should carry the identical caveat.
function readNotesBySlideId(
  streamBytes: Uint8Array<ArrayBuffer>,
  directory: ReadonlyMap<number, number>,
  notesList: PptRecord | undefined,
): Map<number, string> {
  const notes = new Map<number, string>();
  if (notesList === undefined) {
    return notes;
  }
  for (const persist of readNotesListWithText(notesList)) {
    const notesContainer = resolvePersistObject(
      streamBytes,
      directory,
      persist.persistIdRef,
      `NotesPersistAtom for notes slide ${persist.notesId}`,
    );
    notes.set(
      readNotesContainerAtom(notesContainer).slideIdRef,
      readNotesText(notesContainer),
    );
  }
  return notes;
}

function readSlide(
  streamBytes: Uint8Array<ArrayBuffer>,
  directory: ReadonlyMap<number, number>,
  persist: SlidePersist,
  size: PageSize,
  fontNames: readonly string[],
  notes: string,
): ContentSlide {
  const slideContainer = resolvePersistObject(
    streamBytes,
    directory,
    persist.persistIdRef,
    `SlidePersistAtom for slide ${persist.slideId}`,
  );
  if (slideContainer.header.recType !== RT_Slide) {
    throw new PptFormatError(
      `persist object ${persist.persistIdRef} is record type 0x${slideContainer.header.recType.toString(16)}, not the RT_Slide (0x${RT_Slide.toString(16)}) its SlidePersistAtom promised`,
    );
  }
  const drawing = findChild(childRecords(slideContainer), RT_Drawing);
  const shapes: ContentShape[] = [];
  for (const shape of drawing === undefined ? [] : readDrawingShapes(drawing)) {
    // A shape with no anchor has no rectangle on the slide, and ContentShape has no way to say "positioned, but unknown where". Dropping it loses less than inventing a position for it would: the alternative is a shape rendered at a place the file never states.
    if (shape.anchor === undefined) {
      continue;
    }
    const left = masterUnitsToPoints(shape.anchor.left);
    const top = masterUnitsToPoints(shape.anchor.top);
    shapes.push({
      frame: {
        xPt: left,
        yPt: top,
        widthPt: Math.max(0, masterUnitsToPoints(shape.anchor.right) - left),
        heightPt: Math.max(0, masterUnitsToPoints(shape.anchor.bottom) - top),
      },
      insetLeftPt: DEFAULT_INSET_LEFT_RIGHT_PT,
      insetTopPt: DEFAULT_INSET_TOP_BOTTOM_PT,
      insetRightPt: DEFAULT_INSET_LEFT_RIGHT_PT,
      insetBottomPt: DEFAULT_INSET_TOP_BOTTOM_PT,
      blocks: blocksFor(shape.clientTextbox, persist, fontNames),
    });
  }
  // Speaker notes live in their own NotesContainer persist objects, reached through the document's notes list rather than through the slide, and are resolved to this slide by readNotesBySlideId above. A slide with no notes slide of its own reads as "", which is what the schema requires of a slide with none.
  return { size, shapes, notes };
}

// Reads the two [MS-PPT] streams directly, for a caller that already holds them. The compound file below this is archive-codec's business, and separating the two keeps every record-level behaviour testable without a container around it.
export function readPptStreams(
  currentUserStream: Uint8Array<ArrayBuffer>,
  powerPointDocumentStream: Uint8Array<ArrayBuffer>,
): PptDocument {
  const currentUser = readCurrentUserAtom(currentUserStream);
  if (currentUser.encrypted) {
    throw new PptEncryptedError(
      "the CurrentUserAtom's headerToken marks this document as encrypted, and this package does not implement [MS-PPT]'s encryption",
    );
  }
  const { directory, currentEdit } = buildPersistDirectory(
    powerPointDocumentStream,
    currentUser.offsetToCurrentEdit,
  );
  const documentContainer = resolvePersistObject(
    powerPointDocumentStream,
    directory,
    currentEdit.docPersistIdRef,
    "UserEditAtom.docPersistIdRef",
  );
  if (documentContainer.header.recType !== RT_Document) {
    throw new PptFormatError(
      `the document persist object is record type 0x${documentContainer.header.recType.toString(16)}, not RT_Document (0x${RT_Document.toString(16)})`,
    );
  }

  const children = childRecords(documentContainer);
  const documentAtomRecord = findChild(children, RT_DocumentAtom);
  if (documentAtomRecord === undefined) {
    throw new PptFormatError(
      "the DocumentContainer has no DocumentAtom, so the presentation's slide size is unknown",
    );
  }
  const documentAtom = readDocumentAtom(documentAtomRecord);
  const size: PageSize = {
    widthPt: masterUnitsToPoints(documentAtom.slideSize.x),
    heightPt: masterUnitsToPoints(documentAtom.slideSize.y),
  };

  const environment = findChild(children, RT_Environment);
  const fontNames = environment === undefined ? [] : readFontNames(environment);

  // The master, slide and notes lists all carry RT_SlideListWithText and differ only by recInstance, so matching on the record type alone would find whichever came first -- the master list.
  const listWithInstance = (instance: number): PptRecord | undefined =>
    children.find(
      (record) =>
        record.header.recType === RT_SlideListWithText &&
        record.header.recInstance === instance,
    );
  const slideList = listWithInstance(SLIDE_LIST_INSTANCE_SLIDES);
  const persists =
    slideList === undefined ? [] : readSlideListWithText(slideList);
  const notesBySlideId = readNotesBySlideId(
    powerPointDocumentStream,
    directory,
    listWithInstance(SLIDE_LIST_INSTANCE_NOTES),
  );

  return {
    // Document properties live in the compound file's own "\x05SummaryInformation" stream ([MS-OSHARED]), not in any [MS-PPT] record -- genuinely outside what a caller holding only these two streams can supply. readPptContent, one level up, is where a container-level caller gets the real value: it looks the stream up itself and overrides this field when one is present.
    metadata: {},
    slides: persists.map((persist) =>
      readSlide(
        powerPointDocumentStream,
        directory,
        persist,
        size,
        fontNames,
        notesBySlideId.get(persist.slideId) ?? "",
      ),
    ),
  };
}

// Reads a .ppt file's bytes into the flat metadata + slides form. readPptStreams below is the pure record-level read (metadata always {}, since it has no container to look a SummaryInformation stream up in); this wraps it with the one container-level fact readPptStreams cannot know -- whether the compound file also carries a "\x05SummaryInformation" stream -- mapped onto LayoutMetadata through summaryInformationToLayoutMetadata (see src/metadata.ts) when present.
export function readPptContent(bytes: Uint8Array<ArrayBuffer>): PptDocument {
  const streams = readCompoundFile(bytes);
  const document = readPptStreams(
    requireStream(streams, CURRENT_USER_STREAM),
    requireStream(streams, POWERPOINT_DOCUMENT_STREAM),
  );
  const metadataStream = streams.find(
    (stream) => stream.path === SUMMARY_INFORMATION_STREAM,
  );
  if (metadataStream === undefined) {
    return document;
  }
  return {
    ...document,
    metadata: summaryInformationToLayoutMetadata(
      readSummaryInformation(metadataStream.bytes),
    ),
  };
}

// Reads a .ppt file's bytes into the shared tree form, the same DocumentTree ooxml.js's readPptx and odf.js's readOdp produce for their own presentation formats.
export function readPpt(bytes: Uint8Array<ArrayBuffer>): DocumentTree {
  const { metadata, slides } = readPptContent(bytes);
  const document: ContentDocument = {
    kind: "presentation",
    metadata,
    slides: [...slides],
  };
  return assembleTree(document);
}
