import {
  PAGE_SIZE_LETTER,
  type ContentDocument,
  type LayoutMetadata,
  type ContentParagraph as ContentParagraphNode,
  type ContentSection,
  type ContentTable as ContentTableNode,
  type Margins,
  type PageSize,
} from "document-schema.js";
import { readDocContent, writeDocContent } from "doc-codec";
import type { WriteDocContentOptions } from "doc-codec";
import {
  mergeMetadata,
  type MetadataOverrides,
} from "../../metadata/core-patch";
import { resolveMetadataTimestamps } from "../../model/metadata";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, DocParagraph } from "./paragraph";
import type { TableInit } from "./table";
import { buildTable, DocTable } from "./table";

// Word's own default margins: 1 inch (72pt) on every side. No schema-level constant exists for this (document-schema.js exports the page-size constants but not margin defaults), so the value lives here, next to its only consumer.
const DEFAULT_MARGINS: Margins = {
  topPt: 72,
  rightPt: 72,
  bottomPt: 72,
  leftPt: 72,
};

// The wordprocessing member of the ContentDocument union, narrowed once here so the editor's own field keeps the guard's narrowed shape for every later use (the constructor's kind check narrows only the parameter, never a field re-read).
type WordprocessingDocument = Extract<
  ContentDocument,
  { kind: "wordprocessing" }
>;

export interface SectionInit {
  readonly pageSize?: PageSize;
  readonly margins?: Margins;
  readonly breakType?: ContentSection["breakType"];
}

// One [MS-DOC] section: a live view over a ContentSection object inside the editor's own sections array. doc-codec's writer gives every section its own real page size and margins (see its write.ts top comment), so unlike MarkdownEditor -- which hard-scopes to sections[0] because a markdown document IS one section -- this editor surfaces every section, and each one's own geometry genuinely round-trips.
export class DocSection {
  private readonly container: ContentSection[];
  private readonly node: ContentSection;
  private removed = false;

  constructor(container: ContentSection[], node: ContentSection) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentSection {
    if (this.removed) {
      throw new Error(
        "this DocSection has been removed from its document and can no longer be used",
      );
    }
    return this.node;
  }

  get pageSize(): PageSize {
    return this.live().pageSize;
  }

  set pageSize(value: PageSize) {
    this.live().pageSize = value;
  }

  get margins(): Margins {
    return this.live().margins;
  }

  set margins(value: Margins) {
    this.live().margins = value;
  }

  get breakType(): ContentSection["breakType"] {
    return this.live().breakType;
  }

  set breakType(value: ContentSection["breakType"]) {
    const node = this.live();
    if (value === undefined) {
      delete node.breakType;
    } else {
      node.breakType = value;
    }
  }

  // Direct top-level blocks only -- a paragraph inside a table cell is reached via DocTable, mirroring MarkdownBody.paragraphs' own direct-children-only scope (and DocxEditor/OdtEditor's, which those two cite).
  paragraphs(): DocParagraph[] {
    return this.live()
      .blocks.filter(
        (block): block is ContentParagraphNode => block.kind === "paragraph",
      )
      .map((block) => new DocParagraph(this.live().blocks, block));
  }

  appendParagraph(init?: ParagraphInit): DocParagraph {
    const node = this.live();
    const paragraph = buildParagraph(init);
    node.blocks.push(paragraph);
    return new DocParagraph(node.blocks, paragraph);
  }

  tables(): DocTable[] {
    return this.live()
      .blocks.filter(
        (block): block is ContentTableNode => block.kind === "table",
      )
      .map((block) => new DocTable(this.live().blocks, block));
  }

  appendTable(init: TableInit): DocTable {
    const node = this.live();
    const table = buildTable(init);
    node.blocks.push(table);
    return new DocTable(node.blocks, table);
  }

  remove(): void {
    // [MS-DOC] requires at least one section -- writeDocContent throws on an empty sections array -- so removing the last section is refused here rather than deferred to the write.
    if (this.container.length === 1) {
      throw new Error(
        "a doc document must carry at least one section; the last one cannot be removed",
      );
    }
    const index = this.container.indexOf(this.node);
    if (index !== -1) {
      this.container.splice(index, 1);
    }
    this.removed = true;
  }
}

// The first section's own block-flow handle, mirroring MarkdownBody's shape exactly (paragraphs/appendParagraph/tables/appendTable) so every caller written against docx's or odt's or markdown's `.body` works unchanged -- the docx/odt/markdown family's one shared editor surface. Multiple sections remain reachable through sections()/appendSection(); body always views the FIRST one.
export interface DocBody {
  paragraphs(): DocParagraph[];
  appendParagraph(init?: ParagraphInit): DocParagraph;
  tables(): DocTable[];
  appendTable(init: TableInit): DocTable;
}

class DocBodyImpl implements DocBody {
  constructor(private readonly section: ContentSection) {}

  paragraphs(): DocParagraph[] {
    return this.section.blocks
      .filter(
        (block): block is ContentParagraphNode => block.kind === "paragraph",
      )
      .map((block) => new DocParagraph(this.section.blocks, block));
  }

  appendParagraph(init?: ParagraphInit): DocParagraph {
    const paragraph = buildParagraph(init);
    this.section.blocks.push(paragraph);
    return new DocParagraph(this.section.blocks, paragraph);
  }

  tables(): DocTable[] {
    return this.section.blocks
      .filter((block): block is ContentTableNode => block.kind === "table")
      .map((block) => new DocTable(this.section.blocks, block));
  }

  appendTable(init: TableInit): DocTable {
    const table = buildTable(init);
    this.section.blocks.push(table);
    return new DocTable(this.section.blocks, table);
  }
}

export interface CreateDocOptions {
  readonly clock?: ClockPort;
  readonly pageSize?: PageSize;
  readonly margins?: Margins;
}

// A genuine live-view editor over a mutable in-memory ContentDocument, the doc sibling of MarkdownEditor (see src/edit/markdown/editor.ts): doc has no XmlElement tree the way docx/odt each do -- doc-codec's reader and writer both operate on the plain ContentDocument directly -- so there is nothing for a live view to hold a reference into except the ContentDocument object itself. Every DocSection/DocParagraph/DocRun/DocTable created from it holds a direct reference to the actual object living inside document.sections (or nested inside it), exactly mirroring how MarkdownParagraph/MarkdownRun hold a reference into markdown's own ContentDocument.
//
// Saving is toBytes(): writeDocContent(this.document, options) -- the whole document, every section, not just the parts some accessor reached. The read-side extras readDocContent attaches beyond ContentDocument's own shape (numbering definitions, footnotes, endnotes, comments, header/footer stories -- see doc-codec's DocContent) are preserved on the in-memory object this editor holds but are not themselves editable here and do not survive a save: writeDocContent reads only the shared ContentDocument shape, the identical read-and-drop relationship readDocxContent's own extras have in the docx editor.
export class DocEditor {
  readonly body: DocBody;
  private readonly document: WordprocessingDocument;

  constructor(document: ContentDocument) {
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `DocEditor requires a wordprocessing ContentDocument, got "${document.kind}"`,
      );
    }
    const first = document.sections[0];
    if (first === undefined) {
      throw new Error("a doc document must carry at least one section");
    }
    this.document = document;
    this.body = new DocBodyImpl(first);
  }

  get metadata(): LayoutMetadata {
    return this.document.metadata;
  }

  // The patch-style MetadataOverrides setter every other editor's own metadata setter takes (docx/pptx/odt/odp/ods/odg/pdf -- see src/metadata/core-patch.ts): only the fields the caller names change, and the named fields round-trip through writeDocContent's own SummaryInformation stream.
  set metadata(value: MetadataOverrides) {
    this.document.metadata = mergeMetadata(this.document.metadata, value);
  }

  sections(): DocSection[] {
    return this.document.sections.map(
      (section) => new DocSection(this.document.sections, section),
    );
  }

  // The first section's own paragraph/table accessors, forwarded through body for editor-shape parity with MarkdownEditor.paragraphs()/tables() -- the natural surface for the common single-section document.
  paragraphs(): DocParagraph[] {
    return this.body.paragraphs();
  }

  appendParagraph(init?: ParagraphInit): DocParagraph {
    return this.body.appendParagraph(init);
  }

  tables(): DocTable[] {
    return this.body.tables();
  }

  appendTable(init: TableInit): DocTable {
    return this.body.appendTable(init);
  }

  appendSection(init: SectionInit = {}): DocSection {
    const node: ContentSection = {
      pageSize: init.pageSize ?? PAGE_SIZE_LETTER,
      margins: init.margins ?? DEFAULT_MARGINS,
      blocks: [],
    };
    if (init.breakType !== undefined) {
      node.breakType = init.breakType;
    }
    this.document.sections.push(node);
    return new DocSection(this.document.sections, node);
  }

  toBytes(options?: WriteDocContentOptions): Uint8Array<ArrayBuffer> {
    return writeDocContent(this.document, options);
  }
}

export function openDoc(
  bytes: Uint8Array<ArrayBuffer>,
  password?: string,
): DocEditor {
  return new DocEditor(readDocContent(bytes, password));
}

// Creates a fresh doc document with real metadata createdIso/modifiedIso timestamps -- mirrors createMarkdownEditor's own default-on clock behaviour exactly (src/edit/markdown/editor.ts), which itself mirrors createOdt's. The page default is US Letter rather than A4: that is [MS-DOC]'s own producer default (the page size a Word document with no explicit w:sectPr/w:pgSz carries), the identical default document-schema.js's own PAGE_SIZE_LETTER comment states for docx.
export function createDoc(options: CreateDocOptions = {}): DocEditor {
  const clock = options.clock ?? systemClock;
  const document: ContentDocument = {
    kind: "wordprocessing",
    metadata: resolveMetadataTimestamps({}, clock),
    sections: [
      {
        pageSize: options.pageSize ?? PAGE_SIZE_LETTER,
        margins: options.margins ?? DEFAULT_MARGINS,
        blocks: [],
      },
    ],
  };
  return new DocEditor(document);
}
