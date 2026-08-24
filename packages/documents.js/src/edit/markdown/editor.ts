import type {
  ContentBlock,
  ContentDocument,
  ContentParagraph as ContentParagraphNode,
  ContentTable as ContentTableNode,
} from "document-schema.js";
import type {
  NumIdMintState,
  ReadMarkdownOptions,
  WriteMarkdownOptions,
} from "markdown-codec";
import { createNumIdMintState, mintListNumId } from "markdown-codec";
import type { Margins, PageSize } from "document-schema.js";
import { resolveMetadataTimestamps } from "../../model/metadata";
import { readMarkdownContent } from "../../markdown/read";
import { buildMarkdownText } from "../../markdown/write";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import type { MarkdownListInit } from "./list";
import { MarkdownList } from "./list";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, MarkdownParagraph } from "./paragraph";
import type { TableInit } from "./table";
import { buildTable, MarkdownTable } from "./table";

export interface MarkdownBody {
  paragraphs(): MarkdownParagraph[];
  appendParagraph(init?: ParagraphInit): MarkdownParagraph;
  tables(): MarkdownTable[];
  appendTable(init: TableInit): MarkdownTable;
  startList(init: MarkdownListInit): MarkdownList;
}

class MarkdownBodyImpl implements MarkdownBody {
  constructor(
    private readonly blocks: ContentBlock[],
    private readonly numIdState: NumIdMintState,
  ) {}

  // Direct top-level blocks only -- a paragraph inside a table cell (see table.ts) is reached via MarkdownTable, mirroring OdtEditor.paragraphs'/DocxEditor.paragraphs' own direct-children-only scope (src/edit/odt/editor.ts, src/edit/docx/editor.ts). A list item IS a direct top-level paragraph (markdown has no structural list container -- see list.ts's own top-of-file note), so it is surfaced here too, carrying its own .list membership.
  paragraphs(): MarkdownParagraph[] {
    return this.blocks
      .filter(
        (block): block is ContentParagraphNode => block.kind === "paragraph",
      )
      .map((block) => new MarkdownParagraph(this.blocks, block));
  }

  appendParagraph(init?: ParagraphInit): MarkdownParagraph {
    const node = buildParagraph(init);
    this.blocks.push(node);
    return new MarkdownParagraph(this.blocks, node);
  }

  tables(): MarkdownTable[] {
    return this.blocks
      .filter((block): block is ContentTableNode => block.kind === "table")
      .map((block) => new MarkdownTable(this.blocks, block));
  }

  appendTable(init: TableInit): MarkdownTable {
    const node = buildTable(init);
    this.blocks.push(node);
    return new MarkdownTable(this.blocks, node);
  }

  // Mints a fresh numId via markdown-codec's own mintListNumId (dist/shared/list-id.js), state-tracked per editor so a second startList call on the same editor never collides with the first's own numId. The returned MarkdownList appends directly into this same body's own blocks array -- see list.ts's own top-of-file note for why that, not a container element, is what makes a markdown list a list.
  startList(init: MarkdownListInit): MarkdownList {
    const numId = mintListNumId(this.numIdState, {
      type: init.type,
      start: init.start,
      task: init.task ?? false,
      loose: init.loose ?? false,
    });
    return new MarkdownList(numId, this.blocks);
  }
}

export interface CreateMarkdownEditorOptions {
  readonly clock?: ClockPort;
  readonly pageSize?: PageSize;
  readonly margins?: Margins;
}

// A genuine live-view editor over a mutable in-memory ContentDocument -- markdown has no XML tree the way docx/pptx/odt/odp/ods/odg each do (see src/markdown/write.ts's own top-of-file note on why buildMarkdownText lives beside readMarkdownContent rather than under src/edit/), so there is nothing for a live view to hold a reference into except the plain ContentDocument object itself. This editor holds that object directly and mutates it in place -- every MarkdownParagraph/MarkdownRun/MarkdownTable/MarkdownTableCell created from it holds a direct reference to the actual object living inside document.sections[0].blocks (or nested inside it), exactly mirroring how OdtParagraph/OdtRun hold a reference into a real XmlElement tree. Saving is nothing more than calling toMarkdownText(), which re-derives markdown text from whatever the document currently holds -- there is no intermediate byte representation to keep in sync, unlike toBytes() on every other editor in this package.
export class MarkdownEditor {
  readonly body: MarkdownBody;
  private readonly document: ContentDocument;

  constructor(document: ContentDocument) {
    if (document.kind !== "wordprocessing") {
      throw new Error(
        `MarkdownEditor requires a wordprocessing ContentDocument, got "${document.kind}"`,
      );
    }
    const section = document.sections[0];
    if (section === undefined) {
      throw new Error("markdown ContentDocument carries no sections");
    }
    this.document = document;
    this.body = new MarkdownBodyImpl(section.blocks, createNumIdMintState());
  }

  paragraphs(): MarkdownParagraph[] {
    return this.body.paragraphs();
  }

  tables(): MarkdownTable[] {
    return this.body.tables();
  }

  // Re-derives markdown text from this editor's current document on every call -- markdown-codec's own buildMarkdownText (src/markdown/write.ts) is a pure function of the ContentDocument, so there is nothing to cache and nothing that can go stale between edits and this call.
  toMarkdownText(options?: WriteMarkdownOptions): string {
    return buildMarkdownText(this.document, options);
  }
}

export function openMarkdown(
  text: string,
  options?: ReadMarkdownOptions,
): MarkdownEditor {
  return new MarkdownEditor(readMarkdownContent(text, options));
}

// Creates a fresh markdown document with real metadata createdIso/modifiedIso timestamps -- mirrors createOdt/createOdp/createOds/createOdg's own default-on clock behaviour exactly (see src/edit/odt/editor.ts's own createOdt). Built via readMarkdownContent('', ...) rather than a hand-constructed ContentDocument, reusing markdown-codec's own "every lowered document gets one empty ContentSection with A4 + 1in default page geometry" behaviour (see that package's own MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY) as the single source of truth for what an empty markdown document looks like, rather than restating it here.
export function createMarkdownEditor(
  options?: CreateMarkdownEditorOptions,
): MarkdownEditor {
  const clock = options?.clock ?? systemClock;
  const document = readMarkdownContent("", {
    pageSize: options?.pageSize,
    margins: options?.margins,
  });
  document.metadata = resolveMetadataTimestamps(document.metadata, clock);
  return new MarkdownEditor(document);
}
