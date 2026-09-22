import type { Package, XmlElement } from "ooxml.js";
import {
  decodePackage,
  encodePackage,
  readCoreProperties,
  resolveRelationships,
  rootElement,
} from "ooxml.js";
import type { LayoutMetadata, PageSize } from "document-schema.js";
import { patchOoxmlCorePropertiesOnPackage } from "../../metadata/core-patch";
import { resolveMetadataTimestamps } from "../../model/metadata";
import { emuToPt, ptToEmu } from "../../model/units";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { ensureContentTypeOverride } from "../../opc/content-types";
import { buildRelativeTarget, escapeRegExp } from "../../opc/paths";
import { addRelationship } from "../../opc/rels";
import { el } from "../../xml/fragment";
import {
  buildEmptyGroupSpTree,
  createEmptyPptxPackage,
  DML_NS,
  PML_NS,
  R_NS,
  SLIDE_LAYOUT_PART_PATH,
  SLIDE_LAYOUT_REL_TYPE,
} from "./scaffold";
import type { SlideContext } from "./slide";
import { PptxSlide } from "./slide";
import { pptxMainPartPath, pptxMediaDir, pptxSlidesDir } from "./parts";

const SLIDE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
const SLIDE_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";

// The ECMA-376 minimum value for a p:sldId/@id — ids 0..255 are reserved.
const MIN_SLIDE_ID = 256;

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

function attrValue(element: XmlElement, name: string): string | undefined {
  for (const a of element.attributes) {
    if (a.name === name) {
      return a.value;
    }
  }
  return undefined;
}

function findPresentationRoot(
  pkg: Package,
  presentationPartPath: string,
): XmlElement {
  const root = rootElement(pkg.parts[presentationPartPath]);
  if (root === undefined) {
    throw new Error(`package has no root element at ${presentationPartPath}`);
  }
  return root;
}

function findSldIdLst(
  presentationRoot: XmlElement,
  presentationPartPath: string,
): XmlElement {
  const sldIdLst = directChild(presentationRoot, "p:sldIdLst");
  if (sldIdLst === undefined) {
    throw new Error(`${presentationPartPath} has no p:sldIdLst element`);
  }
  return sldIdLst;
}

function findSldSz(
  presentationRoot: XmlElement,
  presentationPartPath: string,
): XmlElement {
  const sldSz = directChild(presentationRoot, "p:sldSz");
  if (sldSz === undefined) {
    throw new Error(`${presentationPartPath} has no p:sldSz element`);
  }
  return sldSz;
}

function nextSlideId(sldIdLst: XmlElement): number {
  let max = MIN_SLIDE_ID - 1;
  for (const child of sldIdLst.children) {
    if (child.type !== "element" || child.tag !== "p:sldId") {
      continue;
    }
    const id = attrValue(child, "id");
    if (id === undefined) {
      continue;
    }
    const n = Number.parseInt(id, 10);
    if (!Number.isNaN(n) && n > max) {
      max = n;
    }
  }
  return max + 1;
}

// The next free slideN.xml index within `slidesDir`, which is wherever this package keeps its slides rather than a fixed ppt/slides — the directory is derived from the presentation part's own location (./parts.ts).
function nextSlidePartIndex(pkg: Package, slidesDir: string): number {
  const pattern = new RegExp(`^${escapeRegExp(slidesDir)}/slide(\\d+)\\.xml$`);
  let max = 0;
  for (const path of Object.keys(pkg.parts)) {
    const match = pattern.exec(path);
    if (match === null) {
      continue;
    }
    const digits = match[1];
    if (digits === undefined) {
      continue;
    }
    const n = Number.parseInt(digits, 10);
    if (n > max) {
      max = n;
    }
  }
  return max + 1;
}

// xmlns:p/xmlns:a/xmlns:r are mandatory on this root element — each OOXML part is its own independent XML document, so a slide part declares its own namespace prefixes regardless of what ppt/presentation.xml declares. Their absence (this function's previous form) is invalid XML-namespaces and is rejected by any namespace-aware parser; this package's own reader tolerates it only because ooxml.js's XmlElement model matches tag strings literally rather than resolving namespace URIs. Confirmed against real Keynote, which rejected a slide built without them.
function buildEmptySlideRoot(): XmlElement {
  return el(
    "p:sld",
    { "xmlns:p": PML_NS, "xmlns:a": DML_NS, "xmlns:r": R_NS },
    [el("p:cSld", {}, [buildEmptyGroupSpTree()])],
  );
}

export class PptxEditor {
  private readonly pkg: Package;
  // Resolved once, at open time: the package's own officeDocument relationship decides which part holds the presentation, and every slide directory and media directory this editor writes into sits beside that part (see ./parts.ts).
  private readonly presentationPartPath: string;
  private readonly mediaDir: string;
  private readonly slidesDir: string;

  constructor(pkg: Package) {
    this.pkg = pkg;
    this.presentationPartPath = pptxMainPartPath(pkg);
    this.mediaDir = pptxMediaDir(this.presentationPartPath);
    this.slidesDir = pptxSlidesDir(this.presentationPartPath);
  }

  // Reads/patches docProps/core.xml directly on the live package — ExaDev/documents.js#933's own "editor.metadata = {...}" gap, mirroring DocxEditor's own identical getter/setter exactly (src/edit/docx/editor.ts's own comment states the full title/author/subject/keywords-only rationale). setDocumentMetadata's own bytes-level API rebuilds a whole fresh pptx from its ContentDocument for a pptx/pptx pair (src/metadata/write.ts's own REBUILD_FORMATS) — wrong for a LIVE editor, which would discard every other pending edit the caller made through this same editor instance — so this patches docProps/core.xml in place instead, via the identical pkg-level primitive DocxEditor uses.
  get metadata(): LayoutMetadata {
    return readCoreProperties(this.pkg);
  }

  set metadata(value: LayoutMetadata) {
    patchOoxmlCorePropertiesOnPackage(this.pkg, value);
  }

  slides(): PptxSlide[] {
    const presentationRoot = findPresentationRoot(
      this.pkg,
      this.presentationPartPath,
    );
    const sldIdLst = findSldIdLst(presentationRoot, this.presentationPartPath);
    const presentationRels = resolveRelationships(
      this.pkg,
      this.presentationPartPath,
    );
    const out: PptxSlide[] = [];
    for (const child of sldIdLst.children) {
      if (child.type !== "element" || child.tag !== "p:sldId") {
        continue;
      }
      const rId = attrValue(child, "r:id");
      if (rId === undefined) {
        continue;
      }
      const rel = presentationRels.get(rId);
      if (rel === undefined) {
        continue;
      }
      const slideRoot = rootElement(this.pkg.parts[rel.target]);
      if (slideRoot === undefined) {
        continue;
      }
      const context: SlideContext = {
        pkg: this.pkg,
        slidePartPath: rel.target,
        mediaDir: this.mediaDir,
        presentationPartPath: this.presentationPartPath,
      };
      out.push(new PptxSlide(sldIdLst.children, slideRoot, context));
    }
    return out;
  }

  addSlide(): PptxSlide {
    const presentationRoot = findPresentationRoot(
      this.pkg,
      this.presentationPartPath,
    );
    const sldIdLst = findSldIdLst(presentationRoot, this.presentationPartPath);

    const partIndex = nextSlidePartIndex(this.pkg, this.slidesDir);
    const slidePartPath = `${this.slidesDir}/slide${partIndex}.xml`;
    const slideRoot = buildEmptySlideRoot();
    this.pkg.parts[slidePartPath] = { kind: "xml", nodes: [slideRoot] };
    ensureContentTypeOverride(this.pkg, slidePartPath, SLIDE_CONTENT_TYPE);
    const relationshipId = addRelationship(
      this.pkg,
      this.presentationPartPath,
      {
        type: SLIDE_RELATIONSHIP_TYPE,
        target: buildRelativeTarget(this.presentationPartPath, slidePartPath),
      },
    );
    // Every real p:sld must relate to a slideLayout (CT_Slide's own mandatory chain) — createEmptyPptxPackage's own single blank layout, referenced here by every slide this editor creates.
    addRelationship(this.pkg, slidePartPath, {
      type: SLIDE_LAYOUT_REL_TYPE,
      target: buildRelativeTarget(slidePartPath, SLIDE_LAYOUT_PART_PATH),
    });

    const slideId = nextSlideId(sldIdLst);
    sldIdLst.children.push(
      el("p:sldId", { id: String(slideId), "r:id": relationshipId }),
    );

    const context: SlideContext = {
      pkg: this.pkg,
      slidePartPath,
      mediaDir: this.mediaDir,
      presentationPartPath: this.presentationPartPath,
    };
    return new PptxSlide(sldIdLst.children, slideRoot, context);
  }

  removeSlideAt(index: number): void {
    const presentationRoot = findPresentationRoot(
      this.pkg,
      this.presentationPartPath,
    );
    const sldIdLst = findSldIdLst(presentationRoot, this.presentationPartPath);
    const sldIdElements = sldIdLst.children.filter(
      (c) => c.type === "element" && c.tag === "p:sldId",
    );
    const target = sldIdElements[index];
    if (target?.type !== "element") {
      throw new Error(`slide index ${index} does not exist`);
    }
    const rId = attrValue(target, "r:id");
    const listIndex = sldIdLst.children.indexOf(target);
    sldIdLst.children.splice(listIndex, 1);
    if (rId !== undefined) {
      const rel = resolveRelationships(this.pkg, this.presentationPartPath).get(
        rId,
      );
      if (rel !== undefined) {
        Reflect.deleteProperty(this.pkg.parts, rel.target);
      }
    }
  }

  moveSlide(from: number, to: number): void {
    const presentationRoot = findPresentationRoot(
      this.pkg,
      this.presentationPartPath,
    );
    const sldIdLst = findSldIdLst(presentationRoot, this.presentationPartPath);
    const sldIdIndices: number[] = [];
    sldIdLst.children.forEach((child, i) => {
      if (child.type === "element" && child.tag === "p:sldId") {
        sldIdIndices.push(i);
      }
    });
    const fromChildIndex = sldIdIndices[from];
    if (fromChildIndex === undefined) {
      throw new Error(`slide index ${from} does not exist`);
    }
    const [moved] = sldIdLst.children.splice(fromChildIndex, 1);
    if (moved === undefined) {
      throw new Error(`slide index ${from} does not exist`);
    }
    const updatedIndices: number[] = [];
    sldIdLst.children.forEach((child, i) => {
      if (child.type === "element" && child.tag === "p:sldId") {
        updatedIndices.push(i);
      }
    });
    const insertAt =
      to < updatedIndices.length
        ? (updatedIndices[to] ?? sldIdLst.children.length)
        : sldIdLst.children.length;
    sldIdLst.children.splice(insertAt, 0, moved);
  }

  // p:sldSz is presentation-wide, not per-slide (unlike ContentSlide.size, which PDF-reconstructed content sets per page) — a caller building a deck from content whose pages share one size sets this once; createEmptyPptxPackage's own scaffold default is PowerPoint's standard 16:9 widescreen.
  get slideSize(): PageSize {
    const sldSz = findSldSz(
      findPresentationRoot(this.pkg, this.presentationPartPath),
      this.presentationPartPath,
    );
    const cx = attrValue(sldSz, "cx");
    const cy = attrValue(sldSz, "cy");
    return {
      widthPt: cx === undefined ? 0 : emuToPt(Number.parseInt(cx, 10)),
      heightPt: cy === undefined ? 0 : emuToPt(Number.parseInt(cy, 10)),
    };
  }

  set slideSize(size: PageSize) {
    const sldSz = findSldSz(
      findPresentationRoot(this.pkg, this.presentationPartPath),
      this.presentationPartPath,
    );
    sldSz.attributes = [
      { name: "cx", value: String(ptToEmu(size.widthPt)) },
      { name: "cy", value: String(ptToEmu(size.heightPt)) },
    ];
  }

  toPackage(): Package {
    return this.pkg;
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return encodePackage(this.pkg);
  }
}

export function openPptx(bytes: Uint8Array<ArrayBuffer>): PptxEditor {
  return new PptxEditor(decodePackage(bytes));
}

export interface CreatePptxOptions {
  readonly clock?: ClockPort;
}

// Creates a fresh pptx with real docProps/core.xml creation/modification timestamps — mirrors createDocx's own default-on clock behaviour exactly (src/edit/docx/editor.ts).
export function createPptx(options?: CreatePptxOptions): PptxEditor {
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps({}, clock);
  return new PptxEditor(createEmptyPptxPackage({ metadata }));
}
