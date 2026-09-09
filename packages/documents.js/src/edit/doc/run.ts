import type { Color, ContentRun } from "document-schema.js";

export interface RunInit {
  readonly text?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly sizePt?: number;
  readonly color?: Color;
  readonly fontFamily?: string;
}

// A live view over a ContentRun object living inside a DocParagraph's own runs array -- the identical live-view contract MarkdownRun applies over the same node shape (see markdown's run.ts): doc has no XmlElement tree to hold a reference into either (doc-codec reads and writes the plain ContentDocument directly), so this holds the ContentRun object itself and mutates its properties in place. As long as the object is never replaced wholesale in its container array (only its own properties are assigned), the reference stays live.
//
// The exposed property set is exactly the set doc-codec's own writer encodes as direct character-exception sprms (src/prop/chp-write.ts: bold, italic, underline, strike, sizePt, color, fontFamily) -- every one of those round-trips through writeDocContent and back through readDocContent. MarkdownRun's own hyperlink/code setters have no counterpart here because [MS-DOC]'s own writer support does not exist for them: writeDocContent states no hyperlinks or fields at all (see its own top comment), and a code-span monospace view over fontFamily would imply a markdown semantics doc never had. The property sets are nevertheless near-identical to DocxRun/OdtRun's own rich subset for the same reason: doc-codec's writer genuinely encodes all seven.
export class DocRun {
  private readonly container: ContentRun[];
  private readonly node: ContentRun;
  private removed = false;

  constructor(container: ContentRun[], node: ContentRun) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentRun {
    if (this.removed) {
      throw new Error(
        "this DocRun has been removed from its paragraph and can no longer be used",
      );
    }
    return this.node;
  }

  get text(): string {
    return this.live().text;
  }

  set text(value: string) {
    this.live().text = value;
  }

  get bold(): boolean {
    return this.live().bold ?? false;
  }

  set bold(value: boolean) {
    const node = this.live();
    if (value) {
      node.bold = true;
    } else {
      delete node.bold;
    }
  }

  get italic(): boolean {
    return this.live().italic ?? false;
  }

  set italic(value: boolean) {
    const node = this.live();
    if (value) {
      node.italic = true;
    } else {
      delete node.italic;
    }
  }

  get underline(): boolean {
    return this.live().underline ?? false;
  }

  set underline(value: boolean) {
    const node = this.live();
    if (value) {
      node.underline = true;
    } else {
      delete node.underline;
    }
  }

  get strike(): boolean {
    return this.live().strike ?? false;
  }

  set strike(value: boolean) {
    const node = this.live();
    if (value) {
      node.strike = true;
    } else {
      delete node.strike;
    }
  }

  get sizePt(): number | undefined {
    return this.live().sizePt;
  }

  set sizePt(value: number | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.sizePt;
    } else {
      node.sizePt = value;
    }
  }

  get color(): Color | undefined {
    return this.live().color;
  }

  set color(value: Color | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.color;
    } else {
      node.color = value;
    }
  }

  get fontFamily(): string | undefined {
    return this.live().fontFamily;
  }

  set fontFamily(value: string | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.fontFamily;
    } else {
      node.fontFamily = value;
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

// Builds a fresh ContentRun from scratch (not a live view -- for constructing new runs to append or insert, whose properties are then read back through DocRun once inserted into a paragraph's runs array). Mirrors markdown's run.ts buildRun: applies init's properties by constructing a throwaway DocRun over the new node and driving it through the exact same setters every later mutation uses.
export function buildRun(init: RunInit = {}): ContentRun {
  const node: ContentRun = { text: init.text ?? "" };
  const run = new DocRun([], node);
  if (init.bold !== undefined) {
    run.bold = init.bold;
  }
  if (init.italic !== undefined) {
    run.italic = init.italic;
  }
  if (init.underline !== undefined) {
    run.underline = init.underline;
  }
  if (init.strike !== undefined) {
    run.strike = init.strike;
  }
  if (init.sizePt !== undefined) {
    run.sizePt = init.sizePt;
  }
  if (init.color !== undefined) {
    run.color = init.color;
  }
  if (init.fontFamily !== undefined) {
    run.fontFamily = init.fontFamily;
  }
  return node;
}
