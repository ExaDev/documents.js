import {
  hasSummaryInformationFields,
  writeCompoundFile,
  writeSummaryInformationStream,
} from "archive-codec";
import {
  type ContentDocument,
  type ContentImageBlock,
  type ContentShape,
  type ContentSlide,
  type DocumentTree,
  type PageSize,
  flattenTree,
} from "document-schema.js";
import { base64ToBytes } from "./base64";
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
import {
  type PptBlip,
  isBlipFormat,
  writeDrawingGroupContainer,
} from "./drawing/blips";
import {
  type DrawingShape,
  type DrawingWriteContext,
  type DrawingWritten,
  writeSlideDrawing,
} from "./drawing/shapes-write";
import {
  type PptDiagnosticSink,
  NOOP_PPT_DIAGNOSTIC_SINK,
} from "./diagnostics";
import { PptUnsupportedContentError } from "./errors";
import { layoutMetadataToSummaryInformation } from "./metadata";
import {
  type WritableOleEmbed,
  writeExOleObjStg,
  writeExObjListContainer,
  writeOleClientData,
} from "./ole/embedded-write";
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

// Turns a shape's embedded object into the [MS-CFB] compound-file bytes its ExOleObjStg persist object carries -- the write-side mirror of read.ts's DecodeEmbeddedObjectPort, and the identical injected-port answer to the identical cross-codec-layering problem ooxml.js's own EmbeddedPresentationSerialiser solves one layer up: this package depends on no sibling format codec, so it cannot itself serialise an arbitrary nested ContentDocument, and documents.js -- which already depends on every write-capable codec -- is expected to wire one from whichever codec matches the document's own kind. Returning undefined (no port supplied, or a kind the port cannot serialise) degrades the shape to writing with no clientData and no ExOleObjStg entry at all -- the identical silent-drop policy this writer already applies to every other block kind it cannot express (see the package README's write-scope section), deliberately unchanged by this port's addition.
export type EmbeddedObjectSerialiser = (
  document: ContentDocument,
) => Uint8Array<ArrayBuffer> | undefined;

// The write options, matching the shape markdown-codec's, pdf-codec's and rtf-codec's own option objects already use in this family: an AbortSignal and a diagnostic sink. A writer's input is a value this process already holds rather than bytes of unknown provenance, so there are no read-side resource limits here -- and every deliberate drop this writer makes fires through the sink rather than passing silently, per the family's own diagnostic-channel convention.
//
// onUnwritableBlock decides what a drop the sink would otherwise merely report DOES: 'drop' (the default) keeps every existing caller's own behaviour unchanged -- the block is named through the sink and excluded from the written text body -- while 'throw' raises a PptUnsupportedContentError naming the identical block and reason instead of writing a file that silently omits it, matching doc-codec's own convention for content it cannot express. The default stays 'drop' rather than converging on doc-codec's 'throw' as this writer's own default, because the two packages' own upstream differs in kind rather than degree: documents.js's PDF-to-ppt and odp-to-ppt reconstruction is this package's primary caller today, and it ROUTINELY hands this writer content the binary PPT format has no spelling for at all (an unrecognised alignment value, a construct marker, an OLE object with no serialiser port supplied) -- not as a rare edge case a bug would explain, but as the ordinary shape of a cross-format conversion into a narrower target. Flipping the default to 'throw' would turn "this slide's OLE object degrades to geometry" into "the whole presentation fails to convert" for every one of those callers, a severe regression this option exists to let a caller opt into deliberately rather than have imposed on it.
export type PptUnwritableBlockPolicy = "drop" | "throw";

export interface WritePptOptions {
  readonly signal?: AbortSignal;
  readonly sink?: PptDiagnosticSink;
  readonly serialiseEmbeddedObject?: EmbeddedObjectSerialiser;
  readonly onUnwritableBlock?: PptUnwritableBlockPolicy;
}

// The write path, the mirror image of read.ts: a presentation's ContentSlide[] mapped onto [MS-PPT] records (document container, master and slide lists, one main master, one slide container per slide with its drawing and text, and one notes container per slide that has speaker notes), a single-edit persist layer over them (stream/persist-write.ts), and the two [MS-CFB] streams archive-codec's writeCompoundFile wraps into real .ppt bytes. Deliberately narrower than the read path's own coverage -- see the package README's write-scope section for exactly what a written file carries and what it does not.

// [MS-PPT] persist identifiers this writer mints, in the order the stream lays them out: 1 names the document, 2 the one main master, slides follow contiguously from 3, and each notes slide that exists takes the next identifier after the last slide's.
const DOCUMENT_PERSIST_ID = 1;
const MASTER_PERSIST_ID = 2;
const FIRST_SLIDE_PERSIST_ID = 3;
// Real slide ids conventionally start at 256 (this package's own synthetic-presentation fixture uses the same value) -- 256 matches what a real PowerPoint file states. Notes ids are minted from their own base so that a notes id can never collide with a slide id: the two are separate identifier spaces ([MS-PPT] 2.2.14 NotesId and 2.2.26 SlideId), and a reader matching one against the other would silently pair the wrong records.
//
// Since read.ts's own readNotesBySlideId keys a notes container by slideIdRef, this base also has to stay well clear of 0x80000000: [MS-PPT] 2.2.13 requires a MasterId to be at or above that value, and a real producer's own notes-master entry states its slideIdRef as (or near) a sentinel in that range rather than the spec-mandated 0x00000000 (confirmed against LibreOffice, which writes 0x80000001) -- a slide id minted up in that range would risk being mistaken for one. FIRST_SLIDE_ID + slides.length would need to exceed roughly two billion before this became reachable, which is not a bound worth guarding at runtime, but it is the reason this constant must never be changed to start anywhere near the top half of a 32-bit id space.
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
  context: DrawingWriteContext,
  clientDataFor: (shape: ContentShape) => Uint8Array<ArrayBuffer> | undefined,
): DrawingWritten {
  const drawing = writeSlideDrawing(
    shapes.map((shape): DrawingShape => ({
      shape,
      clientData: clientDataFor(shape),
    })),
    context,
  );
  return {
    bytes: writeContainer(RT_Slide, [
      writeSlideAtomForSlide(notesIdRef),
      drawing.bytes,
    ]),
    shapeCount: drawing.shapeCount,
    maxSpid: drawing.maxSpid,
  };
}

// One ExOleObjStg persist object and one ExObjListContainer entry per shape whose own embeddedObject block a serialiser port actually recovered bytes for -- a shape whose block the port declines (no port supplied, or a document kind it cannot serialise) writes with no clientData at all, identical to a shape that never carried an embeddedObject block. Persist identifiers are minted from firstPersistId contiguously, so the caller only has to reserve as many identifiers as embeds this plan actually produced (readable back from persistObjects.length) rather than an upper bound.
interface OleEmbedPlan {
  readonly embeds: readonly WritableOleEmbed[];
  readonly persistObjects: readonly {
    readonly persistId: number;
    readonly bytes: Uint8Array<ArrayBuffer>;
  }[];
  readonly clientDataFor: (
    shape: ContentShape,
  ) => Uint8Array<ArrayBuffer> | undefined;
}

function planOleEmbeds(
  slides: readonly ContentSlide[],
  serialise: EmbeddedObjectSerialiser | undefined,
  firstPersistId: number,
): OleEmbedPlan {
  const embeds: WritableOleEmbed[] = [];
  const persistObjects: {
    persistId: number;
    bytes: Uint8Array<ArrayBuffer>;
  }[] = [];
  const clientDataByShape = new Map<ContentShape, Uint8Array<ArrayBuffer>>();
  if (serialise !== undefined) {
    for (const slide of slides) {
      for (const shape of slide.shapes) {
        const embedBlock = shape.blocks.find(
          (block) => block.kind === "embeddedObject",
        );
        if (embedBlock === undefined) {
          continue;
        }
        const storageBytes = serialise(embedBlock.document);
        if (storageBytes === undefined) {
          continue;
        }
        const exObjId = embeds.length + 1;
        const persistId = firstPersistId + persistObjects.length;
        embeds.push({
          exObjId,
          persistIdRef: persistId,
          objectKind: embedBlock.objectKind,
        });
        persistObjects.push({
          persistId,
          bytes: writeExOleObjStg(storageBytes),
        });
        clientDataByShape.set(shape, writeOleClientData(exObjId));
      }
    }
  }
  return {
    embeds,
    persistObjects,
    clientDataFor: (shape) => clientDataByShape.get(shape),
  };
}

// The document's whole blip store and the pib each distinct image resolves to. Every png/jpeg image block across every slide contributes one store entry the first time its exact bytes appear -- the same de-duplication a real producer's rgbUid digests exist for, keyed here by the base64 that uniquely names those bytes -- and a shape's property table references it by the one-based index readBlipStore hands back. An image whose format is neither png nor jpeg never enters the store at all: it has no MSOBLIPTYPE token to be written with, and the per-shape planner is the place that drop is diagnosed.
interface BlipStorePlan {
  readonly blips: readonly PptBlip[];
  readonly pibOf: (image: ContentImageBlock) => number;
}

function planBlipStore(slides: readonly ContentSlide[]): BlipStorePlan {
  const blips: PptBlip[] = [];
  const pibByKey = new Map<string, number>();
  for (const slide of slides) {
    for (const shape of slide.shapes) {
      for (const block of shape.blocks) {
        if (block.kind !== "image" || !isBlipFormat(block.format)) {
          continue;
        }
        const key = `${block.format}:${block.base64}`;
        if (!pibByKey.has(key)) {
          pibByKey.set(key, blips.length + 1);
          blips.push({
            format: block.format,
            bytes: base64ToBytes(block.base64),
          });
        }
      }
    }
  }
  return {
    blips,
    pibOf: (image) => {
      const pib = pibByKey.get(`${image.format}:${image.base64}`);
      if (pib === undefined) {
        throw new PptUnsupportedContentError(
          "internal error: an image block reached the drawing writer without first being collected into the document's blip store",
        );
      }
      return pib;
    },
  };
}

// Streams a caller already holds two [MS-PPT] artifacts for -- the same split readPptStreams exposes on the way in, so a caller assembling its own container can bypass writePptContent's archive-codec dependency entirely.
export function writePptStreams(
  document: PptDocument,
  options: WritePptOptions = {},
): {
  readonly currentUserStream: Uint8Array<ArrayBuffer>;
  readonly powerPointDocumentStream: Uint8Array<ArrayBuffer>;
} {
  options.signal?.throwIfAborted();
  const { slides } = document;
  const size = requireOneSlideSize(slides);
  const sink = options.sink ?? NOOP_PPT_DIAGNOSTIC_SINK;

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
  const store = planBlipStore(slides);
  const strict = options.onUnwritableBlock === "throw";
  const contextFor = (location: string): DrawingWriteContext => ({
    fontIndexOf,
    blipIndexOf: store.pibOf,
    sink,
    strict,
    location,
  });

  const slidePersistRefs: SlidePersistRef[] = slides.map((_slide, index) => ({
    persistIdRef: FIRST_SLIDE_PERSIST_ID + index,
    slideId: FIRST_SLIDE_ID + index,
  }));

  // Only a slide that actually carries notes gets a NotesContainer, and only such a slide's own SlideAtom names one. A slide with no notes is left with no notes slide at all rather than an empty one: readNotesBySlideId then finds nothing for it and read.ts reports "", which is exactly what an absent notes slide means -- whereas an empty NotesContainer would be a real notes slide that happens to say nothing, a different fact, and one no round trip could tell apart from the notes the caller never wrote. The ids are assigned before any container is built, because a slide's own container has to name its notes slide's id.
  const notesIdRefs = slides.map((slide, index) =>
    slide.notes.length === 0
      ? NO_NOTES_ID_REF
      : FIRST_NOTES_ID +
        slides.slice(0, index).filter((earlier) => earlier.notes.length > 0)
          .length,
  );
  const notesCount = notesIdRefs.filter((id) => id !== NO_NOTES_ID_REF).length;

  // Persist identifiers reserved above run 1 (document) .. 2 (master) .. 3..3+slides.length-1 (slides) .. one further contiguous run per slide with notes -- so an OLE embed's own persist objects are the ones minted after every one of those, never interleaved with them, which is what lets planOleEmbeds hand out its own ids purely by counting rather than needing to know any other object's identifier.
  const oleEmbeds = planOleEmbeds(
    slides,
    options.serialiseEmbeddedObject,
    FIRST_SLIDE_PERSIST_ID + slides.length + notesCount,
  );

  // The document-wide OfficeArtFDGG facts, accumulated from what every drawing writer actually emitted rather than stated as constants: cspSaved is every shape container in every drawing, spidMax the highest identifier any of them minted, cdgSaved the number of DrawingContainers written.
  let shapeCount = 0;
  let maxSpid = 0;
  let drawingCount = 0;
  const account = (drawing: DrawingWritten): void => {
    shapeCount += drawing.shapeCount;
    maxSpid = Math.max(maxSpid, drawing.maxSpid);
    drawingCount += 1;
  };

  const mainMaster = writeMainMaster(size, contextFor("the main master"));
  account(mainMaster);
  const slideContainers = slides.map((slide, index) => {
    const ref = slidePersistRefs[index];
    const notesIdRef = notesIdRefs[index];
    if (ref === undefined || notesIdRef === undefined) {
      throw new PptUnsupportedContentError(
        "internal error: slide persist reference missing for a slide being written",
      );
    }
    const container = writeSlideContainer(
      slide.shapes,
      notesIdRef,
      contextFor(`slide ${index + 1}`),
      oleEmbeds.clientDataFor,
    );
    account(container);
    return { persistId: ref.persistIdRef, bytes: container.bytes };
  });

  const notesPersists: NotesPersist[] = [];
  const notesContainers: {
    persistId: number;
    bytes: Uint8Array<ArrayBuffer>;
  }[] = [];
  slides.forEach((slide, index) => {
    const notesId = notesIdRefs[index];
    if (notesId === undefined || notesId === NO_NOTES_ID_REF) {
      return;
    }
    const persistIdRef =
      FIRST_SLIDE_PERSIST_ID + slides.length + notesPersists.length;
    notesPersists.push({ persistIdRef, notesId });
    const container = writeNotesContainer(
      FIRST_SLIDE_ID + index,
      slide.notes,
      size,
      contextFor(`slide ${index + 1}'s speaker notes`),
    );
    account(container);
    notesContainers.push({ persistId: persistIdRef, bytes: container.bytes });
  });

  // [MS-PPT] 2.4.1 orders the DocumentContainer's children: documentAtom, then the optional exObjList, then documentTextInfo (this package's RT_Environment), then the DrawingGroupContainer carrying the blip store, then the master, slide and notes lists. The drawing group's FDGG counts are the ones accumulated above, so the document-wide shape bookkeeping is derived from the drawings actually written rather than restated alongside them.
  const environment = writeEnvironment(fontNames);
  const documentChildren: Uint8Array<ArrayBuffer>[] = [writeDocumentAtom(size)];
  const exObjList = writeExObjListContainer(oleEmbeds.embeds);
  if (exObjList !== undefined) {
    documentChildren.push(exObjList);
  }
  if (environment !== undefined) {
    documentChildren.push(environment);
  }
  documentChildren.push(
    writeDrawingGroupContainer(store.blips, {
      spidMax: maxSpid,
      shapeCount,
      drawingCount,
    }),
  );
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
    { persistId: MASTER_PERSIST_ID, bytes: mainMaster.bytes },
    ...slideContainers,
    ...notesContainers,
    ...oleEmbeds.persistObjects,
  ];

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
  options: WritePptOptions = {},
): Uint8Array<ArrayBuffer> {
  const { currentUserStream, powerPointDocumentStream } = writePptStreams(
    document,
    options,
  );
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
export function writePpt(
  tree: DocumentTree,
  options: WritePptOptions = {},
): Uint8Array<ArrayBuffer> {
  const content = flattenTree(tree);
  if (content.kind !== "presentation") {
    throw new PptUnsupportedContentError(
      `ppt-codec's writer only writes presentation documents; got a '${content.kind}' document`,
    );
  }
  return writePptContent(
    {
      metadata: content.metadata,
      slides: content.slides,
    },
    options,
  );
}
