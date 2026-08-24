import type { XmlElement, XmlNode } from "../../model/node";
import type { Package } from "../../model/package";
import { findChildElement, attrValue, rootElement } from "../../xml/query";
import { decodeXmlText } from "../../xml/entities";
import { resolveOdbComponent } from "./read";
import { subDocumentPackage } from "./subdocument";

// A .odb Report Builder report sub-document -> its static band/group/field STRUCTURE. Nothing here executes SQL, connects to a database, evaluates an rpt: formula, or renders a page: a report's real output only exists once a live engine has answered rpt:command and the (Java, Pentaho-derived) reporting engine has laid the answer out, both categorically out of scope for this package. What IS statically present in the file -- and what this reader returns -- is the complete design: the data binding, the band stack, the group tree, and every band's own bound fields and computed expressions.
//
// EMPIRICALLY CONFIRMED against real, unmodified LibreOffice 26.2 Report Builder output (src/typed/odb/fixtures/form-and-report.odb -- see typed/odb/read.ts's own top-of-file note for how that fixture was generated and cross-verified), NOT from the rpt: schema or from memory. Six findings, every one of which shaped the model below:
//
// 1. office:report is office:body's own content alternative for a report sub-document (the rpt:-namespace counterpart to office:text/office:database/etc.), carrying the whole data binding as ATTRIBUTES: rpt:command (a table name, a query name, or a literal SQL string), rpt:command-type ("table" | "query" | "command"), office:caption, office:mimetype, draw:name. The sub-document's own manifest:media-type is "application/vnd.sun.xml.report" -- NOT an opendocument.* type -- which is why it is a report sub-document rather than an ordinary text one, even though office:mimetype separately claims "application/vnd.oasis.opendocument.text" (that is the mimetype of the report's own RENDERED output, not of the definition file).
// 2. THE DETAIL BAND IS NESTED INSIDE THE INNERMOST GROUP, not a flat sibling of the other bands. With no groups at all, rpt:detail is a direct child of office:report; with groups, office:report holds rpt:report-header, rpt:page-header, then ONE rpt:group, and each rpt:group holds rpt:group-header, then either a further nested rpt:group or rpt:detail, then rpt:group-footer -- so a two-group report puts rpt:detail two levels deep. Both shapes were observed directly (a first fixture build with no groups, then this one with two). readDetail below therefore descends the group chain rather than looking for a sibling.
// 3. A band's own content is a table:table (table:name "Report Header"/"Page Header"/"Group Header"/"Detail"/"Group Footer"/"Page Footer"/"Report Footer"), whose cells hold the report's controls. The table is pure LAYOUT scaffolding -- column widths, spanned/covered cells, a leading and trailing empty spacer row -- and this reader deliberately does not reconstruct it: a control's own grid position is presentation, not structure, and modelling it would mean inventing a geometry model no caller of a STRUCTURE reader asked for. Controls are collected in document order by descending through whatever cells/paragraphs enclose them.
// 4. A control is an rpt:* element carrying an rpt:report-element child (which itself wraps rpt:report-component/@draw:name, the producer's own control-kind label -- "Label field", "Formatted field"). That structural signal, not a closed list of element tags, is what identifies a control here -- so an rpt: control kind this fixture happens not to exercise still comes back as an ordinary element with its tag preserved, rather than being silently dropped.
// 5. TWO control kinds were observed, and they carry their payload differently: rpt:fixed-content holds LITERAL text in a nested text:p (a static label), while rpt:formatted-text carries an rpt:formula ATTRIBUTE and no text at all. A formula is one of exactly two real shapes, both observed: "field:[COLUMN]" -- a plain bound field -- or "rpt:<EXPRESSION>" -- a computed expression, e.g. "rpt:SUM([AMOUNT])". dataField below is populated only for the first, by unwrapping that exact "field:[...]" form; anything else is left as formula alone, never guessed at or parsed further.
// 6. A group's own key is NOT stored as a bare column name. rpt:group-expression holds a real formula -- "rpt:HASCHANGED(&quot;REGION&quot;)" for a plain per-value group -- alongside rpt:sort-expression, which DOES hold the bare column. Grouping "on prefix characters" (the UNO GroupOn/GroupInterval pair) is not serialised as attributes at all: LibreOffice instead mints a report-level rpt:function (rpt:name="LEFT_QUARTER", rpt:formula="rpt:LEFT([QUARTER];2)") and points rpt:group-expression at THAT name -- confirmed by setting those exact UNO properties and reading back the result. Report functions are consequently read as their own first-class list, since a group expression can be meaningless without them.

export interface OdbReportElement {
  // The control's own real ODF element tag, e.g. 'rpt:formatted-text', 'rpt:fixed-content'. Kept verbatim rather than mapped onto a closed enum -- see this module's own top-of-file note (finding 4).
  tag: string;
  // rpt:report-element/rpt:report-component/@draw:name -- the producer's own control-kind label, e.g. 'Label field', 'Formatted field'.
  name?: string;
  // The literal text of a static label control (rpt:fixed-content's own nested text:p content).
  text?: string;
  // rpt:formula, verbatim -- either 'field:[COLUMN]' or a computed 'rpt:...' expression. See this module's own top-of-file note (finding 5).
  formula?: string;
  // The bound column, set only when formula is exactly the 'field:[COLUMN]' form. Absent for a computed expression, which is left as formula alone.
  dataField?: string;
}

export interface OdbReportBand {
  // Which band this is, from its own rpt: element tag.
  kind:
    | "report-header"
    | "page-header"
    | "group-header"
    | "detail"
    | "group-footer"
    | "page-footer"
    | "report-footer";
  // The band layout table's own table:name, e.g. 'Group Footer'. Producer-assigned, not user-visible.
  name?: string;
  elements: OdbReportElement[];
}

export interface OdbReportFunction {
  // rpt:name -- the identifier an rpt:group-expression or another formula references.
  name: string;
  // rpt:formula, verbatim, e.g. 'rpt:LEFT([QUARTER];2)'.
  formula: string;
}

export interface OdbReportGroup {
  // rpt:group-expression -- a real formula, NOT a bare column name. See this module's own top-of-file note (finding 6).
  groupExpression?: string;
  // rpt:sort-expression -- the bare column the group sorts and breaks on.
  sortExpression?: string;
  sortAscending?: boolean;
  startNewColumn?: boolean;
  resetPageNumber?: boolean;
  // rpt:keep-together, e.g. 'whole-group'. Carried verbatim rather than mapped onto an enum, since only that one value was observed.
  keepTogether?: string;
  header?: OdbReportBand;
  footer?: OdbReportBand;
  // Functions declared on this group itself, rather than on the report as a whole.
  functions: OdbReportFunction[];
  // A directly nested rpt:group, if any -- real reports nest one group per grouping level. See this module's own top-of-file note (finding 2).
  groups: OdbReportGroup[];
}

export interface OdbReport {
  // The report's own user-visible name, from content.xml's db:reports/db:component -- NOT the persistent storage directory name.
  name: string;
  // The sub-document's own package path, e.g. 'reports/Obj11'.
  href: string;
  // rpt:command -- a table name, a query name, or a literal SQL string, discriminated by commandType.
  command?: string;
  // rpt:command-type -- 'table' | 'query' | 'command' in real output, carried verbatim rather than narrowed, since a producer is free to write any of the schema's own values.
  commandType?: string;
  caption?: string;
  // office:mimetype -- the mimetype of the report's RENDERED output, not of this definition file. See this module's own top-of-file note (finding 1).
  mimeType?: string;
  reportHeader?: OdbReportBand;
  pageHeader?: OdbReportBand;
  // The top-level group chain, in outermost-first order. Each group's own nested groups hang off its `groups`.
  groups: OdbReportGroup[];
  // The detail band, found by descending the group chain (or directly under office:report when the report has no groups at all).
  detail?: OdbReportBand;
  pageFooter?: OdbReportBand;
  reportFooter?: OdbReportBand;
  // Report-level rpt:function declarations, which a group expression or another formula may reference by name.
  functions: OdbReportFunction[];
}

const CONTENT_PART = "content.xml";
const GROUP_TAG = "rpt:group";
const FUNCTION_TAG = "rpt:function";
const REPORT_ELEMENT_TAG = "rpt:report-element";
const REPORT_COMPONENT_TAG = "rpt:report-component";
const RPT_TAG_PREFIX = "rpt:";

// The exact bound-field formula shape real Report Builder output writes for a plain column binding -- see this module's own top-of-file note (finding 5).
const FIELD_FORMULA_PREFIX = "field:[";
const FIELD_FORMULA_SUFFIX = "]";

function reportAttr(element: XmlElement, name: string): string | undefined {
  const raw = attrValue(element, name);
  return raw === undefined ? undefined : decodeXmlText(raw);
}

// An ODF boolean attribute -> a real boolean, or undefined when the attribute is absent entirely -- never defaulted, matching how readOdbInventory already treats db:escape-processing/db:as-template.
function parseOptionalBoolean(raw: string | undefined): boolean | undefined {
  return raw === undefined ? undefined : raw === "true";
}

// 'field:[AMOUNT]' -> 'AMOUNT'; anything else (a computed 'rpt:...' expression, or an unrecognised shape) -> undefined, left to stand as formula alone rather than being partially parsed.
function boundFieldName(formula: string | undefined): string | undefined {
  if (
    formula === undefined ||
    !formula.startsWith(FIELD_FORMULA_PREFIX) ||
    !formula.endsWith(FIELD_FORMULA_SUFFIX)
  ) {
    return undefined;
  }
  const inner = formula.slice(
    FIELD_FORMULA_PREFIX.length,
    formula.length - FIELD_FORMULA_SUFFIX.length,
  );
  return inner.length === 0 ? undefined : inner;
}

// All text-node content beneath `element`, entity-decoded -- an rpt:fixed-content's own label lives in a nested text:p, and a label split across several text nodes (or wrapped in a text:span by a styled label) still reads as one string.
function elementText(element: XmlElement): string {
  let text = "";
  for (const child of element.children) {
    if (child.type === "text") {
      text += decodeXmlText(child.value);
    } else if (child.type === "element") {
      text += elementText(child);
    }
  }
  return text;
}

// An rpt:* element is a CONTROL iff it carries an rpt:report-element child -- the structural signal this reader identifies controls by, rather than a closed tag list (see this module's own top-of-file note, finding 4).
function reportElementChild(element: XmlElement): XmlElement | undefined {
  return findChildElement(element.children, REPORT_ELEMENT_TAG);
}

function readReportElement(
  element: XmlElement,
  reportElement: XmlElement,
): OdbReportElement {
  const control: OdbReportElement = { tag: element.tag };
  const component = findChildElement(
    reportElement.children,
    REPORT_COMPONENT_TAG,
  );
  const name =
    component === undefined ? undefined : reportAttr(component, "draw:name");
  if (name !== undefined) {
    control.name = name;
  }

  const formula = reportAttr(element, "rpt:formula");
  if (formula !== undefined) {
    control.formula = formula;
  }

  // A control's own literal text comes from its non-rpt: children only -- rpt:report-element carries no text of its own, and descending into it would be reading the control's metadata as if it were content.
  let text = "";
  for (const child of element.children) {
    if (child.type === "text") {
      text += decodeXmlText(child.value);
    } else if (
      child.type === "element" &&
      !child.tag.startsWith(RPT_TAG_PREFIX)
    ) {
      text += elementText(child);
    }
  }
  if (text.length > 0) {
    control.text = text;
  }

  const dataField = boundFieldName(formula);
  if (dataField !== undefined) {
    control.dataField = dataField;
  }
  return control;
}

// Every control anywhere beneath `node` (a band's own layout table, whose cells and paragraphs are arbitrarily nested -- see this module's own top-of-file note, finding 3), in document order. Recursion stops AT a control rather than descending through it, so a control's own rpt:report-element metadata is never mistaken for a nested control.
function collectControls(
  nodes: readonly XmlNode[],
  controls: OdbReportElement[],
): void {
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag.startsWith(RPT_TAG_PREFIX)) {
      const reportElement = reportElementChild(node);
      if (reportElement !== undefined) {
        controls.push(readReportElement(node, reportElement));
        continue;
      }
    }
    collectControls(node.children, controls);
  }
}

function readBand(
  element: XmlElement,
  kind: OdbReportBand["kind"],
): OdbReportBand {
  const elements: OdbReportElement[] = [];
  collectControls(element.children, elements);
  const band: OdbReportBand = { kind, elements };
  const table = findChildElement(element.children, "table:table");
  const name =
    table === undefined ? undefined : reportAttr(table, "table:name");
  if (name !== undefined) {
    band.name = name;
  }
  return band;
}

function readBandIfPresent(
  container: XmlElement,
  tag: string,
  kind: OdbReportBand["kind"],
): OdbReportBand | undefined {
  const element = findChildElement(container.children, tag);
  return element === undefined ? undefined : readBand(element, kind);
}

function readFunctions(container: XmlElement): OdbReportFunction[] {
  const functions: OdbReportFunction[] = [];
  for (const child of container.children) {
    if (child.type !== "element" || child.tag !== FUNCTION_TAG) {
      continue;
    }
    const name = reportAttr(child, "rpt:name");
    const formula = reportAttr(child, "rpt:formula");
    if (name === undefined || formula === undefined) {
      continue;
    }
    functions.push({ name, formula });
  }
  return functions;
}

function readGroup(element: XmlElement): OdbReportGroup {
  const group: OdbReportGroup = {
    functions: readFunctions(element),
    groups: [],
  };
  const groupExpression = reportAttr(element, "rpt:group-expression");
  if (groupExpression !== undefined) {
    group.groupExpression = groupExpression;
  }
  const sortExpression = reportAttr(element, "rpt:sort-expression");
  if (sortExpression !== undefined) {
    group.sortExpression = sortExpression;
  }
  const sortAscending = parseOptionalBoolean(
    attrValue(element, "rpt:sort-ascending"),
  );
  if (sortAscending !== undefined) {
    group.sortAscending = sortAscending;
  }
  const startNewColumn = parseOptionalBoolean(
    attrValue(element, "rpt:start-new-column"),
  );
  if (startNewColumn !== undefined) {
    group.startNewColumn = startNewColumn;
  }
  const resetPageNumber = parseOptionalBoolean(
    attrValue(element, "rpt:reset-page-number"),
  );
  if (resetPageNumber !== undefined) {
    group.resetPageNumber = resetPageNumber;
  }
  const keepTogether = reportAttr(element, "rpt:keep-together");
  if (keepTogether !== undefined) {
    group.keepTogether = keepTogether;
  }

  const header = readBandIfPresent(element, "rpt:group-header", "group-header");
  if (header !== undefined) {
    group.header = header;
  }
  const footer = readBandIfPresent(element, "rpt:group-footer", "group-footer");
  if (footer !== undefined) {
    group.footer = footer;
  }
  for (const child of element.children) {
    if (child.type === "element" && child.tag === GROUP_TAG) {
      group.groups.push(readGroup(child));
    }
  }
  return group;
}

// The detail band, descending the group chain to reach it -- see this module's own top-of-file note (finding 2). Follows the FIRST rpt:group at each level, matching real output, where a level holds at most one nested group.
function findDetail(container: XmlElement): OdbReportBand | undefined {
  const detail = findChildElement(container.children, "rpt:detail");
  if (detail !== undefined) {
    return readBand(detail, "detail");
  }
  const group = findChildElement(container.children, GROUP_TAG);
  return group === undefined ? undefined : findDetail(group);
}

// Package + a report's own db:reports/db:component name -> OdbReport. Throws when the .odb declares no report by that name, when the sub-document its db:component points at is missing from the package, or when that sub-document's content.xml has no office:body/office:report element -- all three are genuinely unusable references rather than salvageable degradations, matching every other typed reader's own "missing required structural element" throw convention.
export function readOdbReport(pkg: Package, reportName: string): OdbReport {
  const component = resolveOdbComponent(pkg, "report", reportName);
  const subPackage = subDocumentPackage(pkg, component.href);
  const contentPart = subPackage.parts[CONTENT_PART];
  if (contentPart?.kind !== "xml") {
    throw new Error(
      `readOdbReport: report "${reportName}" sub-document ${component.href}/${CONTENT_PART} is not an XML part`,
    );
  }
  const contentRoot = rootElement(contentPart.nodes);
  const body =
    contentRoot === undefined
      ? undefined
      : findChildElement(contentRoot.children, "office:body");
  const reportElement =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:report");
  if (reportElement === undefined) {
    throw new Error(
      `readOdbReport: report "${reportName}" sub-document ${component.href}/${CONTENT_PART} has no office:body/office:report element`,
    );
  }

  const groups: OdbReportGroup[] = [];
  for (const child of reportElement.children) {
    if (child.type === "element" && child.tag === GROUP_TAG) {
      groups.push(readGroup(child));
    }
  }

  const report: OdbReport = {
    name: component.name,
    href: component.href,
    groups,
    functions: readFunctions(reportElement),
  };
  const command = reportAttr(reportElement, "rpt:command");
  if (command !== undefined) {
    report.command = command;
  }
  const commandType = reportAttr(reportElement, "rpt:command-type");
  if (commandType !== undefined) {
    report.commandType = commandType;
  }
  const caption = reportAttr(reportElement, "office:caption");
  if (caption !== undefined) {
    report.caption = caption;
  }
  const mimeType = reportAttr(reportElement, "office:mimetype");
  if (mimeType !== undefined) {
    report.mimeType = mimeType;
  }

  const reportHeader = readBandIfPresent(
    reportElement,
    "rpt:report-header",
    "report-header",
  );
  if (reportHeader !== undefined) {
    report.reportHeader = reportHeader;
  }
  const pageHeader = readBandIfPresent(
    reportElement,
    "rpt:page-header",
    "page-header",
  );
  if (pageHeader !== undefined) {
    report.pageHeader = pageHeader;
  }
  const detail = findDetail(reportElement);
  if (detail !== undefined) {
    report.detail = detail;
  }
  const pageFooter = readBandIfPresent(
    reportElement,
    "rpt:page-footer",
    "page-footer",
  );
  if (pageFooter !== undefined) {
    report.pageFooter = pageFooter;
  }
  const reportFooter = readBandIfPresent(
    reportElement,
    "rpt:report-footer",
    "report-footer",
  );
  if (reportFooter !== undefined) {
    report.reportFooter = reportFooter;
  }
  return report;
}
