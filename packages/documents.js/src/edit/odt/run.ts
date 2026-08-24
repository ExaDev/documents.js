import type { Package, XmlElement, XmlNode } from "odf.js";
import type { Color as LayoutColor } from "document-schema.js";
import { removeChild } from "../../xml/edit";
import { el } from "../../xml/fragment";
import { decodeOdfText, encodeOdfText } from "../../xml/odf-text";
import { applyStyleChange, readCurrentStyleProperties } from "./props";

export interface RunInit {
  readonly text?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly fontFamily?: string;
  readonly sizePt?: number;
  readonly color?: LayoutColor;
}

// A live view over a text:span element -- see docx's run.ts (src/edit/docx/run.ts) for the same live-view rationale: every getter/setter reads or mutates the actual node inside the decoded Package, so saving is nothing more than encodePackage(pkg). Every OdtParagraph.appendRun/insertRunAt call (paragraph.ts) always creates a text:span, even for a run with no formatting at all (a text:span with no text:style-name attribute is valid ODF and renders identically to plain inline text) -- this keeps every run this editor creates uniformly addressable and mutable later, unlike a bare text node, which could not later be repointed at a style without first being replaced by a span. OdtParagraph.runs() mirrors this: it only surfaces text:span children as OdtRun objects. A real ODF file's plain, unstyled text directly inside text:p (which LibreOffice writes whenever a stretch of text carries no character-level formatting at all) is still part of the paragraph's own text -- see OdtParagraph.text, which reads it via decodeOdfText same as anything else -- but it is not independently addressable/mutable through this editor. This is a deliberate, bounded scope decision, not a silent gap: wrap new content via appendRun (which always creates a real text:span) to get something mutable.
export class OdtRun {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly pkg: Package;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, pkg: Package) {
    this.container = container;
    this.node = node;
    this.pkg = pkg;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error(
        "this OdtRun has been removed from its paragraph and can no longer be used",
      );
    }
    return this.node;
  }

  // *** decodeOdfText, NEVER ooxml.js's textContent() -- see src/xml/odf-text.ts's own top-of-file warning. textContent() is a plain text-node concatenation with no idea text:s/text:tab/text:line-break exist, and would silently DROP every one of them: the file still parses, so this bug produces no error, nothing -- just silently wrong, silently shorter text. Repeated here because every ODF text getter in this codebase must carry this warning at its own call site, not just in odf-text.ts. ***
  get text(): string {
    return decodeOdfText(this.live().children);
  }

  set text(value: string) {
    this.live().children = encodeOdfText(value);
  }

  get bold(): boolean {
    return (
      readCurrentStyleProperties(this.pkg, this.live(), "text").bold ?? false
    );
  }

  set bold(value: boolean) {
    applyStyleChange(this.pkg, this.live(), "text", { bold: value });
  }

  get italic(): boolean {
    return (
      readCurrentStyleProperties(this.pkg, this.live(), "text").italic ?? false
    );
  }

  set italic(value: boolean) {
    applyStyleChange(this.pkg, this.live(), "text", { italic: value });
  }

  get underline(): boolean {
    return (
      readCurrentStyleProperties(this.pkg, this.live(), "text").underline ??
      false
    );
  }

  set underline(value: boolean) {
    applyStyleChange(this.pkg, this.live(), "text", { underline: value });
  }

  get strike(): boolean {
    return (
      readCurrentStyleProperties(this.pkg, this.live(), "text").strike ?? false
    );
  }

  set strike(value: boolean) {
    applyStyleChange(this.pkg, this.live(), "text", { strike: value });
  }

  get fontFamily(): string | undefined {
    return readCurrentStyleProperties(this.pkg, this.live(), "text").fontFamily;
  }

  set fontFamily(value: string) {
    applyStyleChange(this.pkg, this.live(), "text", { fontFamily: value });
  }

  get sizePt(): number | undefined {
    return readCurrentStyleProperties(this.pkg, this.live(), "text").sizePt;
  }

  set sizePt(value: number) {
    applyStyleChange(this.pkg, this.live(), "text", { sizePt: value });
  }

  get color(): LayoutColor | undefined {
    return readCurrentStyleProperties(this.pkg, this.live(), "text").color;
  }

  set color(value: LayoutColor) {
    applyStyleChange(this.pkg, this.live(), "text", { color: value });
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

// Builds a fresh text:span from scratch (not a live view -- for constructing new runs to append or insert, whose properties are then read back through OdtRun once inserted into the tree). Applying init's properties by constructing a throwaway OdtRun over the new node and driving it through the exact same setters every later mutation uses, rather than duplicating the resolve-merge-intern logic here a second time -- the throwaway container ([]) is never touched, since remove() is never called during construction.
export function buildRun(pkg: Package, init: RunInit = {}): XmlElement {
  const node = el("text:span");
  if (init.text !== undefined) {
    node.children = encodeOdfText(init.text);
  }
  const run = new OdtRun([], node, pkg);
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
  if (init.fontFamily !== undefined) {
    run.fontFamily = init.fontFamily;
  }
  if (init.sizePt !== undefined) {
    run.sizePt = init.sizePt;
  }
  if (init.color !== undefined) {
    run.color = init.color;
  }
  return node;
}
