import type { ContentRun } from "document-schema.js";
import { MONOSPACE_FONT_FAMILY } from "markdown-codec";

export interface RunInit {
  readonly text?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly strike?: boolean;
  readonly hyperlink?: string;
  readonly code?: boolean;
}

// A live view over a ContentRun object living inside a MarkdownParagraph's own runs array -- see odt's run.ts (OdtRun) for the same live-view rationale, adapted for a format with no XmlElement tree at all: markdown has nothing for a live view to hold a reference into except the plain ContentRun object itself, so this holds that object directly and mutates its properties in place, exactly the way OdtRun mutates an XmlElement's attributes. As long as the object is never replaced wholesale in its container array (only its own properties are assigned), the reference stays live.
//
// The exposed property set is deliberately narrower than OdtRun/DocxRun's own: underline, sizePt, color, and a free-form fontFamily setter are all OMITTED because none of them round-trip through markdown-codec's own lower/emit pair at all -- confirmed against that package's real dist/lower/inline.js (buildRun reads only style.bold/italic/strike/hyperlink, plus a fontFamily parameter it only ever sets to MONOSPACE_FONT_FAMILY for a code span) and dist/emit/inline.js (renderLeaf/emitRuns read only run.text/bold/italic/strike/hyperlink/fontFamily, the last solely to detect a code span) -- neither module reads or writes ContentRun.sizePt/color at all, and ContentRun itself carries no underline field, since CommonMark/GFM has no underline syntax. `code` is the one addition with no OdtRun/DocxRun analogue: it is not a separate ContentRun field but a thin boolean view over fontFamily === MONOSPACE_FONT_FAMILY, mirroring exactly how markdown-codec's own emit/inline.ts renderLeaf recognises a code span on the way back out (a run styled with the Courier New font family, not a dedicated flag).
export class MarkdownRun {
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
        "this MarkdownRun has been removed from its paragraph and can no longer be used",
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

  get hyperlink(): string | undefined {
    return this.live().hyperlink;
  }

  set hyperlink(value: string | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.hyperlink;
    } else {
      node.hyperlink = value;
    }
  }

  get code(): boolean {
    return this.live().fontFamily === MONOSPACE_FONT_FAMILY;
  }

  set code(value: boolean) {
    const node = this.live();
    if (value) {
      node.fontFamily = MONOSPACE_FONT_FAMILY;
    } else if (node.fontFamily === MONOSPACE_FONT_FAMILY) {
      delete node.fontFamily;
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

// Builds a fresh ContentRun from scratch (not a live view -- for constructing new runs to append or insert, whose properties are then read back through MarkdownRun once inserted into a paragraph's runs array). Mirrors odt's run.ts buildRun: applies init's properties by constructing a throwaway MarkdownRun over the new node and driving it through the exact same setters every later mutation uses.
export function buildRun(init: RunInit = {}): ContentRun {
  const node: ContentRun = { text: init.text ?? "" };
  const run = new MarkdownRun([], node);
  if (init.bold !== undefined) {
    run.bold = init.bold;
  }
  if (init.italic !== undefined) {
    run.italic = init.italic;
  }
  if (init.strike !== undefined) {
    run.strike = init.strike;
  }
  if (init.hyperlink !== undefined) {
    run.hyperlink = init.hyperlink;
  }
  if (init.code !== undefined) {
    run.code = init.code;
  }
  return node;
}
