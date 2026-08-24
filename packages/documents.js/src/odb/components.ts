import type { OdbForm, OdbReport, Package } from "odf.js";
import { readOdbForm, readOdbInventory, readOdbReport } from "odf.js";

// odf.js 2.0.0's own OdbInventory.forms/.reports carry every declared form/report's own name and href (OdbComponentInfo[], a breaking change from 1.x's plain string[]), and readOdbForm/readOdbReport (also new in 2.0.0) resolve one named component into its real static structure -- a form's own field-bound controls (readOdtContent's own document plus form:form/form:control-implementation definitions) or a report's own band/group/function layout (rpt:report-header/rpt:group/rpt:detail/etc, parsed directly from the report sub-document's XML). Neither is wired through readOdbTables (that function is scoped to table DATA, not form/report STRUCTURE), so readOdbForms/readOdbReports below are the "read every declared one at once" convenience this package's own readOdbTables already models for tables -- calling readOdbForm/readOdbReport once per name discovered via readOdbInventory, in declaration order. A caller wanting exactly one named form/report can still call odf.js's own readOdbForm/readOdbReport directly (both re-exported unmodified from this package's own public surface), the same "each pipeline stage independently usable" convention documented for readOdbTables/decodeHsqldbCachedTables/readFirebirdBackup.

export function readOdbForms(pkg: Package): readonly OdbForm[] {
  const inventory = readOdbInventory(pkg);
  return inventory.forms.map((component) => readOdbForm(pkg, component.name));
}

export function readOdbReports(pkg: Package): readonly OdbReport[] {
  const inventory = readOdbInventory(pkg);
  return inventory.reports.map((component) =>
    readOdbReport(pkg, component.name),
  );
}
