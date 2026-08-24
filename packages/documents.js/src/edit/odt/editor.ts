import type { ContentFormula, ContentVector } from "document-schema.js";
import type { Package, XmlElement } from "odf.js";
import { decodePackage, encodePackage } from "odf.js";
import type { Box } from "document-schema.js";
import { resolveMetadataTimestamps } from "../../model/metadata";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { buildVectorElement } from "../odg/vector";
import { ensurePageBreakStyleName } from "./automatic-styles";
import { insertFormulaFrameMedia } from "./formula";
import { buildList, OdtList } from "./list";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, OdtParagraph } from "./paragraph";
import { createEmptyOdtPackage } from "./scaffold";
import type { TableInit } from "./table";
import { buildTable, OdtTable } from "./table";

const CONTENT_PART_PATH = "content.xml";

export interface OdtBody {
  appendParagraph(init?: ParagraphInit): OdtParagraph;
  appendTable(init: TableInit): OdtTable;
  appendList(): OdtList;
  appendPageBreak(): void;
  appendFormula(formula: ContentFormula, frame: Box): OdtParagraph;
  appendVectors(vectors: readonly ContentVector[]): OdtParagraph;
}

function findContentRoot(pkg: Package): XmlElement {
  const part = pkg.parts[CONTENT_PART_PATH];
  const root =
    part?.kind === "xml"
      ? part.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  if (root === undefined) {
    throw new Error(`package has no root element at ${CONTENT_PART_PATH}`);
  }
  return root;
}

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

function findOfficeText(contentRoot: XmlElement): XmlElement {
  const body = directChild(contentRoot, "office:body");
  const text =
    body === undefined ? undefined : directChild(body, "office:text");
  if (text === undefined) {
    throw new Error(
      `${CONTENT_PART_PATH} has no office:body/office:text element`,
    );
  }
  return text;
}

class OdtBodyImpl implements OdtBody {
  constructor(
    private readonly officeText: XmlElement,
    private readonly pkg: Package,
  ) {}

  appendParagraph(init?: ParagraphInit): OdtParagraph {
    const paragraphElement = buildParagraph(this.pkg, init);
    this.officeText.children.push(paragraphElement);
    return new OdtParagraph(
      this.officeText.children,
      paragraphElement,
      this.pkg,
    );
  }

  appendTable(init: TableInit): OdtTable {
    const tableElement = buildTable(this.pkg, init);
    this.officeText.children.push(tableElement);
    return new OdtTable(this.officeText.children, tableElement, this.pkg);
  }

  appendList(): OdtList {
    const listElement = buildList(this.pkg);
    this.officeText.children.push(listElement);
    return new OdtList(this.officeText.children, listElement, this.pkg);
  }

  // Appends a paragraph whose only content is a real embedded formula: a draw:frame/draw:object referencing a genuine ODF formula sub-document written into this same package (src/odf-package/formula.ts). The odt counterpart to DocxParagraph.appendOfficeMath -- but a whole nested document rather than a different markup vocabulary inline, which is what an embedded ODF object actually is. The paragraph is returned so a caller can style or extend it; src/odf/odt/read.ts recognises a paragraph carrying nothing but a formula frame AS the formula, so leaving it otherwise empty is what makes the write-then-read round trip land on a single formula block rather than a formula beside an empty paragraph.
  appendFormula(formula: ContentFormula, frame: Box): OdtParagraph {
    const paragraphElement = buildParagraph(this.pkg);
    paragraphElement.children.push(
      insertFormulaFrameMedia(this.pkg, frame, formula),
    );
    this.officeText.children.push(paragraphElement);
    return new OdtParagraph(
      this.officeText.children,
      paragraphElement,
      this.pkg,
    );
  }

  // Appends a paragraph whose only content is a run of real vector primitives -- draw:rect/draw:ellipse/draw:line/draw:path elements built by src/edit/odg/vector.ts's shared writer, anchored to this one paragraph but positioned against the PAGE (see that module's own buildVectorElement note and style.ts's TEXT_FLOW_ANCHOR_ATTRS for why both halves of that anchoring are needed). The odt counterpart of appendFormula above: a text document has no container for bare geometry, so a paragraph carries it, exactly as one carries an embedded formula object.
  //
  // One paragraph holds the WHOLE run rather than one paragraph per vector: they came from a single embedded drawing block covering one page's worth of geometry, they are all positioned page-absolutely, and an extra empty paragraph per rect would add real, visible vertical space to the reflowed text for no gain.
  appendVectors(vectors: readonly ContentVector[]): OdtParagraph {
    const paragraphElement = buildParagraph(this.pkg);
    for (const vector of vectors) {
      paragraphElement.children.push(
        buildVectorElement(this.pkg, vector, { textFlowAnchored: true }),
      );
    }
    this.officeText.children.push(paragraphElement);
    return new OdtParagraph(
      this.officeText.children,
      paragraphElement,
      this.pkg,
    );
  }

  // ODF has no inline "hard page break" content element the way WordprocessingML's w:br/@w:type="page" is (see docx's own DocxBody.appendPageBreak, src/edit/docx/editor.ts) -- a manual page break is exclusively a paragraph-style property (style:paragraph-properties/@fo:break-before="page"), so this inserts an empty paragraph pointed at the shared page-break style (automatic-styles.ts's ensurePageBreakStyleName).
  appendPageBreak(): void {
    const paragraphElement = buildParagraph(this.pkg);
    paragraphElement.attributes.push({
      name: "text:style-name",
      value: ensurePageBreakStyleName(this.pkg),
    });
    this.officeText.children.push(paragraphElement);
  }
}

export class OdtEditor {
  readonly body: OdtBody;
  private readonly pkg: Package;

  constructor(pkg: Package) {
    this.pkg = pkg;
    const officeText = findOfficeText(findContentRoot(pkg));
    this.body = new OdtBodyImpl(officeText, pkg);
  }

  // Direct paragraph-level children of office:text -- text:p and text:h both, exactly the two tags odf.js's own office:text walk reads (src/typed/odt/read.ts), so a heading written through OdtParagraph's headingLevel setter or buildOdtPackage is visible here with its headingLevel readable, the same way a heading-styled w:p is visible in DocxEditor.paragraphs (in WordprocessingML a heading IS a w:p; in ODF it is a distinct tag, but the editor surface treats both as paragraphs). A paragraph nested inside a text:list-item (see list.ts) is reached via OdtList/OdtListItem, and a paragraph inside a table:table-cell (see table.ts) via OdtTable, mirroring DocxEditor.paragraphs' own direct-children-only scope (src/edit/docx/editor.ts).
  paragraphs(): OdtParagraph[] {
    const officeText = findOfficeText(findContentRoot(this.pkg));
    const out: OdtParagraph[] = [];
    for (const child of officeText.children) {
      if (
        child.type === "element" &&
        (child.tag === "text:p" || child.tag === "text:h")
      ) {
        out.push(new OdtParagraph(officeText.children, child, this.pkg));
      }
    }
    return out;
  }

  tables(): OdtTable[] {
    const officeText = findOfficeText(findContentRoot(this.pkg));
    const out: OdtTable[] = [];
    for (const child of officeText.children) {
      if (child.type === "element" && child.tag === "table:table") {
        out.push(new OdtTable(officeText.children, child, this.pkg));
      }
    }
    return out;
  }

  lists(): OdtList[] {
    const officeText = findOfficeText(findContentRoot(this.pkg));
    const out: OdtList[] = [];
    for (const child of officeText.children) {
      if (child.type === "element" && child.tag === "text:list") {
        out.push(new OdtList(officeText.children, child, this.pkg));
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

export function openOdt(bytes: Uint8Array<ArrayBuffer>): OdtEditor {
  return new OdtEditor(decodePackage(bytes));
}

export interface CreateOdtOptions {
  readonly clock?: ClockPort;
}

// Creates a fresh odt with real office:meta creation/modification timestamps -- mirrors createDocx's own default-on clock behaviour exactly (src/edit/docx/editor.ts).
export function createOdt(options?: CreateOdtOptions): OdtEditor {
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps({}, clock);
  return new OdtEditor(createEmptyOdtPackage({ metadata }));
}
