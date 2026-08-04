import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The one real `.odb` fixture this repo checks in -- copied verbatim from document-cli's own src/test-support/fixtures/form-and-report.odb (itself copied from `ExaDev/odf.js`'s own src/typed/odb/fixtures/form-and-report.odb), a genuine embedded-Firebird `.odb` generated through LibreOffice 26.2's own in-process UNO API and never hand-edited afterwards. It carries a real SALES table, a real saved query (HighValueSales), a real field-bound form (SalesForm), and a real Report Builder report (SalesByRegion, with two nested groups, a user-defined rpt: function, and rpt:SUM aggregate formulas) -- the one report odb_render_report has to work with, so every test below renders it either by name or by relying on selectReport's own "exactly one declared report" auto-selection.
const FIXTURE_URL = new URL('./fixtures/form-and-report.odb', import.meta.url);

// A real filesystem path, for a test that wants to hand the fixture to odb_render_report as a `{ path }` source rather than inline base64 bytes.
export const FORM_AND_REPORT_ODB_PATH = fileURLToPath(FIXTURE_URL);

// The name of the fixture's single declared report -- see documents.js's own src/odb/report/content.ts (selectReport): omitting `report` entirely renders this same report automatically, since it is the only one declared.
export const FORM_AND_REPORT_REPORT_NAME = 'SalesByRegion';

export function loadFormAndReportOdbBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(FIXTURE_URL));
}
