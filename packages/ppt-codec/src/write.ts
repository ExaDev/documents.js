import {
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
  type SlidePersistRef,
  writeSlideListWithText,
} from "./document/slide-list-write";
import { writeSlideDrawing } from "./drawing/shapes-write";
import { PptUnsupportedContentError } from "./errors";
import {
  hasSummaryInformationFields,
  layoutMetadataToSummaryInformation,
} from "./metadata";
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

// The write path, the mirror image of read.ts: a presentation's ContentSlide[] mapped onto [MS-PPT] records (document container, slide list, one slide container per slide, each slide's drawing and text), a single-edit persist layer over them (stream/persist-write.ts), and the two [MS-CFB] streams archive-codec's writeCompoundFile wraps into real .ppt bytes. Deliberately narrower than the read path's own coverage -- see the package README's write-scope section for exactly what a written file carries and what it does not.

// [MS-PPT] persist identifiers this writer mints: 1 always names the document; slides follow contiguously from 2. Real slide ids conventionally start at 256 (this package's own synthetic-presentation fixture uses the same value) -- readSlideListWithText/read.ts never interpret the slide id itself, so any distinct sequence would round-trip identically, but 256 matches what a real PowerPoint file states.
const DOCUMENT_PERSIST_ID = 1;
const FIRST_SLIDE_ID = 256;
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

function writeSlideContainer(
  shapes: ContentSlide["shapes"],
  fontIndexOf: (family: string) => number,
): Uint8Array<ArrayBuffer> {
  return writeContainer(RT_Slide, [writeSlideDrawing(shapes, fontIndexOf)]);
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

  const slidePersistRefs: SlidePersistRef[] = slides.map((slide, index) => ({
    persistIdRef: DOCUMENT_PERSIST_ID + 1 + index,
    slideId: FIRST_SLIDE_ID + index,
  }));

  const environment = writeEnvironment(fontNames);
  const documentChildren = [writeDocumentAtom(size)];
  if (environment !== undefined) {
    documentChildren.push(environment);
  }
  documentChildren.push(writeSlideListWithText(slidePersistRefs));
  const documentContainer = writeContainer(RT_Document, documentChildren);

  const slideContainers = slides.map((slide) =>
    writeSlideContainer(slide.shapes, fontIndexOf),
  );

  const persistEntries = [{ persistId: DOCUMENT_PERSIST_ID, offset: 0 }];
  let offset = documentContainer.length;
  slideContainers.forEach((container, index) => {
    const ref = slidePersistRefs[index];
    if (ref === undefined) {
      throw new PptUnsupportedContentError(
        "internal error: slide container count does not match slide persist reference count",
      );
    }
    persistEntries.push({ persistId: ref.persistIdRef, offset });
    offset += container.length;
  });
  const persistDirectoryOffset = offset;
  const persistDirectory = writePersistDirectoryAtom(persistEntries);

  const userEditOffset = persistDirectoryOffset + persistDirectory.length;
  const lastSlideId = slidePersistRefs.at(-1)?.slideId ?? 0;
  const userEdit = writeUserEditAtom({
    lastSlideIdRef: lastSlideId,
    offsetLastEdit: 0,
    offsetPersistDirectory: persistDirectoryOffset,
    docPersistIdRef: DOCUMENT_PERSIST_ID,
    persistIdSeed: DOCUMENT_PERSIST_ID + slides.length + 1,
  });

  const currentUserAtom = writeCurrentUserAtom(userEditOffset);

  return {
    currentUserStream: currentUserAtom,
    powerPointDocumentStream: concatBytes(
      documentContainer,
      ...slideContainers,
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
