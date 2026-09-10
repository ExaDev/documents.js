import type {
  ContentFormula,
  ContentVector,
  LayoutMetadata,
  ContentEmbeddedObject,
} from "document-schema.js";
import type { Package, XmlElement } from "odf.js";
import {
  decodePackage,
  encodePackage,
  odfIndexWrapperTag,
  readOdfMetadata,
  writeEmbeddedObject,
} from "odf.js";
import type {
  Box,
  ContentControlDescriptor,
  DivisionDescriptor,
} from "document-schema.js";
import { patchOdfMetadataOnPackage } from "../../metadata/core-patch";
import { resolveMetadataTimestamps } from "../../model/metadata";
import { encodeXmlText } from "../../xml/entities";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { buildVectorElement } from "../odg/vector";
import { ensurePageBreakStyleName } from "./automatic-styles";
import { insertFormulaFrameMedia } from "./formula";
import { buildList, OdtList } from "./list";
import type { ParagraphInit } from "./paragraph";
import { buildParagraph, OdtParagraph } from "./paragraph";
import { createEmptyOdtPackage, ODF_VERSION } from "./scaffold";
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
  // A bookmark's two halves as office:text-level siblings bracketing whatever is appended between the two calls -- the one construct shape expressible append-only, since ODF allows text:bookmark-start/text:bookmark-end directly in the body flow around whole blocks. The name travels on both halves, the shape every real producer writes and odf.js's own reader pairs back through.
  appendBookmarkStart(name: string): void;
  appendBookmarkEnd(name: string): void;
  // A division region: every append between openDivisionRegion and closeRegion lands inside the division's own text:section element -- the block-flow spelling of an ODF division, which LibreOffice itself writes as text:section around the content it groups. The descriptor drives the section's own attributes (text:name, text:protected, and a trailing text:section-source for a linked chapter), mirroring odf.js's own typed writer; the one field not carried is columnCount, which needs the section-style interning that writer's style machinery performs and this editor surface does not have. Regions nest to arbitrary depth.
  openDivisionRegion(descriptor: DivisionDescriptor): void;
  // An index-wrapper region (text:table-of-content or one of its six siblings around the extent's own text:index-body). Answers false when the descriptor's *-source residue names no recognisable wrapper -- there is then no fact saying which of the seven to write.
  openIndexRegion(descriptor: ContentControlDescriptor): boolean;
  closeRegion(): void;
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
  // The text:section elements of every division region currently open, innermost last, each with its still-unwritten text:section-source (a linked section's source element follows the section's children in the ODF schema, so it is spliced on at close). Appends target the innermost open section's own children and fall back to office:text when none is open.
  private readonly openRegions: {
    container: XmlElement;
    linked: DivisionDescriptor["linked"];
  }[] = [];

  constructor(
    private readonly officeText: XmlElement,
    private readonly pkg: Package,
  ) {}

  private containerChildren(): XmlElement["children"] {
    return (
      this.openRegions.at(-1)?.container.children ?? this.officeText.children
    );
  }

  appendParagraph(init?: ParagraphInit): OdtParagraph {
    const paragraphElement = buildParagraph(this.pkg, init);
    const container = this.containerChildren();
    container.push(paragraphElement);
    return new OdtParagraph(container, paragraphElement, this.pkg);
  }

  appendTable(init: TableInit): OdtTable {
    const tableElement = buildTable(this.pkg, init);
    const container = this.containerChildren();
    container.push(tableElement);
    return new OdtTable(container, tableElement, this.pkg);
  }

  appendList(): OdtList {
    const listElement = buildList(this.pkg);
    const container = this.containerChildren();
    container.push(listElement);
    return new OdtList(container, listElement, this.pkg);
  }

  // Appends a paragraph whose only content is a real embedded formula: a draw:frame/draw:object referencing a genuine ODF formula sub-document written into this same package (src/odf-package/formula.ts). The odt counterpart to DocxParagraph.appendOfficeMath -- but a whole nested document rather than a different markup vocabulary inline, which is what an embedded ODF object actually is. The paragraph is returned so a caller can style or extend it; src/odf/odt/read.ts recognises a paragraph carrying nothing but a formula frame AS the formula, so leaving it otherwise empty is what makes the write-then-read round trip land on a single formula block rather than a formula beside an empty paragraph.
  appendFormula(formula: ContentFormula, frame: Box): OdtParagraph {
    const paragraphElement = buildParagraph(this.pkg);
    paragraphElement.children.push(
      insertFormulaFrameMedia(this.pkg, frame, formula),
    );
    const container = this.containerChildren();
    container.push(paragraphElement);
    return new OdtParagraph(container, paragraphElement, this.pkg);
  }

  // Appends a paragraph whose only content is a real embedded sub-document of any non-chart, non-formula kind -- a draw:frame/draw:object referencing a genuine nested "Object N/" package built by odf.js's own writeEmbeddedObject (ExaDev/documents.js#972): wordprocessing, presentation, spreadsheet, or drawing. The name counter is this editor's own, mirroring odf.js's own per-writer numbering, so two objects never share a directory. A formula keeps its dedicated appendFormula (a formula sub-package is structurally its own case, not the generic one), and the chart kind stays a documented gap (#719's quarantined-residue decision).
  appendEmbeddedObject(
    object: ContentEmbeddedObject,
    directory: string,
  ): OdtParagraph {
    const paragraphElement = buildParagraph(this.pkg);
    paragraphElement.children.push(
      writeEmbeddedObject(object, directory, this.pkg),
    );
    const container = this.containerChildren();
    container.push(paragraphElement);
    return new OdtParagraph(container, paragraphElement, this.pkg);
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
    const container = this.containerChildren();
    container.push(paragraphElement);
    return new OdtParagraph(container, paragraphElement, this.pkg);
  }

  // ODF has no inline "hard page break" content element the way WordprocessingML's w:br/@w:type="page" is (see docx's own DocxBody.appendPageBreak, src/edit/docx/editor.ts) -- a manual page break is exclusively a paragraph-style property (style:paragraph-properties/@fo:break-before="page"), so this inserts an empty paragraph pointed at the shared page-break style (automatic-styles.ts's ensurePageBreakStyleName).
  appendPageBreak(): void {
    const paragraphElement = buildParagraph(this.pkg);
    paragraphElement.attributes.push({
      name: "text:style-name",
      value: ensurePageBreakStyleName(this.pkg),
    });
    this.containerChildren().push(paragraphElement);
  }

  appendBookmarkStart(name: string): void {
    this.containerChildren().push({
      type: "element",
      tag: "text:bookmark-start",
      attributes: [{ name: "text:name", value: encodeXmlText(name) }],
      children: [],
    });
  }

  appendBookmarkEnd(name: string): void {
    this.containerChildren().push({
      type: "element",
      tag: "text:bookmark-end",
      attributes: [{ name: "text:name", value: encodeXmlText(name) }],
      children: [],
    });
  }

  openDivisionRegion(descriptor: DivisionDescriptor): void {
    // Mirrors odf.js's own writeOdfDivision (typed/shared/constructs.ts) attribute for attribute, the one deliberately-absent field being columnCount (no section-style interner on this editor surface -- the typed writer is the full-fidelity path for a columned division).
    const attributes: { name: string; value: string }[] = [];
    if (descriptor.name !== undefined) {
      attributes.push({
        name: "text:name",
        value: encodeXmlText(descriptor.name),
      });
    }
    if (descriptor.protected === true) {
      attributes.push({ name: "text:protected", value: "true" });
    }
    const section: XmlElement = {
      type: "element",
      tag: "text:section",
      attributes,
      children: [],
    };
    this.containerChildren().push(section);
    this.openRegions.push({ container: section, linked: descriptor.linked });
  }

  openIndexRegion(descriptor: ContentControlDescriptor): boolean {
    // An index wrapper region: the blocks between the markers land inside the wrapper's own text:index-body, mirroring odf.js's writeOdfIndexWrapper element for element (text:name when the descriptor carries a tag, a BARE *-source child the ODF schema requires every real wrapper to carry, and the index-body the appends target). The wrapper TAG itself -- which of the seven ODF index wrappers this is -- is recoverable only from the descriptor's *-source residue (odfIndexWrapperTag's own rule), so a descriptor without one has no fact naming the wrapper and answers false, which the caller treats as a refusal.
    let tag: string;
    try {
      tag = odfIndexWrapperTag(descriptor);
    } catch {
      return false;
    }
    const attributes: { name: string; value: string }[] = [];
    if (descriptor.tag !== undefined) {
      attributes.push({
        name: "text:name",
        value: encodeXmlText(descriptor.tag),
      });
    }
    const indexBody: XmlElement = {
      type: "element",
      tag: "text:index-body",
      attributes: [],
      children: [],
    };
    const wrapper: XmlElement = {
      type: "element",
      tag,
      attributes,
      children: [
        { type: "element", tag: `${tag}-source`, attributes: [], children: [] },
        indexBody,
      ],
    };
    this.containerChildren().push(wrapper);
    this.openRegions.push({ container: indexBody, linked: undefined });
    return true;
  }

  closeRegion(): void {
    const entry = this.openRegions.pop();
    if (entry === undefined) {
      return;
    }
    // A linked section's text:section-source follows the section's own children in the ODF schema, so it could not be appended at open -- the children it trails were not appended yet.
    if (entry.linked !== undefined) {
      const sourceAttributes: { name: string; value: string }[] = [
        { name: "xlink:type", value: "simple" },
        { name: "xlink:href", value: encodeXmlText(entry.linked.href) },
      ];
      if (entry.linked.sectionName !== undefined) {
        sourceAttributes.push({
          name: "text:section-name",
          value: encodeXmlText(entry.linked.sectionName),
        });
      }
      entry.container.children.push({
        type: "element",
        tag: "text:section-source",
        attributes: sourceAttributes,
        children: [],
      });
    }
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

  // Reads/patches meta.xml directly on the live package -- ExaDev/documents.js#933's own "editor.metadata = {...}" gap, the ODF-side mirror of DocxEditor's own identical getter/setter (src/edit/docx/editor.ts's own comment states the full title/author/subject/keywords-only rationale). Only those four fields are ever written -- meta.xml has no ODF spelling for LayoutMetadata's other fields (producer, publisher, ...), so a setter value naming one of those silently writes nothing for it, exactly as readOdfMetadata itself never populates them. title/author/subject can be CHANGED but not REMOVED once a document has one (patchOdfMetadata's own documented limitation, mirroring patchCoreProperties'); keywords can be cleared to none via an empty array.
  get metadata(): LayoutMetadata {
    return readOdfMetadata(this.pkg);
  }

  set metadata(value: LayoutMetadata) {
    patchOdfMetadataOnPackage(this.pkg, value, ODF_VERSION);
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
