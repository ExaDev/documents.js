import type { Package, XmlElement, XmlNode } from "odf.js";
import { formatOdfLength, resolveOdfShapeGeometry } from "odf.js";
import { attr } from "ooxml.js";
import type { Box } from "document-schema.js";
import { removeChild } from "../../xml/edit";
import { applyOdfGeometry } from "../geometry";
import { el } from "../../xml/fragment";
import { buildList, OdtList } from "../odt/list";
import type { ParagraphInit } from "../odt/paragraph";
import { buildParagraph, OdtParagraph } from "../odt/paragraph";

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

// A live view over a draw:frame element -- a slide shape, whose content is exactly one of a draw:text-box, a draw:image, or a table:table (this class only builds/reads the first two; buildOdpPackage, src/edit/odp/content.ts, never produces a table shape, mirroring pptx/content.ts's own identical scope). frame/rotationDeg keep ODF's own top-left, y-down convention in points already converted from its length-unit strings -- the Y-flip into PDF space happens exactly once, in src/layout/slides.ts, same as pptx.
export class OdpShape {
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
        "this OdpShape has been removed from its slide and can no longer be used",
      );
    }
    return this.node;
  }

  get name(): string | undefined {
    return attr(this.live(), "draw:name");
  }

  get frame(): Box | undefined {
    return resolveOdfShapeGeometry(this.live())?.frame;
  }

  set frame(value: Box) {
    this.applyGeometry(value, this.rotationDeg);
  }

  get rotationDeg(): number | undefined {
    return resolveOdfShapeGeometry(this.live())?.rotationDeg;
  }

  set rotationDeg(value: number | undefined) {
    const currentFrame = this.frame;
    if (currentFrame === undefined) {
      throw new Error(
        "cannot set rotationDeg on a shape with no resolvable frame (missing svg:width/svg:height)",
      );
    }
    this.applyGeometry(currentFrame, value);
  }

  private applyGeometry(frame: Box, rotationDeg: number | undefined): void {
    applyOdfGeometry(this.live(), frame, rotationDeg);
  }

  // draw:text-box's own text:p children use exactly the same content model odt's office:text does -- interned into the same content.xml office:automatic-styles StyleRegistry (src/edit/odt/props.ts) -- so this reuses OdtParagraph/buildParagraph WHOLESALE rather than reimplementing paragraph/run/style-interning a second time for presentations.
  private textBox(create: true): XmlElement;
  private textBox(create: false): XmlElement | undefined;
  private textBox(create: boolean): XmlElement | undefined {
    const node = this.live();
    const existing = directChild(node, "draw:text-box");
    if (existing !== undefined || !create) {
      return existing;
    }
    const created = el("draw:text-box");
    node.children.push(created);
    return created;
  }

  paragraphs(): OdtParagraph[] {
    const textBox = this.textBox(false);
    if (textBox === undefined) {
      return [];
    }
    const out: OdtParagraph[] = [];
    for (const child of textBox.children) {
      if (child.type === "element" && child.tag === "text:p") {
        out.push(new OdtParagraph(textBox.children, child, this.pkg));
      }
    }
    return out;
  }

  appendParagraph(init?: ParagraphInit): OdtParagraph {
    const textBox = this.textBox(true);
    const paragraphElement = buildParagraph(this.pkg, init);
    textBox.children.push(paragraphElement);
    return new OdtParagraph(textBox.children, paragraphElement, this.pkg);
  }

  get text(): string {
    return this.paragraphs()
      .map((p) => p.text)
      .join("\n");
  }

  set text(value: string) {
    const textBox = this.textBox(true);
    textBox.children = [buildParagraph(this.pkg, { text: value })];
  }

  // A bulleted/numbered list inside this shape's own text box -- reuses OdtList/buildList (src/edit/odt/list.ts) WHOLESALE: a draw:text-box's content model permits a text:list exactly as office:text's does, and odf.js's own readDrawFrameContent (typed/draw/shapes.ts) already deep-searches for text:p under a draw:text-box (elementsWithTag, not childrenWithTag), so a text:p nested inside a text:list/text:list-item here is read back as ordinary paragraph text the same way it already is for odt. Mirrors OdtBody.appendList's own role, one level down (a shape's text box rather than the document body).
  addList(): OdtList {
    const textBox = this.textBox(true);
    const listElement = buildList(this.pkg);
    textBox.children.push(listElement);
    return new OdtList(textBox.children, listElement, this.pkg);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

// Builds a fresh draw:frame containing a draw:text-box with a single plain-text paragraph, for OdpSlide.addTextBox (slide.ts) -- the odp equivalent of pptx/shape.ts's own buildTextBoxShape.
export function buildTextBoxFrame(
  pkg: Package,
  frame: Box,
  text: string,
): XmlElement {
  return el(
    "draw:frame",
    {
      "svg:x": formatOdfLength(frame.xPt),
      "svg:y": formatOdfLength(frame.yPt),
      "svg:width": formatOdfLength(frame.widthPt),
      "svg:height": formatOdfLength(frame.heightPt),
    },
    [el("draw:text-box", {}, [buildParagraph(pkg, { text })])],
  );
}

// Builds a fresh draw:frame containing a draw:image referencing an already-inserted media part, for OdpSlide.addImage (slide.ts) -- the odp equivalent of pptx/shape.ts's own buildPictureShape. Unlike OOXML's p:pic, ODF's draw:image references its media part by a plain package path directly via xlink:href, with no relationship-id indirection to allocate (see src/odf-package/media.ts's own addImageMedia).
export function buildImageFrame(partPath: string, frame: Box): XmlElement {
  return el(
    "draw:frame",
    {
      "svg:x": formatOdfLength(frame.xPt),
      "svg:y": formatOdfLength(frame.yPt),
      "svg:width": formatOdfLength(frame.widthPt),
      "svg:height": formatOdfLength(frame.heightPt),
    },
    [el("draw:image", { "xlink:href": partPath })],
  );
}

// Builds a fresh draw:frame containing a table:table DIRECTLY (no draw:text-box wrapper) for OdpSlide.addTable (slide.ts) -- odf.js's own readDrawFrameContent (typed/draw/shapes.ts) checks for a table:table child before it ever looks for draw:text-box/draw:image, so a table shape's own table:table sits at the same nesting depth those do, not inside one of them. The returned frame is a live OdpShape like any other -- rotationDeg works on it exactly the same way (resolveOdfShapeGeometry/applyOdfGeometry are generic over the frame's own content) -- while tableElement is handed back separately for the caller to wrap in an OdtTable (table.ts's own table:table content model is identical wherever it lives, see src/edit/odt/table.ts).
export function buildTableFrame(
  frame: Box,
  tableElement: XmlElement,
): XmlElement {
  return el(
    "draw:frame",
    {
      "svg:x": formatOdfLength(frame.xPt),
      "svg:y": formatOdfLength(frame.yPt),
      "svg:width": formatOdfLength(frame.widthPt),
      "svg:height": formatOdfLength(frame.heightPt),
    },
    [tableElement],
  );
}
