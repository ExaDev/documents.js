import type { ContentBlock } from "document-schema.js";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, MarkdownParagraph } from "./paragraph";

export interface MarkdownListInit {
  readonly type: "bullet" | "ordered";
  readonly start?: number;
  readonly task?: boolean;
  readonly loose?: boolean;
}

// A thin handle remembering a numId minted via markdown-codec's own mintListNumId (MarkdownEditor.body.startList), for subsequent MarkdownParagraph.list assignments -- unlike OdtList (src/edit/odt/list.ts), which is a live view over a real, structurally-nested text:list element, markdown has no structural list container at all: every list item is simply an ordinary top-level paragraph carrying a flat {numId, level} membership, exactly matching docx's own flat model (see DocxParagraph.list, src/edit/docx/paragraph.ts) rather than ODF's structurally-nested one. appendItem appends a body paragraph directly to this list's own container (the same blocks array MarkdownBody.appendParagraph pushes onto) and stamps its .list accordingly, so items interleave with ordinary paragraphs and tables in document order exactly as markdown-codec's own dist/emit/emit.js emitBlocks expects (it recognises a list region by scanning for consecutive paragraph blocks that carry .list, not by any container boundary).
export class MarkdownList {
  readonly numId: string;
  private readonly container: ContentBlock[];

  constructor(numId: string, container: ContentBlock[]) {
    this.numId = numId;
    this.container = container;
  }

  // level defaults to 0 (top level); a caller building a nested list passes the deeper level directly -- markdown-codec's own numId carries no nesting information of its own, only ContentListMembership.level does, matching docx's identical convention.
  appendItem(level = 0, init?: ParagraphInit): MarkdownParagraph {
    const node = buildParagraph(init);
    node.list = { numId: this.numId, level };
    this.container.push(node);
    return new MarkdownParagraph(this.container, node);
  }
}
