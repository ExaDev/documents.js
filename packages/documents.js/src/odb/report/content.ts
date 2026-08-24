import type { ContentDocument } from "document-schema.js";
import type { OdbReport, Package } from "odf.js";
import { readOdbInventory, readOdbReport } from "odf.js";
import type { HsqldbDecodeOptions } from "../../hsqldb/rowformat";
import { renderOdbReportContent } from "./render";
import { resolveOdbReportRows } from "./source";

// The whole .odb report pipeline in one call: a package in, the report it declares rendered over its own real data out. It composes stages that each remain independently usable, matching how readOdbTables/decodeHsqldbCachedTables/readFirebirdBackup already sit beside each other -- readOdbReport (odf.js: the report's static band/group structure), resolveOdbReportRows (src/odb/report/source.ts: rpt:command/rpt:command-type -> real rows, via readOdbTables and the src/odb/sql/ engine), and renderOdbReportContent (src/odb/report/render.ts: the report plus those rows -> a wordprocessing ContentDocument, through src/odb/formula/'s band and group evaluation).
//
// Named for the read<Format>Content convention every other reader in this package follows (readOdtContent, readOdsContent, readDocxContent, ...): a package in, a ContentDocument out, with the format's own structure resolved on the way. There is no reverse direction and never will be -- a ContentDocument holds a report's OUTPUT, not the report, and reconstructing a band/group/formula design from rendered output is a categorically different problem from the geometry reconstruction this package does elsewhere.

// A .odb whose report cannot be chosen without being named: it declares none at all, or declares more than one and the caller named none. Mirrors src/odb/csv.ts's own OdbTableNotSpecifiedError, for the same reason -- picking one of several silently would render a report the caller never asked for.
export class OdbReportNotSpecifiedError extends Error {
  readonly availableReports: readonly string[];

  constructor(availableReports: readonly string[]) {
    super(
      availableReports.length === 0
        ? "readOdbReportContent: this .odb declares no reports at all"
        : `readOdbReportContent: this .odb declares more than one report (${availableReports.join(", ")}) -- pass { report: '<name>' } to select one`,
    );
    this.name = "OdbReportNotSpecifiedError";
    this.availableReports = availableReports;
  }
}

export interface OdbReportContentOptions extends HsqldbDecodeOptions {
  // Selects which report to render. Required whenever the .odb declares more than one, since omitting it then throws OdbReportNotSpecifiedError naming every available report rather than guessing. May be omitted when the .odb declares exactly one. A name matching no declared report throws from odf.js's own readOdbReport.
  readonly report?: string;
}

function selectReport(pkg: Package, reportName: string | undefined): OdbReport {
  if (reportName !== undefined) {
    return readOdbReport(pkg, reportName);
  }
  const declared = readOdbInventory(pkg).reports;
  const only = declared.length === 1 ? declared[0] : undefined;
  if (only === undefined) {
    throw new OdbReportNotSpecifiedError(
      declared.map((component) => component.name),
    );
  }
  return readOdbReport(pkg, only.name);
}

export function readOdbReportContent(
  pkg: Package,
  options?: OdbReportContentOptions,
): ContentDocument {
  const report = selectReport(pkg, options?.report);
  return renderOdbReportContent(
    report,
    resolveOdbReportRows(pkg, report, options),
  );
}
