import type { OdbReport, OdbReportBand, OdbReportGroup } from "odf.js";
import { RptReportStructureError } from "./errors";
import type {
  RptBandDefinition,
  RptGroupDefinition,
  RptReportDefinition,
} from "./evaluate";

// The one file in src/odb/formula/ that knows odf.js's own report shape, mirroring how src/hsqldb/ and src/firebird/ keep every odf.js Package/XmlElement concern out of their decoders and let src/odb/read.ts do the adapting. It maps odf.js's OdbReport -- what readOdbReport parses out of a .odb's own reports/*/content.xml -- onto the RptReportDefinition src/odb/formula/evaluate.ts runs, so the evaluator itself never imports odf.js and can be exercised against a hand-built definition.
//
// Two things this mapping does deliberately and states rather than doing silently:
//
// 1. GROUPS ARE FLATTENED FROM A NESTED CHAIN TO AN OUTERMOST-FIRST LIST. odf.js models rpt:group as a tree (OdbReportGroup.groups) because that is how the XML nests it, but real Report Builder nests groups strictly -- one child group per level, with the detail band at the bottom -- which is exactly what the evaluator's own level-indexed scoping assumes. A level carrying more than one sibling group is a shape neither this package nor its fixtures have ever seen, and the evaluator has no defined scoping for it, so it throws rather than picking the first sibling and dropping the rest. That flattening is exported as odbReportGroupChain rather than kept private, because a renderer needs the very same chain to map an RptBandInstance's own groupLevel back onto the OdbReportGroup it belongs to -- deriving it twice would let the two orderings drift, and level alignment between them is exactly what a group footer's total being attributed to the right group depends on.
// 2. PAGE HEADERS AND PAGE FOOTERS ARE DROPPED. Which rows land on which page is a layout decision the formula evaluator has no basis for making, so it emits no page bands and RptReportDefinition has nowhere to put them -- see src/odb/formula/evaluate.ts's own top-of-file comment. A page band's formulas are the renderer's to evaluate once it knows page boundaries, through that module's own evaluateRptBandOutsideData. In the real form-and-report.odb fixture both page bands carry only rpt:fixed-content labels and no rpt:formula at all, so nothing evaluable is lost there.

// One entry per element in document order, holding that element's own rpt:formula or undefined when it has none -- positional because real Report Builder names every bound control in a band "Formatted field", so element names cannot key this. Exported because that positional correspondence is load-bearing beyond this file: an RptBandInstance's own values line up with the band's elements by index and nothing else, so a renderer pairing the two back together (or building a definition for a page band, which runRptReport never emits) has to derive it by this exact rule rather than a parallel one.
export function rptBandDefinition(band: OdbReportBand): RptBandDefinition {
  return { formulas: band.elements.map((element) => element.formula) };
}

function bandDefinition(
  band: OdbReportBand | undefined,
): RptBandDefinition | undefined {
  return band === undefined ? undefined : rptBandDefinition(band);
}

// The report's own rpt:group tree flattened to the outermost-first chain both this mapping and a renderer index by level. Structural only: a group declaring no break test is this chain's business to carry, not to reject -- groupDefinition below is what needs an rpt:group-expression, and a renderer walking the same chain for a band's own elements does not.
export function odbReportGroupChain(
  report: OdbReport,
): readonly OdbReportGroup[] {
  const chain: OdbReportGroup[] = [];
  let level: readonly OdbReportGroup[] = report.groups;
  while (level.length > 0) {
    if (level.length > 1) {
      throw new RptReportStructureError(
        `${String(level.length)} sibling groups are declared at one nesting level, but Report Builder nests groups strictly and this engine's scoping is defined only for a chain`,
        report.name,
      );
    }
    const group = level[0];
    if (group === undefined) {
      throw new RptReportStructureError(
        "a group nesting level reported a non-zero length but held no group",
        report.name,
      );
    }
    chain.push(group);
    level = group.groups;
  }
  return chain;
}

function groupDefinition(
  group: OdbReportGroup,
  level: number,
  reportName: string,
): RptGroupDefinition {
  if (group.groupExpression === undefined) {
    throw new RptReportStructureError(
      `the group at nesting level ${String(level)} declares no rpt:group-expression, so there is no break test to evaluate`,
      reportName,
    );
  }
  return {
    groupExpression: group.groupExpression,
    functions: group.functions.map((declaration) => ({
      name: declaration.name,
      formula: declaration.formula,
    })),
    header: bandDefinition(group.header),
    footer: bandDefinition(group.footer),
  };
}

// Maps a report as odf.js read it onto the definition src/odb/formula/evaluate.ts's runRptReport consumes. Structural only: no formula is parsed here, so an unsupported function still surfaces from the run itself rather than from this mapping.
export function rptDefinitionFromReport(
  report: OdbReport,
): RptReportDefinition {
  return {
    functions: report.functions.map((declaration) => ({
      name: declaration.name,
      formula: declaration.formula,
    })),
    reportHeader: bandDefinition(report.reportHeader),
    groups: odbReportGroupChain(report).map((group, level) =>
      groupDefinition(group, level, report.name),
    ),
    detail: bandDefinition(report.detail),
    reportFooter: bandDefinition(report.reportFooter),
  };
}
