import type { Package, XmlElement } from "odf.js";
import { decodePackage, encodePackage } from "odf.js";
import { attr } from "ooxml.js";
import { resolveMetadataTimestamps } from "../../model/metadata";
import type { ClockPort } from "../../ports/clock";
import { systemClock } from "../../ports/clock";
import { el } from "../../xml/fragment";
import { ensureAutomaticStyles } from "../odt/automatic-styles";
import {
  createEmptyOdsPackage,
  MASTER_PAGE_NAME,
  SHEET_TABLE_STYLE_NAME,
} from "./scaffold";
import { OdsSheet } from "./sheet";

const CONTENT_PART_PATH = "content.xml";

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

function findRoot(pkg: Package): XmlElement {
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

function findOfficeSpreadsheet(pkg: Package): XmlElement {
  const contentRoot = findRoot(pkg);
  const body = directChild(contentRoot, "office:body");
  const spreadsheet =
    body === undefined ? undefined : directChild(body, "office:spreadsheet");
  if (spreadsheet === undefined) {
    throw new Error(
      `${CONTENT_PART_PATH} has no office:body/office:spreadsheet element`,
    );
  }
  return spreadsheet;
}

// The single, shared, idempotently-created table-family style every sheet this editor creates references via table:table/@table:style-name -- mirrors odt/automatic-styles.ts's own ensurePageBreakStyleName exactly (one fixed name, reused across every call rather than re-minted, since there is exactly one print-settings reference every sheet this editor builds ever wants: scaffold.ts's own shared master page). Reuses odt/automatic-styles.ts's ensureAutomaticStyles wholesale rather than reimplementing "find or create office:automatic-styles at the right schema position" a second time -- that helper's own "before office:body/master-styles/settings" insertion rule is generic ODF content-part structure, not odt-specific, despite living in odt/.
function ensureSheetTableStyleName(pkg: Package): string {
  const automaticStyles = ensureAutomaticStyles(pkg);
  const existing = automaticStyles.children.find(
    (child) =>
      child.type === "element" &&
      child.tag === "style:style" &&
      attr(child, "style:name") === SHEET_TABLE_STYLE_NAME,
  );
  if (existing !== undefined) {
    return SHEET_TABLE_STYLE_NAME;
  }
  automaticStyles.children.push(
    el("style:style", {
      "style:name": SHEET_TABLE_STYLE_NAME,
      "style:family": "table",
      "style:master-page-name": MASTER_PAGE_NAME,
    }),
  );
  return SHEET_TABLE_STYLE_NAME;
}

export class OdsEditor {
  private readonly pkg: Package;

  constructor(pkg: Package) {
    this.pkg = pkg;
  }

  sheets(): OdsSheet[] {
    const spreadsheet = findOfficeSpreadsheet(this.pkg);
    const out: OdsSheet[] = [];
    for (const child of spreadsheet.children) {
      if (child.type === "element" && child.tag === "table:table") {
        out.push(new OdsSheet(spreadsheet.children, child, this.pkg));
      }
    }
    return out;
  }

  // The first sheet whose table:name matches, or throws -- mirrors OdtTable.cell's own throwing convention (src/edit/odt/table.ts) for an address that doesn't exist.
  sheet(name: string): OdsSheet {
    const found = this.sheets().find((candidate) => candidate.name === name);
    if (found === undefined) {
      throw new Error(`no sheet named "${name}" exists in this spreadsheet`);
    }
    return found;
  }

  addSheet(name: string): OdsSheet {
    const spreadsheet = findOfficeSpreadsheet(this.pkg);
    const styleName = ensureSheetTableStyleName(this.pkg);
    const tableElement = el("table:table", {
      "table:name": name,
      "table:style-name": styleName,
    });
    spreadsheet.children.push(tableElement);
    return new OdsSheet(spreadsheet.children, tableElement, this.pkg);
  }

  removeSheetAt(index: number): void {
    const spreadsheet = findOfficeSpreadsheet(this.pkg);
    const tableElements = spreadsheet.children.filter(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "table:table",
    );
    const target = tableElements[index];
    if (target === undefined) {
      throw new Error(`sheet index ${index} does not exist`);
    }
    const listIndex = spreadsheet.children.indexOf(target);
    spreadsheet.children.splice(listIndex, 1);
  }

  toPackage(): Package {
    return this.pkg;
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    return encodePackage(this.pkg);
  }
}

export function openOds(bytes: Uint8Array<ArrayBuffer>): OdsEditor {
  return new OdsEditor(decodePackage(bytes));
}

export interface CreateOdsOptions {
  readonly clock?: ClockPort;
}

// Creates a fresh ods with real office:meta creation/modification timestamps -- mirrors createDocx's own default-on clock behaviour exactly (src/edit/docx/editor.ts).
export function createOds(options?: CreateOdsOptions): OdsEditor {
  const clock = options?.clock ?? systemClock;
  const metadata = resolveMetadataTimestamps({}, clock);
  return new OdsEditor(createEmptyOdsPackage({ metadata }));
}
