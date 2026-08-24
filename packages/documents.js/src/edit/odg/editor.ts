import type { Package, XmlElement } from "odf.js";
import {
  decodePackage,
  encodePackage,
  formatOdfLength,
  parseOdfLength,
} from "odf.js";
import { attr } from "ooxml.js";
import type { PageSize } from "document-schema.js";
import { resolveMetadataTimestamps } from "../../model/metadata";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { el } from "../../xml/fragment";
import {
  createEmptyOdgPackage,
  MASTER_PAGE_NAME,
  PAGE_LAYOUT_NAME,
} from "./scaffold";
import type { PageContext } from "./page";
import { OdgPage } from "./page";

const CONTENT_PART_PATH = "content.xml";
const STYLES_PART_PATH = "styles.xml";

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

function findRoot(pkg: Package, partPath: string): XmlElement {
  const part = pkg.parts[partPath];
  const root =
    part?.kind === "xml"
      ? part.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  if (root === undefined) {
    throw new Error(`package has no root element at ${partPath}`);
  }
  return root;
}

function findOfficeDrawing(pkg: Package): XmlElement {
  const contentRoot = findRoot(pkg, CONTENT_PART_PATH);
  const body = directChild(contentRoot, "office:body");
  const drawing =
    body === undefined ? undefined : directChild(body, "office:drawing");
  if (drawing === undefined) {
    throw new Error(
      `${CONTENT_PART_PATH} has no office:body/office:drawing element`,
    );
  }
  return drawing;
}

// Mirrors odp/editor.ts's own findPageLayoutProperties exactly, just against odg's own PAGE_LAYOUT_NAME/scaffold.
function findPageLayoutProperties(pkg: Package): XmlElement {
  const stylesRoot = findRoot(pkg, STYLES_PART_PATH);
  const automaticStyles = directChild(stylesRoot, "office:automatic-styles");
  const pageLayout = automaticStyles?.children.find(
    (c): c is XmlElement =>
      c.type === "element" &&
      c.tag === "style:page-layout" &&
      attr(c, "style:name") === PAGE_LAYOUT_NAME,
  );
  const properties =
    pageLayout === undefined
      ? undefined
      : directChild(pageLayout, "style:page-layout-properties");
  if (properties === undefined) {
    throw new Error(
      `${STYLES_PART_PATH} has no style:page-layout[style:name="${PAGE_LAYOUT_NAME}"]/style:page-layout-properties element`,
    );
  }
  return properties;
}

// The odg equivalent of odp/editor.ts's own OdpEditor: page-level add/remove/get over office:drawing's own draw:page children (document order IS page order, exactly like odp's draw:page/office:presentation -- see odf.js's own typed/odg/read.ts top-of-file note on the shared, format-agnostic draw:page content model). pageSize mirrors OdpEditor.slideSize's own deck-wide convenience getter/setter: every page this editor creates shares one style:page-layout via the master-page it references.
export class OdgEditor {
  private readonly pkg: Package;

  constructor(pkg: Package) {
    this.pkg = pkg;
  }

  pages(): OdgPage[] {
    const drawing = findOfficeDrawing(this.pkg);
    const out: OdgPage[] = [];
    for (const child of drawing.children) {
      if (child.type === "element" && child.tag === "draw:page") {
        const context: PageContext = { pkg: this.pkg };
        out.push(new OdgPage(drawing.children, child, context));
      }
    }
    return out;
  }

  addPage(): OdgPage {
    const drawing = findOfficeDrawing(this.pkg);
    const pageElement = el("draw:page", {
      "draw:master-page-name": MASTER_PAGE_NAME,
    });
    drawing.children.push(pageElement);
    const context: PageContext = { pkg: this.pkg };
    return new OdgPage(drawing.children, pageElement, context);
  }

  removePageAt(index: number): void {
    const drawing = findOfficeDrawing(this.pkg);
    const pageElements = drawing.children.filter(
      (c): c is XmlElement => c.type === "element" && c.tag === "draw:page",
    );
    const target = pageElements[index];
    if (target === undefined) {
      throw new Error(`page index ${index} does not exist`);
    }
    const listIndex = drawing.children.indexOf(target);
    drawing.children.splice(listIndex, 1);
  }

  get pageSize(): PageSize {
    const properties = findPageLayoutProperties(this.pkg);
    const widthValue = attr(properties, "fo:page-width");
    const heightValue = attr(properties, "fo:page-height");
    const widthPt =
      widthValue === undefined ? undefined : parseOdfLength(widthValue);
    const heightPt =
      heightValue === undefined ? undefined : parseOdfLength(heightValue);
    return { widthPt: widthPt ?? 0, heightPt: heightPt ?? 0 };
  }

  set pageSize(size: PageSize) {
    const properties = findPageLayoutProperties(this.pkg);
    properties.attributes = [
      { name: "fo:page-width", value: formatOdfLength(size.widthPt) },
      { name: "fo:page-height", value: formatOdfLength(size.heightPt) },
    ];
  }

  toPackage(): Package {
    return this.pkg;
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return encodePackage(this.pkg);
  }
}

export function openOdg(bytes: Uint8Array<ArrayBuffer>): OdgEditor {
  return new OdgEditor(decodePackage(bytes));
}

export interface CreateOdgOptions {
  readonly clock?: ClockPort;
}

// Creates a fresh odg with real office:meta creation/modification timestamps -- mirrors createDocx's own default-on clock behaviour exactly (src/edit/docx/editor.ts).
export function createOdg(options?: CreateOdgOptions): OdgEditor {
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps({}, clock);
  return new OdgEditor(createEmptyOdgPackage({ metadata }));
}
