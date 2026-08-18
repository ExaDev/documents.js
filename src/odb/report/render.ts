import type { ContentBlock, ContentCellValue, ContentDocument, ContentParagraph, ContentSection, ContentTable } from 'document-schema.js';

import type { OdbReport, OdbReportBand, OdbReportElement, OdbReportGroup } from 'odf.js';
import { displayTextFor } from '../../hsqldb/script';
import { PAGE_SIZE_A4 } from 'document-schema.js';
import { odbReportGroupChain, rptBandDefinition, rptDefinitionFromReport } from '../formula/definition';
import type { RptBandInstance, RptBandKind, RptReportDefinition } from '../formula/evaluate';
import { evaluateRptBandOutsideData, runRptReport } from '../formula/evaluate';
import type { SqlResultSet } from '../sql/evaluate';

// Renders a real Report Builder report over real rows into a ContentDocument. src/odb/formula/ already decides WHAT prints -- which bands, in which order, with which values, against which group instances -- so this module makes exactly one kind of decision that engine deliberately refuses to: what a printed band looks like as document content.
//
// THE BAND-TO-CONTENT MAPPING: ONE TABLE PER BAND INSTANCE, ONE ROW, ONE CELL PER BAND ELEMENT.
//
// A band in the source file genuinely IS a table. odf.js's own report reader states it as its finding 3: every rpt:report-header/rpt:group-header/rpt:detail/... element wraps a table:table whose cells hold that band's controls. So a band instance -- one printing of that band -- maps onto one ContentTable with a single row, holding one cell per control in document order. That is a structural 1:1 with what the report file actually says, and it is also what the printed report looks like: a band's controls sit side by side across the page, and the same band printed repeatedly (the detail band, once per row) stacks those cells into visually aligned columns under the page header's own labels.
//
// The alternative shape -- a paragraph per field -- was rejected rather than merely not chosen: it would stack a detail row's Customer and Amount vertically, one under the other, destroying the single relationship a banded report's layout grid exists to express, which is which control sits in which column. A report whose every field became its own paragraph would read as a flat list of values with no way to tell a row from a column, which is not an approximation of Report Builder output but a different document.
//
// Merging consecutive detail instances into one multi-row table was considered and rejected too. It would render this package's own fixture identically, but only because its detail rows happen to be consecutive: a group header or footer between two detail bands breaks the run, so the merged shape is really "one table per uninterrupted run of detail rows", a structure that depends on the data rather than on the report, and a worse match for the file's own one-table-per-band model. Column alignment down the page -- the real attraction of merging -- comes for free without it, since every instance of one band has the same cell count and therefore the same column widths.
//
// WHAT THIS RENDERER DOES NOT INVENT. A band control's own font, alignment, and number format live in that control's style, which odf.js's report reader deliberately does not read (finding 3 again: a control's grid position and presentation are not structure). So nothing here sets a font, an alignment, or a border, and a numeric value renders as its own plain display text -- 1200.5, not the 1,200.50 the report's own format might produce -- rather than through a number format this package would have to invent. Column widths are the one measurement a ContentTable cannot omit: they divide the section's own content width equally between the band's cells, which is a stated fallback rather than a recovered value. What the bands DO carry is their identity, as the paragraph style on every cell ("Report Header", "Group Footer 1", "Detail", ...), so which band a block came from survives into the document instead of having to be inferred from its position.
//
// A SINGLE LOGICAL PAGE. This renderer has no pagination engine, so it declares one section and one logical page rather than guessing where pages break. That is what makes the page header and page footer renderable at all: they print once each, bracketing the body, and their own formulas evaluate at report scope -- which for a single page is not an approximation but exactly the right scope (see evaluateRptBandOutsideData, which states the condition it depends on). The report header prints ABOVE the page header, matching the banded-report convention Report Builder inherits, where a report's own title sits above the column labels that then repeat on every page; in this fixture that is the difference between "Sales by region" heading its own column labels and sitting underneath them.

const MARGIN_PT = 56.69291338582677; // 2cm, the same page-margin fallback src/odb/spreadsheet.ts uses for a document built from database content that carries no page layout of its own.
const CONTENT_WIDTH_PT = PAGE_SIZE_A4.widthPt - 2 * MARGIN_PT;

// The paragraph style each band's cells carry, naming the band the content printed from.
const REPORT_HEADER_STYLE = 'Report Header';
const PAGE_HEADER_STYLE = 'Page Header';
const DETAIL_STYLE = 'Detail';
const PAGE_FOOTER_STYLE = 'Page Footer';
const REPORT_FOOTER_STYLE = 'Report Footer';

// Group levels are numbered from 1 at the outermost, which is how a report's own designer counts them; RptBandInstance.groupLevel is 0-based, being an array index into the group chain.
function groupBandStyle(kind: 'group-header' | 'group-footer', level: number): string {
  return `${kind === 'group-header' ? 'Group Header' : 'Group Footer'} ${String(level + 1)}`;
}

// One printed band, paired back with the controls it printed: RptBandInstance carries only positional values, since the formula engine has no use for a label's own text or a control's tag.
interface PrintedBand {
  readonly styleId: string;
  readonly elements: readonly OdbReportElement[];
  readonly values: readonly (ContentCellValue | undefined)[];
}

function printedBand(band: OdbReportBand | undefined, styleId: string, values: readonly (ContentCellValue | undefined)[]): PrintedBand {
  if (band === undefined) {
    // Not reachable: runRptReport emits an instance only for a band the definition carries, and the definition carries exactly the bands odf.js read off this same report. An internal invariant violation, not anything a report could express.
    throw new Error(`rpt report render: a "${styleId}" band instance was emitted for a band this report does not declare`);
  }
  return { styleId, elements: band.elements, values };
}

// The band an instance printed, out of the report as odf.js read it. Group bands index the same outermost-first chain rptDefinitionFromReport built the definition from, which is what keeps a footer's own level and its own controls in step.
function bandOfInstance(report: OdbReport, groups: readonly OdbReportGroup[], instance: RptBandInstance): PrintedBand {
  switch (instance.kind) {
    case 'report-header':
      return printedBand(report.reportHeader, REPORT_HEADER_STYLE, instance.values);
    case 'detail':
      return printedBand(report.detail, DETAIL_STYLE, instance.values);
    case 'report-footer':
      return printedBand(report.reportFooter, REPORT_FOOTER_STYLE, instance.values);
    case 'group-header':
    case 'group-footer': {
      const level = instance.groupLevel;
      if (level === undefined) {
        throw new Error(`rpt report render: a ${instance.kind} band instance carries no group level`);
      }
      const group = groups[level];
      if (group === undefined) {
        throw new Error(`rpt report render: a ${instance.kind} band instance names group level ${String(level)}, which this report's own chain of ${String(groups.length)} group(s) does not reach`);
      }
      return printedBand(instance.kind === 'group-header' ? group.header : group.footer, groupBandStyle(instance.kind, level), instance.values);
    }
  }
}

// A control's own printed text: its evaluated formula when it has one, otherwise the literal label it carries, otherwise nothing at all. A control carrying both prints the computed value -- the formula is what such a control is for, and text alongside it is markup left over from whatever the control was built from.
function elementText(element: OdbReportElement, value: ContentCellValue | undefined): string {
  if (element.formula === undefined) {
    return element.text ?? '';
  }
  if (value === undefined) {
    throw new Error(`rpt report render: control "${element.formula}" carries a formula but the run produced no value for it`);
  }
  return displayTextFor(value);
}

function cellParagraph(element: OdbReportElement, value: ContentCellValue | undefined, styleId: string): ContentParagraph {
  const text = elementText(element, value);
  // A run of no text is not the same document node as a cell holding nothing: a control that printed nothing -- an empty label, a NULL-valued field -- gets a paragraph with no runs at all.
  return { kind: 'paragraph', styleId, runs: text === '' ? [] : [{ text }] };
}

function bandTable(band: PrintedBand): ContentTable | undefined {
  if (band.elements.length === 0) {
    // A real band declaring no controls at all -- form-and-report.odb's own page footer is exactly this -- prints nothing. A zero-column table is not a document node worth emitting, so such a band contributes no block.
    return undefined;
  }
  if (band.values.length !== band.elements.length) {
    throw new Error(`rpt report render: the "${band.styleId}" band printed ${String(band.values.length)} values for ${String(band.elements.length)} control(s)`);
  }
  const columnWidthPt = CONTENT_WIDTH_PT / band.elements.length;
  return {
    kind: 'table',
    columnWidthsPt: band.elements.map(() => columnWidthPt),
    rows: [{ cells: band.elements.map((element, index) => ({ blocks: [cellParagraph(element, band.values[index], band.styleId)] })) }],
  };
}

function bandBlocks(bands: readonly PrintedBand[]): readonly ContentBlock[] {
  return bands.flatMap((band) => {
    const table = bandTable(band);
    return table === undefined ? [] : [table];
  });
}

// A page band, evaluated by this renderer rather than by the run: src/odb/formula/ models no pages at all, and this renderer's own single logical page is what gives such a band a scope to evaluate in.
function pageBands(definition: RptReportDefinition, band: OdbReportBand | undefined, styleId: string, resultSet: SqlResultSet): readonly PrintedBand[] {
  if (band === undefined) {
    return [];
  }
  return [{ styleId, elements: band.elements, values: evaluateRptBandOutsideData(definition, rptBandDefinition(band), resultSet) }];
}

// A report as odf.js read it, plus the rows it renders over, as one wordprocessing ContentDocument. Kept separate from readOdbReportContent (src/odb/report/content.ts) so a caller holding rows from somewhere other than the report's own rpt:command -- the same report over the unfiltered table, say -- renders them through the identical path.
export function renderOdbReportContent(report: OdbReport, resultSet: SqlResultSet): ContentDocument {
  const definition = rptDefinitionFromReport(report);
  const groups = odbReportGroupChain(report);
  const instances = runRptReport(definition, resultSet).bands;

  // runRptReport emits the report header first and the report footer last, if at all, so partitioning by band kind preserves print order within each part while opening the two places the run itself never fills: the page bands, which that engine deliberately never emits, bracket the body between them.
  const printed = (matches: (kind: RptBandKind) => boolean): readonly PrintedBand[] => instances.filter((instance) => matches(instance.kind)).map((instance) => bandOfInstance(report, groups, instance));

  const section: ContentSection = {
    pageSize: PAGE_SIZE_A4,
    margins: { topPt: MARGIN_PT, rightPt: MARGIN_PT, bottomPt: MARGIN_PT, leftPt: MARGIN_PT },
    blocks: [
      ...bandBlocks(printed((kind) => kind === 'report-header')),
      ...bandBlocks(pageBands(definition, report.pageHeader, PAGE_HEADER_STYLE, resultSet)),
      ...bandBlocks(printed((kind) => kind !== 'report-header' && kind !== 'report-footer')),
      ...bandBlocks(pageBands(definition, report.pageFooter, PAGE_FOOTER_STYLE, resultSet)),
      ...bandBlocks(printed((kind) => kind === 'report-footer')),
    ],
  };

  return {
    kind: 'wordprocessing',
    // office:caption is the report's own user-visible title; its db:component name is the identifier the .odb files it under, and stands in when the report carries no caption.
    metadata: { title: report.caption ?? report.name },
    sections: [section],
  };
}
