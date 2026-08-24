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
  createEmptyOdpPackage,
  MASTER_PAGE_NAME,
  PAGE_LAYOUT_NAME,
} from "./scaffold";
import type { SlideContext } from "./slide";
import { OdpSlide } from "./slide";

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

function findOfficePresentation(pkg: Package): XmlElement {
  const contentRoot = findRoot(pkg, CONTENT_PART_PATH);
  const body = directChild(contentRoot, "office:body");
  const presentation =
    body === undefined ? undefined : directChild(body, "office:presentation");
  if (presentation === undefined) {
    throw new Error(
      `${CONTENT_PART_PATH} has no office:body/office:presentation element`,
    );
  }
  return presentation;
}

// Finds the shared style:page-layout-properties element every slide this editor creates references via draw:page/@draw:master-page-name -> style:master-page -> style:page-layout-name -> style:page-layout (scaffold.ts's own PAGE_LAYOUT_NAME/MASTER_PAGE_NAME) -- the odp equivalent of pptx/editor.ts's own findSldSz, except odp's page geometry lives in styles.xml rather than presentation.xml, since ODF's model resolves it per-draw:page through the master-page chain rather than once presentation-wide (see odf.js's own resolveDrawPageSize).
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

export class OdpEditor {
  private readonly pkg: Package;

  constructor(pkg: Package) {
    this.pkg = pkg;
  }

  slides(): OdpSlide[] {
    const presentation = findOfficePresentation(this.pkg);
    const out: OdpSlide[] = [];
    for (const child of presentation.children) {
      if (child.type === "element" && child.tag === "draw:page") {
        const context: SlideContext = { pkg: this.pkg };
        out.push(new OdpSlide(presentation.children, child, context));
      }
    }
    return out;
  }

  addSlide(): OdpSlide {
    const presentation = findOfficePresentation(this.pkg);
    const pageElement = el("draw:page", {
      "draw:master-page-name": MASTER_PAGE_NAME,
    });
    presentation.children.push(pageElement);
    const context: SlideContext = { pkg: this.pkg };
    return new OdpSlide(presentation.children, pageElement, context);
  }

  removeSlideAt(index: number): void {
    const presentation = findOfficePresentation(this.pkg);
    const pageElements = presentation.children.filter(
      (c): c is XmlElement => c.type === "element" && c.tag === "draw:page",
    );
    const target = pageElements[index];
    if (target === undefined) {
      throw new Error(`slide index ${index} does not exist`);
    }
    const listIndex = presentation.children.indexOf(target);
    presentation.children.splice(listIndex, 1);
  }

  moveSlide(from: number, to: number): void {
    const presentation = findOfficePresentation(this.pkg);
    const pageIndices: number[] = [];
    presentation.children.forEach((child, i) => {
      if (child.type === "element" && child.tag === "draw:page") {
        pageIndices.push(i);
      }
    });
    const fromChildIndex = pageIndices[from];
    if (fromChildIndex === undefined) {
      throw new Error(`slide index ${from} does not exist`);
    }
    const [moved] = presentation.children.splice(fromChildIndex, 1);
    if (moved === undefined) {
      throw new Error(`slide index ${from} does not exist`);
    }
    const updatedIndices: number[] = [];
    presentation.children.forEach((child, i) => {
      if (child.type === "element" && child.tag === "draw:page") {
        updatedIndices.push(i);
      }
    });
    const insertAt =
      to < updatedIndices.length
        ? (updatedIndices[to] ?? presentation.children.length)
        : presentation.children.length;
    presentation.children.splice(insertAt, 0, moved);
  }

  // Every slide this editor creates shares one style:page-layout (scaffold.ts's own PAGE_LAYOUT_NAME) via the master-page it references, so this reads/writes that one shared geometry -- deck-wide, like pptx/editor.ts's own slideSize, even though ODF's own model technically permits a per-draw:page size (a genuinely different master-page-name per slide, which this editor never creates).
  get slideSize(): PageSize {
    const properties = findPageLayoutProperties(this.pkg);
    const widthValue = attr(properties, "fo:page-width");
    const heightValue = attr(properties, "fo:page-height");
    const widthPt =
      widthValue === undefined ? undefined : parseOdfLength(widthValue);
    const heightPt =
      heightValue === undefined ? undefined : parseOdfLength(heightValue);
    return { widthPt: widthPt ?? 0, heightPt: heightPt ?? 0 };
  }

  set slideSize(size: PageSize) {
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

export function openOdp(bytes: Uint8Array<ArrayBuffer>): OdpEditor {
  return new OdpEditor(decodePackage(bytes));
}

export interface CreateOdpOptions {
  readonly clock?: ClockPort;
}

// Creates a fresh odp with real office:meta creation/modification timestamps -- mirrors createDocx's own default-on clock behaviour exactly (src/edit/docx/editor.ts).
export function createOdp(options?: CreateOdpOptions): OdpEditor {
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps({}, clock);
  return new OdpEditor(createEmptyOdpPackage({ metadata }));
}
