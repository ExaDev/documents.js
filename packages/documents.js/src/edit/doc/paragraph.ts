import type {
  Alignment,
  ContentBlock,
  ContentListMembership,
  ContentParagraph as ContentParagraphNode,
} from "document-schema.js";
import type { RunInit } from "./run";
import { buildRun, DocRun } from "./run";

export interface ParagraphInit {
  readonly text?: string;
  readonly styleId?: string;
  readonly headingLevel?: number;
  readonly alignment?: Alignment;
}

// A live view over a ContentParagraph node in a section's blocks array (or a table cell's blocks array), mirroring MarkdownParagraph over the identical node shape. The one surface difference from markdown's own paragraph is the alignment/indent/spacing setter family: doc-codec's writer encodes each of those as a direct paragraph-exception sprm (src/prop/pap-write.ts), so unlike markdown -- whose format cannot state them at all -- a doc paragraph genuinely round-trips all of them and the editor exposes all of them.
export class DocParagraph {
  private readonly container: ContentBlock[];
  private readonly node: ContentParagraphNode;
  private removed = false;

  constructor(container: ContentBlock[], node: ContentParagraphNode) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentParagraphNode {
    if (this.removed) {
      throw new Error(
        "this DocParagraph has been removed from its container and can no longer be used",
      );
    }
    return this.node;
  }

  get text(): string {
    return this.live()
      .runs.map((run) => run.text)
      .join("");
  }

  set text(value: string) {
    const node = this.live();
    node.runs = [buildRun({ text: value })];
  }

  runs(): DocRun[] {
    return this.live().runs.map((run) => new DocRun(this.live().runs, run));
  }

  appendRun(init?: RunInit): DocRun {
    const node = this.live();
    const run = buildRun(init);
    node.runs.push(run);
    return new DocRun(node.runs, run);
  }

  insertRunAt(index: number, init?: RunInit): DocRun {
    const node = this.live();
    const run = buildRun(init);
    node.runs.splice(index, 0, run);
    return new DocRun(node.runs, run);
  }

  get styleId(): string | undefined {
    return this.live().styleId;
  }

  set styleId(value: string | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.styleId;
    } else {
      node.styleId = value;
    }
  }

  get headingLevel(): number | undefined {
    return this.live().headingLevel;
  }

  set headingLevel(level: number | undefined) {
    const node = this.live();
    if (level === undefined) {
      delete node.headingLevel;
    } else {
      node.headingLevel = level;
    }
  }

  get alignment(): Alignment | undefined {
    return this.live().alignment;
  }

  set alignment(value: Alignment | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.alignment;
    } else {
      node.alignment = value;
    }
  }

  get indentLeftPt(): number | undefined {
    return this.live().indentLeftPt;
  }

  set indentLeftPt(value: number | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.indentLeftPt;
    } else {
      node.indentLeftPt = value;
    }
  }

  get indentRightPt(): number | undefined {
    return this.live().indentRightPt;
  }

  set indentRightPt(value: number | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.indentRightPt;
    } else {
      node.indentRightPt = value;
    }
  }

  get indentFirstLinePt(): number | undefined {
    return this.live().indentFirstLinePt;
  }

  set indentFirstLinePt(value: number | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.indentFirstLinePt;
    } else {
      node.indentFirstLinePt = value;
    }
  }

  get spacingBeforePt(): number | undefined {
    return this.live().spacingBeforePt;
  }

  set spacingBeforePt(value: number | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.spacingBeforePt;
    } else {
      node.spacingBeforePt = value;
    }
  }

  get spacingAfterPt(): number | undefined {
    return this.live().spacingAfterPt;
  }

  set spacingAfterPt(value: number | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.spacingAfterPt;
    } else {
      node.spacingAfterPt = value;
    }
  }

  get list(): ContentListMembership | undefined {
    return this.live().list;
  }

  set list(value: ContentListMembership | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.list;
    } else {
      node.list = value;
    }
  }

  remove(): void {
    const node = this.live();
    const index = this.container.indexOf(node);
    if (index !== -1) {
      this.container.splice(index, 1);
    }
    this.removed = true;
  }
}

// Builds a fresh ContentParagraph node from scratch (not a live view -- for constructing new paragraphs to append, whose properties are then read back through DocParagraph once inserted into a blocks array). Mirrors markdown's paragraph.ts buildParagraph, including the empty-text special case: an empty ContentParagraph node carries one empty-text run rather than none, matching what every reader in this ecosystem produces for an empty paragraph.
export function buildParagraph(init: ParagraphInit = {}): ContentParagraphNode {
  const node: ContentParagraphNode = {
    kind: "paragraph",
    runs: [buildRun({ text: init.text ?? "" })],
  };
  const paragraph = new DocParagraph([], node);
  if (init.styleId !== undefined) {
    paragraph.styleId = init.styleId;
  }
  if (init.headingLevel !== undefined) {
    paragraph.headingLevel = init.headingLevel;
  }
  if (init.alignment !== undefined) {
    paragraph.alignment = init.alignment;
  }
  return node;
}
