import type { LayoutImageAsset, LayoutPage } from "pdf-codec";
import type {
  PdfEllipseInit,
  PdfImageInit,
  PdfItem,
  PdfLineInit,
  PdfLinkInit,
  PdfPathInit,
  PdfRectInit,
  PdfTextInit,
} from "./item";
import {
  buildEllipseItem,
  buildImageItem,
  buildLineItem,
  buildLinkItem,
  buildPathItem,
  buildRectItem,
  buildTextItem,
  PdfEllipseItem,
  PdfImageItem,
  PdfLineItem,
  PdfLinkItem,
  PdfPathItem,
  PdfRectItem,
  PdfTextItem,
  wrapItem,
} from "./item";
import { spliceOut } from "./util";

// A page's own initial size/notes, used by both PdfEditor.createPdf's own default page and appendPage/insertPageAt below -- widthPt/heightPt default to US Letter (matching pdf-codec's own readPdf fallback for a page with no resolvable /MediaBox at all) when omitted, rather than throwing or defaulting to zero.
export interface PageInit {
  readonly widthPt?: number;
  readonly heightPt?: number;
  readonly notes?: string;
}

const DEFAULT_PAGE_WIDTH_PT = 612; // US Letter, matching pdf-codec's own DEFAULT_PAGE_WIDTH_PT/DEFAULT_PAGE_HEIGHT_PT (src/read.ts)
const DEFAULT_PAGE_HEIGHT_PT = 792;

export function buildPage(init: PageInit = {}): LayoutPage {
  const widthPt = init.widthPt ?? DEFAULT_PAGE_WIDTH_PT;
  const heightPt = init.heightPt ?? DEFAULT_PAGE_HEIGHT_PT;
  if (!(widthPt > 0)) {
    throw new Error(`widthPt must be a positive number, got ${widthPt}`);
  }
  if (!(heightPt > 0)) {
    throw new Error(`heightPt must be a positive number, got ${heightPt}`);
  }
  return { widthPt, heightPt, items: [], notes: init.notes };
}

// A live view over one page of a LayoutDocument -- the PDF-editor equivalent of src/edit/odg/page.ts's own OdgPage, adapted to a plain positioned-item model rather than an XmlElement tree: `container` is the editor's own `LayoutPage[]` array, `node` is this page's own object inside it, and `images` is the whole document's shared image-asset registry (LayoutDocument.images), threaded through so any image item this page creates/reads registers into the same document-wide table every other page shares.
export class PdfPage {
  private readonly container: LayoutPage[];
  private readonly node: LayoutPage;
  private readonly images: Record<string, LayoutImageAsset>;
  private removed = false;

  constructor(
    container: LayoutPage[],
    node: LayoutPage,
    images: Record<string, LayoutImageAsset>,
  ) {
    this.container = container;
    this.node = node;
    this.images = images;
  }

  private live(): LayoutPage {
    if (this.removed) {
      throw new Error(
        "this PdfPage has been removed from its document and can no longer be used",
      );
    }
    return this.node;
  }

  get widthPt(): number {
    return this.live().widthPt;
  }

  set widthPt(value: number) {
    if (!(value > 0)) {
      throw new Error(`widthPt must be a positive number, got ${value}`);
    }
    this.live().widthPt = value;
  }

  get heightPt(): number {
    return this.live().heightPt;
  }

  set heightPt(value: number) {
    if (!(value > 0)) {
      throw new Error(`heightPt must be a positive number, got ${value}`);
    }
    this.live().heightPt = value;
  }

  get notes(): string | undefined {
    return this.live().notes;
  }

  set notes(value: string | undefined) {
    const node = this.live();
    if (value === undefined) {
      delete node.notes;
      return;
    }
    node.notes = value;
  }

  // Every item on this page, in paint order (LayoutPage.items' own array order) -- a fresh PdfItem wrapper every call, never cached, exactly like DocxParagraph.runs()/OdgPage.vectors(): each wrapper holds a live reference into the actual array element, so mutating through one and re-reading through a freshly obtained wrapper from a later call observes the same change.
  items(): PdfItem[] {
    const node = this.live();
    return node.items.map((item) => wrapItem(node.items, item, this.images));
  }

  textItems(): PdfTextItem[] {
    return this.items().filter(
      (item): item is PdfTextItem => item.kind === "text",
    );
  }

  imageItems(): PdfImageItem[] {
    return this.items().filter(
      (item): item is PdfImageItem => item.kind === "image",
    );
  }

  rectItems(): PdfRectItem[] {
    return this.items().filter(
      (item): item is PdfRectItem => item.kind === "rect",
    );
  }

  ellipseItems(): PdfEllipseItem[] {
    return this.items().filter(
      (item): item is PdfEllipseItem => item.kind === "ellipse",
    );
  }

  lineItems(): PdfLineItem[] {
    return this.items().filter(
      (item): item is PdfLineItem => item.kind === "line",
    );
  }

  pathItems(): PdfPathItem[] {
    return this.items().filter(
      (item): item is PdfPathItem => item.kind === "path",
    );
  }

  linkItems(): PdfLinkItem[] {
    return this.items().filter(
      (item): item is PdfLinkItem => item.kind === "link",
    );
  }

  // Clamps to the current item count on both ends -- a negative index inserts at the start, an index at or past the current length appends at the end, exactly like DocxBody.insertParagraphAt's own out-of-range handling (src/edit/docx/editor.ts). `index` is an absolute position in paint order across every kind (there is no per-kind sub-sequence the way docx's own paragraph/table indices are, since a page's own items are already one single ordered array, not several element tags mixed into one parent).
  private clampIndex(index: number): number {
    return Math.min(Math.max(index, 0), this.live().items.length);
  }

  appendText(init: PdfTextInit): PdfTextItem {
    const node = this.live();
    const item = buildTextItem(init);
    node.items.push(item);
    return new PdfTextItem(node.items, item);
  }

  insertTextAt(index: number, init: PdfTextInit): PdfTextItem {
    const node = this.live();
    const item = buildTextItem(init);
    node.items.splice(this.clampIndex(index), 0, item);
    return new PdfTextItem(node.items, item);
  }

  appendRect(init: PdfRectInit): PdfRectItem {
    const node = this.live();
    const item = buildRectItem(init);
    node.items.push(item);
    return new PdfRectItem(node.items, item);
  }

  insertRectAt(index: number, init: PdfRectInit): PdfRectItem {
    const node = this.live();
    const item = buildRectItem(init);
    node.items.splice(this.clampIndex(index), 0, item);
    return new PdfRectItem(node.items, item);
  }

  appendEllipse(init: PdfEllipseInit): PdfEllipseItem {
    const node = this.live();
    const item = buildEllipseItem(init);
    node.items.push(item);
    return new PdfEllipseItem(node.items, item);
  }

  insertEllipseAt(index: number, init: PdfEllipseInit): PdfEllipseItem {
    const node = this.live();
    const item = buildEllipseItem(init);
    node.items.splice(this.clampIndex(index), 0, item);
    return new PdfEllipseItem(node.items, item);
  }

  appendLine(init: PdfLineInit): PdfLineItem {
    const node = this.live();
    const item = buildLineItem(init);
    node.items.push(item);
    return new PdfLineItem(node.items, item);
  }

  insertLineAt(index: number, init: PdfLineInit): PdfLineItem {
    const node = this.live();
    const item = buildLineItem(init);
    node.items.splice(this.clampIndex(index), 0, item);
    return new PdfLineItem(node.items, item);
  }

  appendPath(init: PdfPathInit): PdfPathItem {
    const node = this.live();
    const item = buildPathItem(init);
    node.items.push(item);
    return new PdfPathItem(node.items, item);
  }

  insertPathAt(index: number, init: PdfPathInit): PdfPathItem {
    const node = this.live();
    const item = buildPathItem(init);
    node.items.splice(this.clampIndex(index), 0, item);
    return new PdfPathItem(node.items, item);
  }

  appendImage(init: PdfImageInit): PdfImageItem {
    const node = this.live();
    const item = buildImageItem(init, this.images);
    node.items.push(item);
    return new PdfImageItem(node.items, item, this.images);
  }

  insertImageAt(index: number, init: PdfImageInit): PdfImageItem {
    const node = this.live();
    const item = buildImageItem(init, this.images);
    node.items.splice(this.clampIndex(index), 0, item);
    return new PdfImageItem(node.items, item, this.images);
  }

  appendLink(init: PdfLinkInit): PdfLinkItem {
    const node = this.live();
    const item = buildLinkItem(init);
    node.items.push(item);
    return new PdfLinkItem(node.items, item);
  }

  insertLinkAt(index: number, init: PdfLinkInit): PdfLinkItem {
    const node = this.live();
    const item = buildLinkItem(init);
    node.items.splice(this.clampIndex(index), 0, item);
    return new PdfLinkItem(node.items, item);
  }

  remove(): void {
    const node = this.live();
    spliceOut(this.container, node);
    this.removed = true;
  }
}
