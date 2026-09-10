import type { LayoutMetadata } from "document-schema.js";
import type { Package, XmlElement, XmlNode } from "ooxml.js";
import {
  decodePackage,
  encodePackage,
  readCoreProperties,
  rootElement,
} from "ooxml.js";
import { patchOoxmlCorePropertiesOnPackage } from "../../metadata/core-patch";
import { resolveMetadataTimestamps } from "../../model/metadata";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { el } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import type { ImageMediaContext } from "./paragraph";
import { buildParagraph, DocxParagraph } from "./paragraph";
import type { ParagraphInit } from "./paragraph";
import { createEmptyDocxPackage } from "./scaffold";
import { buildTable, DocxTable } from "./table";
import type { ContentControlDescriptor } from "document-schema.js";
import type { TableInit } from "./table";

const DOCUMENT_PART_PATH = "word/document.xml";
const MEDIA_DIR = "word/media";

export interface DocxBody {
  insertParagraphAt(index: number, init?: ParagraphInit): DocxParagraph;
  appendParagraph(init?: ParagraphInit): DocxParagraph;
  appendTable(init: TableInit): DocxTable;
  appendPageBreak(): void;
  // A bookmark's two halves as body-level siblings bracketing whatever is appended between the two calls -- the one construct shape that is expressible append-only, since WordprocessingML allows w:bookmarkStart/w:bookmarkEnd directly inside w:body around whole blocks. The id is the caller's to keep unique document-wide and to pair across the two halves; the name travels on the start half alone, exactly as a reader pairs them back.
  appendBookmarkStart(id: number, name: string): void;
  appendBookmarkEnd(id: number): void;
  // A content-control (SDT) region: every append between openContentControlRegion and closeRegion lands inside the control's own w:sdtContent rather than as a body sibling -- the block-flow spelling of an SDT, which Word itself writes as w:sdt > w:sdtPr + w:sdtContent around the content it governs. The descriptor drives w:sdtPr (w:id minted per document, w:tag/w:alias/w:lock, and the one type element each controlType maps to -- the exact inverse of ooxml.js's own reader, so a written control reads back as the same descriptor). Regions nest to arbitrary depth; the one field with no spelling here is columnCount-style geometry an SDT does not carry.
  openContentControlRegion(descriptor: ContentControlDescriptor): void;
  closeRegion(): void;
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
  // The w:sdtContent elements of every content-control region currently open, innermost last. Appends target the innermost open region's own children (plain push -- a w:sdtContent has no w:sectPr to insert before) and fall back to the body's own insertion point when empty.
  private readonly openRegions: XmlElement[] = [];
  private nextSdtId = 1;

  constructor(
    private readonly body: XmlElement,
    private readonly imageContext: ImageMediaContext,
    private readonly pkg: Package,
  ) {}

  private appendToBody(element: XmlElement): void {
    const region = this.openRegions.at(-1);
    if (region !== undefined) {
      region.children.push(element);
      return;
    }
    this.body.children.splice(bodyInsertionPoint(this.body), 0, element);
  }

  appendParagraph(init?: ParagraphInit): DocxParagraph {
    const paragraphElement = buildParagraph(init);
    this.appendToBody(paragraphElement);
    const container = this.openRegions.at(-1)?.children ?? this.body.children;
    return new DocxParagraph(
      container,
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
    this.appendToBody(tableElement);
    const container = this.openRegions.at(-1)?.children ?? this.body.children;
    return new DocxTable(container, tableElement);
  }

  appendPageBreak(): void {
    const run = el("w:r", {}, [el("w:br", { "w:type": "page" })]);
    const paragraph = el("w:p", {}, [run]);
    this.appendToBody(paragraph);
  }

  appendBookmarkStart(id: number, name: string): void {
    this.appendToBody(
      el("w:bookmarkStart", {
        "w:id": String(id),
        "w:name": encodeXmlText(name),
      }),
    );
  }

  appendBookmarkEnd(id: number): void {
    this.appendToBody(el("w:bookmarkEnd", { "w:id": String(id) }));
  }

  openContentControlRegion(descriptor: ContentControlDescriptor): void {
    const id = this.nextSdtId;
    this.nextSdtId += 1;
    const sdtPr: XmlNode[] = [el("w:id", { "w:val": String(id) })];
    if (descriptor.alias !== undefined) {
      sdtPr.push(el("w:alias", { "w:val": encodeXmlText(descriptor.alias) }));
    }
    if (descriptor.tag !== undefined) {
      sdtPr.push(el("w:tag", { "w:val": encodeXmlText(descriptor.tag) }));
    }
    if (descriptor.lock !== undefined) {
      // The inverse of ooxml.js's LOCK_BY_VALUE: the schema's three lock members map onto the three w:lock values Word defines.
      sdtPr.push(
        el("w:lock", {
          "w:val":
            descriptor.lock === "content"
              ? "contentLocked"
              : descriptor.lock === "container"
                ? "sdtLocked"
                : "sdtContentLocked",
        }),
      );
    }
    // The type element is the inverse of ooxml.js's CONTROL_TYPE_BY_TAG. The w: spellings stay inside the one namespace this package's scaffold declares; the checkbox state element is w:checked (the reader accepts it beside Word's own w14:checked, and this scaffold declares no w14 namespace to spell it in).
    switch (descriptor.controlType) {
      case "plainText":
        sdtPr.push(el("w:text", {}));
        break;
      case "comboBox":
      case "dropDown":
        sdtPr.push(
          el(
            descriptor.controlType === "comboBox"
              ? "w:comboBox"
              : "w:dropDownList",
            {},
            (descriptor.options ?? []).map((option) =>
              el("w:listItem", {
                "w:displayText": encodeXmlText(option),
                "w:value": encodeXmlText(option),
              }),
            ),
          ),
        );
        break;
      case "date":
        sdtPr.push(
          el(
            "w:date",
            descriptor.value === undefined
              ? {}
              : { "w:fullDate": encodeXmlText(descriptor.value) },
          ),
        );
        break;
      case "checkbox":
        sdtPr.push(
          el("w:checkbox", {}, [
            el("w:checked", {
              "w:val": descriptor.checked === true ? "true" : "false",
            }),
          ]),
        );
        break;
      case "picture":
        sdtPr.push(el("w:picture", {}));
        break;
      case "group":
        sdtPr.push(el("w:group", {}));
        break;
      case "repeatingSection":
        sdtPr.push(el("w:repeatingSection", {}));
        break;
      case "index":
        // docx's TOC-as-SDT: the one gallery value ooxml.js's reader maps to controlType "index" rather than degrading to richText with the docPartObj quarantined.
        sdtPr.push(
          el("w:docPartObj", {}, [
            el("w:docPartGallery", {
              "w:val": "Table of Contents",
            }),
          ]),
        );
        break;
      case "richText":
        break;
    }
    const sdtContent = el("w:sdtContent", {}, []);
    this.appendToBody(el("w:sdt", {}, [el("w:sdtPr", {}, sdtPr), sdtContent]));
    this.openRegions.push(sdtContent);
  }

  closeRegion(): void {
    this.openRegions.pop();
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

  // Reads/patches docProps/core.xml directly on the live package -- ExaDev/documents.js#933's own "editor.metadata = {...}" gap, the same live-view/patch-in-place pattern this ecosystem's set-metadata CLI command already gets through patchDocxMetadata (src/metadata/write.ts), now available on an already-open editor with no re-decode required. Only title/author/subject/keywords are ever written -- docProps/core.xml has no OOXML spelling for LayoutMetadata's other fields (producer, language, publisher, ...), so a setter value naming one of those silently writes nothing for it, exactly as readCoreProperties itself never populates them (see that function's own comment). title/author/subject can be CHANGED but not REMOVED once a document has one (patchCoreProperties' own documented limitation); keywords can be cleared to none via an empty array.
  get metadata(): LayoutMetadata {
    return readCoreProperties(this.pkg);
  }

  set metadata(value: LayoutMetadata) {
    patchOoxmlCorePropertiesOnPackage(this.pkg, value);
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
