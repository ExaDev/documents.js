import type { Package, XmlElement, XmlNode } from 'odf.js';
import { attr } from 'ooxml.js';
import { removeAttr, removeChild, setAttr } from '../../xml/edit';
import { el } from '../../xml/fragment';
import { decodeOdfText } from '../../xml/odf-text';
import type { Box } from 'document-schema.js';
import type { Alignment } from 'document-schema.js';
import type { ImageInit } from './image';
import { insertImageFrameMedia } from './image';
import { applyStyleChange, readCurrentStyleProperties } from './props';
import type { RunInit } from './run';
import { buildRun, OdtRun } from './run';

export interface ParagraphInit {
  readonly text?: string;
  readonly styleId?: string;
  readonly headingLevel?: number;
  readonly alignment?: Alignment;
}

// The ODF heading-style spelling of a heading depth: "Heading_20_N" (_20_ is ODF's escape for the space in "Heading N"), the name every scaffold's office:styles defines (see src/edit/odt|odp|odg/scaffold.ts). Exported because two write paths need the one spelling: the headingLevel setter below (promoting a paragraph to a real text:h), and populateParagraph's style-name mode (a draw:text-box, whose content model carries no text:h at all, pointing a heading text:p at the same definition so the depth at least keeps its visual weight).
export function headingStyleName(level: number): string {
  return `Heading_20_${String(level)}`;
}

// A live view over a text:p element -- see docx's paragraph.ts (src/edit/docx/paragraph.ts) for the same live-view rationale. List membership has no counterpart here: unlike DocxParagraph, which carries a w:numPr property naming which list/level it belongs to, ODF nests lists STRUCTURALLY (a text:list contains text:list-item elements, which directly contain the member text:p/text:h elements) -- a paragraph's list membership is a fact about where it sits in the tree, not a property on the paragraph itself. See list.ts's OdtList/OdtListItem for how list paragraphs are actually built.
export class OdtParagraph {
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
      throw new Error('this OdtParagraph has been removed from its body and can no longer be used');
    }
    return this.node;
  }

  // *** decodeOdfText, NEVER ooxml.js's textContent() -- see src/xml/odf-text.ts's own top-of-file warning: textContent() silently drops text:s/text:tab/text:line-break, producing silently-wrong, silently-shorter text with no error at all. Repeated here because every ODF text getter in this codebase must carry this warning at its own call site. ***
  get text(): string {
    return decodeOdfText(this.live().children);
  }

  runs(): OdtRun[] {
    const node = this.live();
    const out: OdtRun[] = [];
    for (const child of node.children) {
      if (child.type === 'element' && child.tag === 'text:span') {
        out.push(new OdtRun(node.children, child, this.pkg));
      }
    }
    return out;
  }

  appendRun(init?: RunInit): OdtRun {
    const node = this.live();
    const span = buildRun(this.pkg, init);
    node.children.push(span);
    return new OdtRun(node.children, span, this.pkg);
  }

  // Wraps the paragraph's last text:span child in a text:a xlink:href element, turning a just-appended run into a hyperlink. Called AFTER appendRun + all property setters, since the span's own style-name (bold/italic/etc.) must be set before wrapping -- the text:a is a parent container, not a style property. This is the write-side counterpart to odf.js's collectRuns text:a branch (which reads xlink:href back into ContentRun.hyperlink).
  wrapLastRunInHyperlink(url: string): void {
    const node = this.live();
    const lastChildIndex = node.children.length - 1;
    const lastChild = node.children[lastChildIndex];
    if (lastChild?.type !== 'element' || lastChild?.tag !== 'text:span') {
      return;
    }
    node.children[lastChildIndex] = el('text:a', { 'xlink:href': url, 'xlink:type': 'simple' }, [lastChild]);
  }

  // A tab character inside a text node is not the same as a real tab-stop advance -- ODF represents one as its own text:tab element (see src/xml/odf-text.ts's encodeOdfText), never as a literal tab byte in text-node content.
  appendTab(): void {
    this.live().children.push(el('text:tab'));
  }

  insertRunAt(index: number, init?: RunInit): OdtRun {
    const node = this.live();
    const span = buildRun(this.pkg, init);
    const spanIndices: number[] = [];
    node.children.forEach((child, i) => {
      if (child.type === 'element' && child.tag === 'text:span') {
        spanIndices.push(i);
      }
    });
    const insertAt = index < spanIndices.length ? (spanIndices[index] ?? node.children.length) : node.children.length;
    node.children.splice(insertAt, 0, span);
    return new OdtRun(node.children, span, this.pkg);
  }

  // A direct pointer at an existing NAMED style (e.g. "Heading_20_1", a style defined in office:styles rather than minted into office:automatic-styles) -- mirrors DocxParagraph's own styleId setter (src/edit/docx/paragraph.ts), which similarly writes w:pStyle directly rather than going through a cascade-aware helper. Unlike alignment/spacing below, this bypasses applyStyleChange entirely: it repoints text:style-name at a caller-supplied name outright, rather than merging a property change into whatever style is already referenced. Pointing this at a name that resolves to nothing (e.g. a raw docx-style styleId carried over from a cross-format ContentDocument) is not an error -- odf.js's own resolveStyle tolerates an unresolvable style name by contributing no properties, leaving the paragraph valid but unstyled, exactly as ODF itself does.
  get styleId(): string | undefined {
    return attr(this.live(), 'text:style-name');
  }

  set styleId(value: string | undefined) {
    const node = this.live();
    if (value === undefined) {
      removeAttr(node, 'text:style-name');
      return;
    }
    setAttr(node, 'text:style-name', value);
  }

  // The ODF heading identity, one element-state fact: a paragraph carrying it is a real text:h element with text:outline-level (the depth signal ODF's own outline and navigation read) and text:style-name pointed at the ODF heading-style spelling "Heading_20_N" (_20_ is ODF's escape for the space in "Heading N"; the levels this family gives a visual convention are defined in the scaffold's office:styles -- src/edit/odt/scaffold.ts). This is the write-side inverse of odf.js's own readParagraphOrHeading (typed/odt/read.ts), which derives BOTH the synthetic "Heading{N}" styleId and the canonical headingLevel from the one text:h element -- here the one setter writes both spellings of the same depth, so they can never disagree the way a verbatim cross-format styleId copy does. Promoting an element that already carries a style-name (e.g. a producer's unresolvable "Heading2") repoints it at the resolvable spelling; there is deliberately no way to carry a custom style name AND a heading level, because ODF's single text:style-name slot makes the heading's own style the only resolvable choice. Setting undefined demotes the element back to a plain text:p, removing the outline level and the style-name promote wrote -- the exact inverse, restoring the unstyled paragraph promote found.
  get headingLevel(): number | undefined {
    const node = this.live();
    if (node.tag !== 'text:h') {
      return undefined;
    }
    // text:outline-level's ODF schema default when the attribute is absent is 1 (OASIS ODF 1.2 part 1) -- the identical default odf.js's own readOutlineLevel applies reading one back, and the identical degrade for a non-positive or unparseable value.
    const raw = attr(node, 'text:outline-level');
    if (raw === undefined) {
      return 1;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
  }

  set headingLevel(value: number | undefined) {
    const node = this.live();
    if (value === undefined) {
      node.tag = 'text:p';
      removeAttr(node, 'text:outline-level');
      removeAttr(node, 'text:style-name');
      return;
    }
    node.tag = 'text:h';
    setAttr(node, 'text:outline-level', String(value));
    setAttr(node, 'text:style-name', headingStyleName(value));
  }

  get alignment(): Alignment | undefined {
    return readCurrentStyleProperties(this.pkg, this.live(), 'paragraph').alignment;
  }

  set alignment(value: Alignment | undefined) {
    applyStyleChange(this.pkg, this.live(), 'paragraph', { alignment: value });
  }

  // The five paragraph-decoration fields odf.js's own StyleProperties already models (spacingBeforePt/spacingAfterPt/lineSpacing/indentLeftPt/indentFirstLinePt) -- each is a one-liner through applyStyleChange, exactly like alignment above, since odf.js's parseParagraphProperties reads them and paragraphPropertiesToAttributes writes them with no odf.js change needed. lineSpacing is a multiplier (1.0 = single), the same convention ContentParagraph.lineSpacing and the docx w:line reader/writer use.
  get spacingBeforePt(): number | undefined {
    return readCurrentStyleProperties(this.pkg, this.live(), 'paragraph').spacingBeforePt;
  }

  set spacingBeforePt(value: number | undefined) {
    applyStyleChange(this.pkg, this.live(), 'paragraph', { spacingBeforePt: value });
  }

  get spacingAfterPt(): number | undefined {
    return readCurrentStyleProperties(this.pkg, this.live(), 'paragraph').spacingAfterPt;
  }

  set spacingAfterPt(value: number | undefined) {
    applyStyleChange(this.pkg, this.live(), 'paragraph', { spacingAfterPt: value });
  }

  get lineSpacing(): number | undefined {
    return readCurrentStyleProperties(this.pkg, this.live(), 'paragraph').lineSpacing;
  }

  set lineSpacing(value: number | undefined) {
    applyStyleChange(this.pkg, this.live(), 'paragraph', { lineSpacing: value });
  }

  get indentLeftPt(): number | undefined {
    return readCurrentStyleProperties(this.pkg, this.live(), 'paragraph').indentLeftPt;
  }

  set indentLeftPt(value: number | undefined) {
    applyStyleChange(this.pkg, this.live(), 'paragraph', { indentLeftPt: value });
  }

  get indentFirstLinePt(): number | undefined {
    return readCurrentStyleProperties(this.pkg, this.live(), 'paragraph').indentFirstLinePt;
  }

  set indentFirstLinePt(value: number | undefined) {
    applyStyleChange(this.pkg, this.live(), 'paragraph', { indentFirstLinePt: value });
  }

  // Appends a new inline image, anchored as-char at the end of this paragraph's own content -- the odt counterpart to DocxParagraph.insertImageAfter, but simpler: unlike a docx paragraph (which needs a document-root reference to allocate a document-unique wp:docPr id), an OdtParagraph already carries this.pkg unconditionally, including inside a table cell (OdtTableCell.appendParagraph passes it through too), so this works there with zero extra plumbing -- a genuine odt advantage over docx's own documented table-cell limitation.
  insertImageAfter(image: ImageInit): void {
    const node = this.live();
    const frame: Box = { xPt: 0, yPt: 0, widthPt: image.widthPt, heightPt: image.heightPt };
    node.children.push(insertImageFrameMedia(this.pkg, frame, image));
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

// Builds a fresh text:p (promoted to a text:h by the headingLevel setter when init carries one) from scratch (not a live view -- for constructing new paragraphs to append or insert, whose properties are then read back through OdtParagraph once inserted into the tree). Mirrors run.ts's buildRun: applies init's properties by constructing a throwaway OdtParagraph over the new node and driving it through the exact same setters every later mutation uses. A headingLevel subsumes an init styleId rather than sitting alongside it: the headingLevel setter writes the ODF-resolvable Heading_20_N spelling of the same depth, and a producer's verbatim "Heading{N}" spelling (the synthetic cross-format shape, never a style an odt defines) would only overwrite it.
export function buildParagraph(pkg: Package, init: ParagraphInit = {}): XmlElement {
  const node = el('text:p');
  const paragraph = new OdtParagraph([], node, pkg);
  if (init.headingLevel !== undefined) {
    paragraph.headingLevel = init.headingLevel;
  } else if (init.styleId !== undefined) {
    paragraph.styleId = init.styleId;
  }
  if (init.alignment !== undefined) {
    paragraph.alignment = init.alignment;
  }
  if (init.text !== undefined) {
    node.children.push(buildRun(pkg, { text: init.text }));
  }
  return node;
}
