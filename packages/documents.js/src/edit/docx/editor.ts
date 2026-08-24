import type { Package, XmlElement } from "ooxml.js";
import { decodePackage, encodePackage, rootElement } from "ooxml.js";
import { resolveMetadataTimestamps } from "../../model/metadata";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { el } from "../../xml/fragment";
import type { ImageMediaContext } from "./paragraph";
import { buildParagraph, DocxParagraph } from "./paragraph";
import type { ParagraphInit } from "./paragraph";
import { createEmptyDocxPackage } from "./scaffold";
import { buildTable, DocxTable } from "./table";
import type { TableInit } from "./table";

const DOCUMENT_PART_PATH = "word/document.xml";
const MEDIA_DIR = "word/media";

export interface DocxBody {
  insertParagraphAt(index: number, init?: ParagraphInit): DocxParagraph;
  appendParagraph(init?: ParagraphInit): DocxParagraph;
  appendTable(init: TableInit): DocxTable;
  appendPageBreak(): void;
}

function findDocumentRoot(pkg: Package): XmlElement {
  const root = rootElement(pkg.parts[DOCUMENT_PART_PATH]);
  if (root === undefined) {
    throw new Error(`package has no root element at ${DOCUMENT_PART_PATH}`);
  }
  return root;
}

function findBody(documentRoot: XmlElement): XmlElement {
  for (const child of documentRoot.children) {
    if (child.type === "element" && child.tag === "w:body") {
      return child;
    }
  }
  throw new Error(`${DOCUMENT_PART_PATH} has no w:body element`);
}

// w:sectPr, when it appears as a direct child of w:body (the document's final/only section), must be the LAST child -- every new top-level element is inserted immediately before it.
function bodyInsertionPoint(body: XmlElement): number {
  const sectPrIndex = body.children.findIndex(
    (c) => c.type === "element" && c.tag === "w:sectPr",
  );
  return sectPrIndex === -1 ? body.children.length : sectPrIndex;
}

function bodyElementIndicesByTag(body: XmlElement, tag: string): number[] {
  const indices: number[] = [];
  body.children.forEach((child, i) => {
    if (child.type === "element" && child.tag === tag) {
      indices.push(i);
    }
  });
  return indices;
}

class DocxBodyImpl implements DocxBody {
  constructor(
    private readonly body: XmlElement,
    private readonly imageContext: ImageMediaContext,
    private readonly pkg: Package,
  ) {}

  appendParagraph(init?: ParagraphInit): DocxParagraph {
    const paragraphElement = buildParagraph(init);
    this.body.children.splice(
      bodyInsertionPoint(this.body),
      0,
      paragraphElement,
    );
    return new DocxParagraph(
      this.body.children,
      paragraphElement,
      this.imageContext,
      this.pkg,
    );
  }

  insertParagraphAt(index: number, init?: ParagraphInit): DocxParagraph {
    const paragraphElement = buildParagraph(init);
    const indices = bodyElementIndicesByTag(this.body, "w:p");
    const insertAt =
      index < indices.length
        ? (indices[index] ?? bodyInsertionPoint(this.body))
        : bodyInsertionPoint(this.body);
    this.body.children.splice(insertAt, 0, paragraphElement);
    return new DocxParagraph(
      this.body.children,
      paragraphElement,
      this.imageContext,
      this.pkg,
    );
  }

  appendTable(init: TableInit): DocxTable {
    const tableElement = buildTable(init);
    this.body.children.splice(bodyInsertionPoint(this.body), 0, tableElement);
    return new DocxTable(this.body.children, tableElement);
  }

  appendPageBreak(): void {
    const run = el("w:r", {}, [el("w:br", { "w:type": "page" })]);
    const paragraph = el("w:p", {}, [run]);
    this.body.children.splice(bodyInsertionPoint(this.body), 0, paragraph);
  }
}

export class DocxEditor {
  readonly body: DocxBody;
  private readonly pkg: Package;

  constructor(pkg: Package) {
    this.pkg = pkg;
    const documentRoot = findDocumentRoot(pkg);
    const body = findBody(documentRoot);
    const imageContext: ImageMediaContext = {
      pkg,
      documentRoot,
      media: { pkg, partPath: DOCUMENT_PART_PATH, mediaDir: MEDIA_DIR },
    };
    this.body = new DocxBodyImpl(body, imageContext, this.pkg);
  }

  paragraphs(): DocxParagraph[] {
    const documentRoot = findDocumentRoot(this.pkg);
    const body = findBody(documentRoot);
    const imageContext: ImageMediaContext = {
      pkg: this.pkg,
      documentRoot,
      media: {
        pkg: this.pkg,
        partPath: DOCUMENT_PART_PATH,
        mediaDir: MEDIA_DIR,
      },
    };
    const out: DocxParagraph[] = [];
    for (const child of body.children) {
      if (child.type === "element" && child.tag === "w:p") {
        out.push(new DocxParagraph(body.children, child, imageContext));
      }
    }
    return out;
  }

  tables(): DocxTable[] {
    const body = findBody(findDocumentRoot(this.pkg));
    const out: DocxTable[] = [];
    for (const child of body.children) {
      if (child.type === "element" && child.tag === "w:tbl") {
        out.push(new DocxTable(body.children, child));
      }
    }
    return out;
  }

  toPackage(): Package {
    return this.pkg;
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return encodePackage(this.pkg);
  }
}

export function openDocx(bytes: Uint8Array<ArrayBuffer>): DocxEditor {
  return new DocxEditor(decodePackage(bytes));
}

export interface CreateDocxOptions {
  readonly clock?: ClockPort;
}

// Creates a fresh docx with real docProps/core.xml creation/modification timestamps, matching every real document producer's own behaviour -- systemClock fires by default (options.clock overrides it, e.g. with fixedClock in a test), never behind an opt-in flag. See src/model/metadata.ts's resolveMetadataTimestamps for the exact precedence.
export function createDocx(options?: CreateDocxOptions): DocxEditor {
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps({}, clock);
  return new DocxEditor(createEmptyDocxPackage({ metadata }));
}
