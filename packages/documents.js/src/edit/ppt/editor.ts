import {
  SLIDE_SIZE_WIDESCREEN,
  type ContentDocument,
  type ContentSlide,
  type LayoutMetadata,
  type PageSize,
} from "document-schema.js";
import { resolveMetadataTimestamps } from "../../model/metadata";
import { readPptContent } from "../../ppt/read";
import { writePptContent } from "../../ppt/write";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { buildSlide, PptSlide } from "./slide";

// The presentation member of the ContentDocument union, narrowed once so the editor's field keeps the constructor guard's shape.
type PresentationDocument = Extract<ContentDocument, { kind: "presentation" }>;

export interface CreatePptOptions {
  readonly clock?: ClockPort;
}

// A genuine live-view editor over a mutable presentation ContentDocument -- the ppt sibling of DocEditor/XlsEditor/MarkdownEditor. ppt-codec reads and writes through this package's own src/ppt envelope adapters (its native shape is the flat { metadata, slides }), so openPpt wraps readPptContent's ContentDocument and toBytes() unwraps back through writePptContent. Every PptSlide/PptShape holds a direct reference into document.slides (and each slide's own shapes array); unlike a fresh odp/pptx package (both deliberately scaffold empty), a presentation ContentDocument has no shared slide-geometry scaffold to target, so slide size is stated per slide and addSlide's default is PowerPoint's own widescreen default.
export class PptEditor {
  private readonly document: PresentationDocument;

  constructor(document: ContentDocument) {
    if (document.kind !== "presentation") {
      throw new Error(
        `PptEditor requires a presentation ContentDocument, got "${document.kind}"`,
      );
    }
    this.document = document;
  }

  get metadata(): LayoutMetadata {
    return this.document.metadata;
  }

  set metadata(value: LayoutMetadata) {
    this.document.metadata = value;
  }

  slides(): PptSlide[] {
    return this.document.slides.map(
      (slide) => new PptSlide(this.document.slides, slide),
    );
  }

  addSlide(size: PageSize = SLIDE_SIZE_WIDESCREEN): PptSlide {
    const node: ContentSlide = buildSlide(size);
    this.document.slides.push(node);
    return new PptSlide(this.document.slides, node);
  }

  removeSlideAt(index: number): void {
    this.document.slides.splice(index, 1);
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return writePptContent(this.document);
  }
}

export function openPpt(bytes: Uint8Array<ArrayBuffer>): PptEditor {
  return new PptEditor(readPptContent(bytes));
}

// Creates a fresh empty presentation with real metadata timestamps -- zero slides, mirroring createOdp/createPptx's own deliberately-empty scaffolds (see odp's scaffold.ts: "office:presentation starts empty").
export function createPpt(options: CreatePptOptions = {}): PptEditor {
  const clock = options.clock ?? systemClock;
  const document: ContentDocument = {
    kind: "presentation",
    metadata: resolveMetadataTimestamps({}, clock),
    slides: [],
  };
  return new PptEditor(document);
}
