import {
  hasSummaryInformationFields,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import {
  type ContentSlide,
  type DocumentTree,
  type PageSize,
  flattenTree,
} from "document-schema.js";
import { collectFontFamilies } from "./content-write";
import { writeDocumentAtom } from "./document/document-atom-write";
import { writeEnvironment } from "./document/fonts-write";
import {
  writeMainMaster,
  writeMasterListWithText,
  writeSlideAtomForSlide,
} from "./document/master-write";
import type { NotesPersist } from "./document/notes-list";
import { writeNotesListWithText } from "./document/notes-list-write";
import { writeNotesContainer } from "./document/notes-write";
import {
  type SlidePersistRef,
  writeSlideListWithText,
} from "./document/slide-list-write";
import { writeSlideDrawing } from "./drawing/shapes-write";
import { PptUnsupportedContentError } from "./errors";
import { layoutMetadataToSummaryInformation } from "./metadata";
import {
  CURRENT_USER_STREAM,
  POWERPOINT_DOCUMENT_STREAM,
  SUMMARY_INFORMATION_STREAM,
  type PptDocument,
} from "./read";
import { RT_Document, RT_Slide } from "./record/types";
import { concatBytes, writeContainer } from "./record/write";
import { writeCurrentUserAtom } from "./stream/current-user-write";
import {
  writePersistDirectoryAtom,
  writeUserEditAtom,
} from "./stream/persist-write";

// The write path, the mirror image of read.ts: a presentation's ContentSlide[] mapped onto [MS-PPT] records (document container, master and slide lists, one main master, one slide container per slide with its drawing and text, and one notes container per slide that has speaker notes), a single-edit persist layer over them (stream/persist-write.ts), and the two [MS-CFB] streams archive-codec's writeCompoundFile wraps into real .ppt bytes. Deliberately narrower than the read path's own coverage -- see the package README's write-scope section for exactly what a written file carries and what it does not.

// [MS-PPT] persist identifiers this writer mints, in the order the stream lays them out: 1 names the document, 2 the one main master, slides follow contiguously from 3, and each notes slide that exists takes the next identifier after the last slide's.
const DOCUMENT_PERSIST_ID = 1;
const MASTER_PERSIST_ID = 2;
const FIRST_SLIDE_PERSIST_ID = 3;
// Real slide ids conventionally start at 256 (this package's own synthetic-presentation fixture uses the same value), and 256 matches what a real PowerPoint file states. Unlike a plain distinct sequence, though, the range this writer mints ids from is now load-bearing: read.ts's readNotesBySlideId keys its notes-by-slide map on slideIdRef, and [MS-PPT] 2.2.13 requires a MasterId (the identifier space a main master's own slideIdRef comes from, MASTER_SLIDE_ID here) to be at least 0x80000000, so a slide id minted at or above that bound could collide with one. Every id this writer mints -- FIRST_SLIDE_ID plus the largest slide count it is asked to write -- must stay below MASTER_SLIDE_ID; see write.test.ts's "keeps minted slide ids below the MasterId range" test. Notes ids are minted from their own separate base so that a notes id can never collide with a slide id either: NotesId and SlideId are their own identifier spaces ([MS-PPT] 2.2.14 and 2.2.26), and a reader matching one against the other would silently pair the wrong records.
const FIRST_SLIDE_ID = 256;
const FIRST_NOTES_ID = 512;
// [MS-PPT] 2.5.2: notesIdRef 0x00000000 means the slide has no notes slide, which is exactly what a slide whose notes are empty has.
const NO_NOTES_ID_REF = 0;
const DEFAULT_SLIDE_SIZE: PageSize = { widthPt: 720, heightPt: 540 };

function requireOneSlideSize(slides: readonly ContentSlide[]): PageSize {
  const first = slides[0]?.size ?? DEFAULT_SLIDE_SIZE;
  for (const slide of slides) {
    if (
      slide.size.widthPt !== first.widthPt ||
      slide.size.heightPt !== first.heightPt
    ) {
      throw new PptUnsupportedContentError(
        `ppt-codec's writer cannot express per-slide sizes: slide sizes ${JSON.stringify(first)} and ${JSON.stringify(slide.size)} both appear, but [MS-PPT]'s DocumentAtom states exactly one slide size for the whole presentation`,
      );
    }
  }
  return first;
}

// [MS-PPT] 2.5.1 orders a SlideContainer's children, and its slideAtom is the first of them. It states the master this slide follows and -- when the slide has speaker notes -- the notes slide those notes live in, which is the link a real consumer actually follows to find them (see document/master-write.ts).
function writeSlideContainer(
  shapes: ContentSlide["shapes"],
  notesIdRef: number,
  fontIndexOf: (family: string) => number,
): Uint8Array<ArrayBuffer> {
  return writeContainer(RT_Slide, [
    writeSlideAtomForSlide(notesIdRef),
    writeSlideDrawing(shapes, fontIndexOf),
  ]);
}

// Streams a caller already holds two [MS-PPT] artifacts for -- the same split readPptStreams exposes on the way in, so a caller assembling its own container can bypass writePptContent's archive-codec dependency entirely.
export function writePptStreams(document: PptDocument): {
  readonly currentUserStream: Uint8Array<ArrayBuffer>;
  readonly powerPointDocumentStream: Uint8Array<ArrayBuffer>;
} {
  const { slides } = document;
  const size = requireOneSlideSize(slides);

  const fontNames = collectFontFamilies(
    slides.map((slide) => slide.shapes.flatMap((shape) => shape.blocks)),
  );
  const fontIndexOf = (family: string): number => {
    const index = fontNames.indexOf(family);
    if (index === -1) {
      throw new PptUnsupportedContentError(
        `font family '${family}' was not collected into the document's font table before writing`,
      );
    }
    return index;
  };

  const slidePersistRefs: SlidePersistRef[] = slides.map((_slide, index) => ({
    persistIdRef: FIRST_SLIDE_PERSIST_ID + index,
    slideId: FIRST_SLIDE_ID + index,
  }));

  // Only a slide that actually carries notes gets a NotesContainer, and only such a slide's own SlideAtom names one. A slide with no notes is left with no notes slide at all rather than an empty one: readNotesBySlideId then finds nothing for it and read.ts reports "", which is exactly what an absent notes slide means -- whereas an empty NotesContainer would be a real notes slide that happens to say nothing, a different fact, and one no round trip could tell apart from the notes the caller never wrote.
  const notesPersists: NotesPersist[] = [];
  const notesContainers: Uint8Array<ArrayBuffer>[] = [];
  const notesIdRefs = slides.map((slide, index) => {
    if (slide.notes.length === 0) {
      return NO_NOTES_ID_REF;
    }
    const notesId = FIRST_NOTES_ID + notesPersists.length;
    notesPersists.push({
      persistIdRef:
        FIRST_SLIDE_PERSIST_ID + slides.length + notesPersists.length,
      notesId,
    });
    notesContainers.push(
      writeNotesContainer(
        FIRST_SLIDE_ID + index,
        slide.notes,
        size,
        fontIndexOf,
      ),
    );
    return notesId;
  });

  const environment = writeEnvironment(fontNames);
  const documentChildren = [writeDocumentAtom(size)];
  if (environment !== undefined) {
    documentChildren.push(environment);
  }
  documentChildren.push(writeMasterListWithText(MASTER_PERSIST_ID));
  documentChildren.push(writeSlideListWithText(slidePersistRefs));
  // Omitted entirely when no slide has notes, rather than written empty: the reader treats an absent notes list and an empty one identically, and a real producer states no list when there is nothing to list.
  if (notesPersists.length > 0) {
    documentChildren.push(writeNotesListWithText(notesPersists));
  }
  const documentContainer = writeContainer(RT_Document, documentChildren);

  // Every persist object in the order it is laid out in the stream, so the persist directory's offsets and the stream itself are derived from one list rather than from two that could disagree.
  const persistObjects: {
    readonly persistId: number;
    readonly bytes: Uint8Array<ArrayBuffer>;
  }[] = [
    { persistId: DOCUMENT_PERSIST_ID, bytes: documentContainer },
    { persistId: MASTER_PERSIST_ID, bytes: writeMainMaster(size, fontIndexOf) },
  ];
  slides.forEach((slide, index) => {
    const ref = slidePersistRefs[index];
    const notesIdRef = notesIdRefs[index];
    if (ref === undefined || notesIdRef === undefined) {
      throw new PptUnsupportedContentError(
        "internal error: slide persist reference missing for a slide being written",
      );
    }
    persistObjects.push({
      persistId: ref.persistIdRef,
      bytes: writeSlideContainer(slide.shapes, notesIdRef, fontIndexOf),
    });
  });
  notesPersists.forEach((persist, index) => {
    const bytes = notesContainers[index];
    if (bytes === undefined) {
      throw new PptUnsupportedContentError(
        "internal error: notes container missing for a notes persist reference",
      );
    }
    persistObjects.push({ persistId: persist.persistIdRef, bytes });
  });

  const persistEntries: { persistId: number; offset: number }[] = [];
  let offset = 0;
  for (const object of persistObjects) {
    persistEntries.push({ persistId: object.persistId, offset });
    offset += object.bytes.length;
  }
  const persistDirectoryOffset = offset;
  const persistDirectory = writePersistDirectoryAtom(persistEntries);

  const userEditOffset = persistDirectoryOffset + persistDirectory.length;
  const lastSlideId = slidePersistRefs.at(-1)?.slideId ?? 0;
  const userEdit = writeUserEditAtom({
    lastSlideIdRef: lastSlideId,
    offsetLastEdit: 0,
    offsetPersistDirectory: persistDirectoryOffset,
    docPersistIdRef: DOCUMENT_PERSIST_ID,
    // [MS-PPT] 2.3.3: persistIdSeed is the identifier a next edit would mint, so it has to stay above every identifier already in the directory -- derived from the entries themselves rather than from the slide count, which stopped being the whole story once the master and the notes slides began taking persist identifiers of their own.
    persistIdSeed:
      Math.max(...persistEntries.map((entry) => entry.persistId)) + 1,
  });

  const currentUserAtom = writeCurrentUserAtom(userEditOffset);

  return {
    currentUserStream: currentUserAtom,
    powerPointDocumentStream: concatBytes(
      ...persistObjects.map((object) => object.bytes),
      persistDirectory,
      userEdit,
    ),
  };
}

// Wraps writePptStreams' two [MS-PPT] streams in a real [MS-CFB] compound file via archive-codec's writeCompoundFile -- genuine .ppt bytes readPptContent (and any conformant [MS-PPT] reader) can open.
export function writePptContent(
  document: PptDocument,
): Uint8Array<ArrayBuffer> {
  const { currentUserStream, powerPointDocumentStream } =
    writePptStreams(document);
  const streams = [
    { path: CURRENT_USER_STREAM, bytes: currentUserStream },
    { path: POWERPOINT_DOCUMENT_STREAM, bytes: powerPointDocumentStream },
  ];
  // Only when there is something SummaryInformation can actually hold: an input whose metadata carries nothing beyond creator/producer/language (or nothing at all) should read back exactly as it would with no stream present, not force an empty-but-present one into existence.
  if (hasSummaryInformationFields(document.metadata)) {
    streams.push({
      path: SUMMARY_INFORMATION_STREAM,
      bytes: writeSummaryInformationStream(
        layoutMetadataToSummaryInformation(document.metadata),
      ),
    });
  }
  return writeCompoundFile(streams);
}

// Writes a presentation DocumentTree to .ppt bytes, the mirror of readPpt. Throws PptUnsupportedContentError for a tree of any other kind: this writer covers presentations only, the same kind readPpt itself always produces.
export function writePpt(tree: DocumentTree): Uint8Array<ArrayBuffer> {
  const content = flattenTree(tree);
  if (content.kind !== "presentation") {
    throw new PptUnsupportedContentError(
      `ppt-codec's writer only writes presentation documents; got a '${content.kind}' document`,
    );
  }
  return writePptContent({
    metadata: content.metadata,
    slides: content.slides,
  });
}
