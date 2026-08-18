import type { ContentStrokeStyle } from 'document-schema.js';
import type { Color as LayoutColor } from 'document-schema.js';
import type { LayoutFont } from 'document-schema.js';
import { registerImageBytes, spliceOut } from './util';
import type { LayoutEllipse, LayoutImage, LayoutImageAsset, LayoutItem, LayoutLine, LayoutLink, LayoutPath, LayoutRect, LayoutSubpath, LayoutText } from 'pdf-codec';

// Live-view classes over a page's own LayoutItem entries -- the PDF-editor equivalent of src/edit/docx/run.ts's DocxRun or src/edit/odg/vector.ts's OdgBoxVector/OdgLineVector/OdgPathVector, adapted to this package's own model: a LayoutItem is a plain, Zod-inferred object (not an XmlElement), so there is no attribute tree to read/write through -- every getter/setter here reads or mutates the actual object sitting inside the page's own `items` array directly, and saving is nothing more than writePdf(doc) (PdfEditor.toBytes()). `container` is that page's own `LayoutItem[]` array (the exact reference PdfPage.items()/append*/insert* hold), `node` is this item's own object inside it.
//
// Each of the seven LayoutItem kinds gets its own concrete class below rather than one class narrowing on a tag the way OdgBoxVector does for rect/ellipse -- a LayoutItem's `kind` is a real discriminant property already (LayoutItemSchema's z.discriminatedUnion), so there is no shared element shape to collapse two kinds onto the way draw:rect/draw:ellipse share one attribute vocabulary.

// A page's own items() genuinely narrows on `kind` -- PdfTextItem.kind, PdfRectItem.kind, etc. are all real literal PROPERTIES (readonly kind = '<literal>' as const), not getters, exactly matching OdgLineVector/OdgPathVector's own convention for the same reason: a getter can't narrow a discriminated union the way a literal property can.

abstract class PdfItemBase<T extends LayoutItem> {
  protected readonly container: LayoutItem[];
  protected readonly node: T;
  private readonly typeName: string;
  private removed = false;

  protected constructor(container: LayoutItem[], node: T, typeName: string) {
    this.container = container;
    this.node = node;
    this.typeName = typeName;
  }

  protected live(): T {
    if (this.removed) {
      throw new Error(`this ${this.typeName} has been removed from its page and can no longer be used`);
    }
    return this.node;
  }

  // sourcePath is assigned only by a format reader at read time (document-schema.js's own layout.ts doc comment) -- never meaningfully settable here, so this exposes it read-only, matching what every LayoutItem variant actually carries.
  get sourcePath(): string | undefined {
    return this.live().sourcePath;
  }

  remove(): void {
    const node = this.live();
    spliceOut(this.container, node);
    this.removed = true;
  }
}

function requirePositive(value: number, field: string): void {
  if (!(value > 0)) {
    throw new Error(`${field} must be a positive number, got ${value}`);
  }
}

function requireNonNegative(value: number, field: string): void {
  if (!(value >= 0)) {
    throw new Error(`${field} must be a nonnegative number, got ${value}`);
  }
}

// Sets `node[key]` when `value` is defined, or removes the key entirely when it isn't -- matching every optional LayoutItem field's own Zod-schema shape (an absent key, never a present key holding `undefined`), the same convention DocxParagraph's own alignment/styleId setters follow for w:jc/w:pStyle by removing the element outright rather than writing one with no value.
function setOrDelete<T extends object, K extends keyof T>(node: T, key: K, value: T[K]): void {
  if (value === undefined) {
    delete node[key];
    return;
  }
  node[key] = value;
}

// --- text ---------------------------------------------------------------------------------------------------------

export interface PdfTextInit {
  readonly xPt: number;
  readonly yPt: number;
  readonly text: string;
  readonly font: LayoutFont;
  readonly sizePt: number;
  readonly color: LayoutColor;
  readonly rotationDeg?: number;
  readonly underline?: boolean;
}

export function buildTextItem(init: PdfTextInit): LayoutText {
  requirePositive(init.sizePt, 'sizePt');
  return {
    kind: 'text',
    xPt: init.xPt,
    yPt: init.yPt,
    text: init.text,
    font: init.font,
    sizePt: init.sizePt,
    color: init.color,
    rotationDeg: init.rotationDeg,
    underline: init.underline,
  };
}

export class PdfTextItem extends PdfItemBase<LayoutText> {
  readonly kind = 'text' as const;

  constructor(container: LayoutItem[], node: LayoutText) {
    super(container, node, 'PdfTextItem');
  }

  get xPt(): number {
    return this.live().xPt;
  }

  set xPt(value: number) {
    this.live().xPt = value;
  }

  get yPt(): number {
    return this.live().yPt;
  }

  set yPt(value: number) {
    this.live().yPt = value;
  }

  get text(): string {
    return this.live().text;
  }

  set text(value: string) {
    this.live().text = value;
  }

  get font(): LayoutFont {
    return this.live().font;
  }

  set font(value: LayoutFont) {
    this.live().font = value;
  }

  get sizePt(): number {
    return this.live().sizePt;
  }

  set sizePt(value: number) {
    requirePositive(value, 'sizePt');
    this.live().sizePt = value;
  }

  get color(): LayoutColor {
    return this.live().color;
  }

  set color(value: LayoutColor) {
    this.live().color = value;
  }

  get widthPt(): number | undefined {
    return this.live().widthPt;
  }

  set widthPt(value: number | undefined) {
    if (value !== undefined) {
      requireNonNegative(value, 'widthPt');
    }
    setOrDelete(this.live(), 'widthPt', value);
  }

  get rotationDeg(): number | undefined {
    return this.live().rotationDeg;
  }

  set rotationDeg(value: number | undefined) {
    setOrDelete(this.live(), 'rotationDeg', value);
  }

  get underline(): boolean | undefined {
    return this.live().underline;
  }

  set underline(value: boolean | undefined) {
    setOrDelete(this.live(), 'underline', value);
  }
}

// --- rect / ellipse -------------------------------------------------------------------------------------------------

export interface PdfRectInit {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly fill?: LayoutColor;
  readonly stroke?: { readonly color: LayoutColor; readonly widthPt: number };
}

export interface PdfEllipseInit {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly fill?: LayoutColor;
  readonly stroke?: { readonly color: LayoutColor; readonly widthPt: number };
}

function requireValidStroke(stroke: { readonly color: LayoutColor; readonly widthPt: number } | undefined): void {
  if (stroke !== undefined) {
    requirePositive(stroke.widthPt, 'stroke.widthPt');
  }
}

export function buildRectItem(init: PdfRectInit): LayoutRect {
  requireNonNegative(init.widthPt, 'widthPt');
  requireNonNegative(init.heightPt, 'heightPt');
  requireValidStroke(init.stroke);
  return { kind: 'rect', xPt: init.xPt, yPt: init.yPt, widthPt: init.widthPt, heightPt: init.heightPt, fill: init.fill, stroke: init.stroke };
}

export function buildEllipseItem(init: PdfEllipseInit): LayoutEllipse {
  requirePositive(init.widthPt, 'widthPt');
  requirePositive(init.heightPt, 'heightPt');
  requireValidStroke(init.stroke);
  return { kind: 'ellipse', xPt: init.xPt, yPt: init.yPt, widthPt: init.widthPt, heightPt: init.heightPt, fill: init.fill, stroke: init.stroke };
}

export class PdfRectItem extends PdfItemBase<LayoutRect> {
  readonly kind = 'rect' as const;

  constructor(container: LayoutItem[], node: LayoutRect) {
    super(container, node, 'PdfRectItem');
  }

  get xPt(): number {
    return this.live().xPt;
  }

  set xPt(value: number) {
    this.live().xPt = value;
  }

  get yPt(): number {
    return this.live().yPt;
  }

  set yPt(value: number) {
    this.live().yPt = value;
  }

  get widthPt(): number {
    return this.live().widthPt;
  }

  set widthPt(value: number) {
    requireNonNegative(value, 'widthPt');
    this.live().widthPt = value;
  }

  get heightPt(): number {
    return this.live().heightPt;
  }

  set heightPt(value: number) {
    requireNonNegative(value, 'heightPt');
    this.live().heightPt = value;
  }

  get fill(): LayoutColor | undefined {
    return this.live().fill;
  }

  set fill(value: LayoutColor | undefined) {
    setOrDelete(this.live(), 'fill', value);
  }

  get stroke(): { readonly color: LayoutColor; readonly widthPt: number } | undefined {
    return this.live().stroke;
  }

  set stroke(value: { readonly color: LayoutColor; readonly widthPt: number } | undefined) {
    requireValidStroke(value);
    setOrDelete(this.live(), 'stroke', value);
  }
}

export class PdfEllipseItem extends PdfItemBase<LayoutEllipse> {
  readonly kind = 'ellipse' as const;

  constructor(container: LayoutItem[], node: LayoutEllipse) {
    super(container, node, 'PdfEllipseItem');
  }

  get xPt(): number {
    return this.live().xPt;
  }

  set xPt(value: number) {
    this.live().xPt = value;
  }

  get yPt(): number {
    return this.live().yPt;
  }

  set yPt(value: number) {
    this.live().yPt = value;
  }

  get widthPt(): number {
    return this.live().widthPt;
  }

  set widthPt(value: number) {
    requirePositive(value, 'widthPt');
    this.live().widthPt = value;
  }

  get heightPt(): number {
    return this.live().heightPt;
  }

  set heightPt(value: number) {
    requirePositive(value, 'heightPt');
    this.live().heightPt = value;
  }

  get fill(): LayoutColor | undefined {
    return this.live().fill;
  }

  set fill(value: LayoutColor | undefined) {
    setOrDelete(this.live(), 'fill', value);
  }

  get stroke(): { readonly color: LayoutColor; readonly widthPt: number } | undefined {
    return this.live().stroke;
  }

  set stroke(value: { readonly color: LayoutColor; readonly widthPt: number } | undefined) {
    requireValidStroke(value);
    setOrDelete(this.live(), 'stroke', value);
  }
}

// --- line -----------------------------------------------------------------------------------------------------------

export interface PdfLineInit {
  readonly x1Pt: number;
  readonly y1Pt: number;
  readonly x2Pt: number;
  readonly y2Pt: number;
  readonly color: LayoutColor;
  readonly widthPt: number;
  readonly style?: ContentStrokeStyle;
}

export function buildLineItem(init: PdfLineInit): LayoutLine {
  requirePositive(init.widthPt, 'widthPt');
  return { kind: 'line', x1Pt: init.x1Pt, y1Pt: init.y1Pt, x2Pt: init.x2Pt, y2Pt: init.y2Pt, color: init.color, widthPt: init.widthPt, style: init.style };
}

export class PdfLineItem extends PdfItemBase<LayoutLine> {
  readonly kind = 'line' as const;

  constructor(container: LayoutItem[], node: LayoutLine) {
    super(container, node, 'PdfLineItem');
  }

  get x1Pt(): number {
    return this.live().x1Pt;
  }

  set x1Pt(value: number) {
    this.live().x1Pt = value;
  }

  get y1Pt(): number {
    return this.live().y1Pt;
  }

  set y1Pt(value: number) {
    this.live().y1Pt = value;
  }

  get x2Pt(): number {
    return this.live().x2Pt;
  }

  set x2Pt(value: number) {
    this.live().x2Pt = value;
  }

  get y2Pt(): number {
    return this.live().y2Pt;
  }

  set y2Pt(value: number) {
    this.live().y2Pt = value;
  }

  get color(): LayoutColor {
    return this.live().color;
  }

  set color(value: LayoutColor) {
    this.live().color = value;
  }

  get widthPt(): number {
    return this.live().widthPt;
  }

  set widthPt(value: number) {
    requirePositive(value, 'widthPt');
    this.live().widthPt = value;
  }

  get style(): ContentStrokeStyle | undefined {
    return this.live().style;
  }

  set style(value: ContentStrokeStyle | undefined) {
    setOrDelete(this.live(), 'style', value);
  }
}

// --- path -------------------------------------------------------------------------------------------------------

export interface PdfPathInit {
  readonly subpaths: readonly LayoutSubpath[];
  readonly fill?: LayoutColor;
  readonly fillRule?: 'nonzero' | 'evenodd';
  readonly stroke?: { readonly color: LayoutColor; readonly widthPt: number };
  readonly style?: ContentStrokeStyle;
}

export function buildPathItem(init: PdfPathInit): LayoutPath {
  requireValidStroke(init.stroke);
  return { kind: 'path', subpaths: [...init.subpaths], fill: init.fill, fillRule: init.fillRule, stroke: init.stroke, style: init.style };
}

export class PdfPathItem extends PdfItemBase<LayoutPath> {
  readonly kind = 'path' as const;

  constructor(container: LayoutItem[], node: LayoutPath) {
    super(container, node, 'PdfPathItem');
  }

  // A whole-array-replace setter only, in v1 -- no per-segment/per-point live editing of an existing path (see this module's own top-of-file scope note and the pdf editor's own module doc comment for why).
  get subpaths(): readonly LayoutSubpath[] {
    return this.live().subpaths;
  }

  set subpaths(value: readonly LayoutSubpath[]) {
    this.live().subpaths = [...value];
  }

  get fill(): LayoutColor | undefined {
    return this.live().fill;
  }

  set fill(value: LayoutColor | undefined) {
    setOrDelete(this.live(), 'fill', value);
  }

  get fillRule(): 'nonzero' | 'evenodd' | undefined {
    return this.live().fillRule;
  }

  set fillRule(value: 'nonzero' | 'evenodd' | undefined) {
    setOrDelete(this.live(), 'fillRule', value);
  }

  get stroke(): { readonly color: LayoutColor; readonly widthPt: number } | undefined {
    return this.live().stroke;
  }

  set stroke(value: { readonly color: LayoutColor; readonly widthPt: number } | undefined) {
    requireValidStroke(value);
    setOrDelete(this.live(), 'stroke', value);
  }

  get style(): ContentStrokeStyle | undefined {
    return this.live().style;
  }

  set style(value: ContentStrokeStyle | undefined) {
    setOrDelete(this.live(), 'style', value);
  }
}

// --- image ----------------------------------------------------------------------------------------------------

export interface PdfImageInit {
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly rotationDeg?: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly format: 'png' | 'jpeg';
}

export function buildImageItem(init: PdfImageInit, images: Record<string, LayoutImageAsset>): LayoutImage {
  requirePositive(init.widthPt, 'widthPt');
  requirePositive(init.heightPt, 'heightPt');
  const imageId = registerImageBytes(init.bytes, init.format, images);
  return { kind: 'image', imageId, xPt: init.xPt, yPt: init.yPt, widthPt: init.widthPt, heightPt: init.heightPt, rotationDeg: init.rotationDeg };
}

export class PdfImageItem extends PdfItemBase<LayoutImage> {
  readonly kind = 'image' as const;

  private readonly images: Record<string, LayoutImageAsset>;

  constructor(container: LayoutItem[], node: LayoutImage, images: Record<string, LayoutImageAsset>) {
    super(container, node, 'PdfImageItem');
    this.images = images;
  }

  get imageId(): string {
    return this.live().imageId;
  }

  get xPt(): number {
    return this.live().xPt;
  }

  set xPt(value: number) {
    this.live().xPt = value;
  }

  get yPt(): number {
    return this.live().yPt;
  }

  set yPt(value: number) {
    this.live().yPt = value;
  }

  get widthPt(): number {
    return this.live().widthPt;
  }

  set widthPt(value: number) {
    requirePositive(value, 'widthPt');
    this.live().widthPt = value;
  }

  get heightPt(): number {
    return this.live().heightPt;
  }

  set heightPt(value: number) {
    requirePositive(value, 'heightPt');
    this.live().heightPt = value;
  }

  get rotationDeg(): number | undefined {
    return this.live().rotationDeg;
  }

  set rotationDeg(value: number | undefined) {
    setOrDelete(this.live(), 'rotationDeg', value);
  }

  // Registers `bytes` in the document-wide image registry (deduplicated by content, exactly like a fresh appendImage/insertImageAt) and repoints this item's own imageId at the result -- position/size are untouched. The previous imageId is left exactly as it was in `images`: pruning it would be unsafe, since dedup means another item elsewhere in the document may still be referencing the identical entry: writePdf only ever embeds an images[] entry actually referenced by some item on some page, so an orphaned entry this call leaves behind is simply never written out.
  setImage(bytes: Uint8Array<ArrayBuffer>, format: 'png' | 'jpeg'): void {
    const node = this.live();
    node.imageId = registerImageBytes(bytes, format, this.images);
  }
}

// --- link -------------------------------------------------------------------------------------------------------

export interface PdfLinkInit {
  readonly uri: string;
  readonly xPt: number;
  readonly yPt: number;
  readonly widthPt: number;
  readonly heightPt: number;
}

export function buildLinkItem(init: PdfLinkInit): LayoutLink {
  requireNonNegative(init.widthPt, 'widthPt');
  requireNonNegative(init.heightPt, 'heightPt');
  return { kind: 'link', uri: init.uri, xPt: init.xPt, yPt: init.yPt, widthPt: init.widthPt, heightPt: init.heightPt };
}

export class PdfLinkItem extends PdfItemBase<LayoutLink> {
  readonly kind = 'link' as const;

  constructor(container: LayoutItem[], node: LayoutLink) {
    super(container, node, 'PdfLinkItem');
  }

  get uri(): string {
    return this.live().uri;
  }

  set uri(value: string) {
    this.live().uri = value;
  }

  get xPt(): number {
    return this.live().xPt;
  }

  set xPt(value: number) {
    this.live().xPt = value;
  }

  get yPt(): number {
    return this.live().yPt;
  }

  set yPt(value: number) {
    this.live().yPt = value;
  }

  get widthPt(): number {
    return this.live().widthPt;
  }

  set widthPt(value: number) {
    requireNonNegative(value, 'widthPt');
    this.live().widthPt = value;
  }

  get heightPt(): number {
    return this.live().heightPt;
  }

  set heightPt(value: number) {
    requireNonNegative(value, 'heightPt');
    this.live().heightPt = value;
  }
}

// --- dispatch --------------------------------------------------------------------------------------------------

export type PdfItem = PdfTextItem | PdfImageItem | PdfRectItem | PdfEllipseItem | PdfLineItem | PdfPathItem | PdfLinkItem;

// Wraps whichever LayoutItem `node` actually is in its matching live-view class -- the read-side counterpart to buildTextItem/buildRectItem/etc above, and the single place kind-to-class dispatch lives. PdfPage's own items()/textItems()/imageItems()/etc, and every append*/insert*At below, funnel through this.
export function wrapItem(container: LayoutItem[], node: LayoutItem, images: Record<string, LayoutImageAsset>): PdfItem {
  switch (node.kind) {
    case 'text':
      return new PdfTextItem(container, node);
    case 'image':
      return new PdfImageItem(container, node, images);
    case 'rect':
      return new PdfRectItem(container, node);
    case 'ellipse':
      return new PdfEllipseItem(container, node);
    case 'line':
      return new PdfLineItem(container, node);
    case 'path':
      return new PdfPathItem(container, node);
    case 'link':
      return new PdfLinkItem(container, node);
  }
}
