import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OdbForm, OdbReport, Package } from 'documents.js';
import { decodeOdbPackage, readOdbForms, readOdbReports } from 'documents.js';

// The one real `.odb` fixture this repo checks in, and the only binary fixture in the tree at all -- every other test builds its input through documents.js's own live-view editors (createDocx()/createOds()/...), which is impossible here because documents.js has no `.odb` write direction to build one with. Copied verbatim from `ExaDev/odf.js`'s own `src/typed/odb/fixtures/form-and-report.odb`: a genuine embedded-Firebird `.odb` generated through LibreOffice 26.2's own in-process UNO API and never hand-edited afterwards, carrying a real SALES table, a real saved query (HighValueSales), a real field-bound form (SalesForm, with a nested sub-form), and a real Report Builder report (SalesByRegion, with two nested groups, a user-defined rpt: function, and rpt:SUM aggregate formulas). It is the same file odf.js's own readOdbForm/readOdbReport suites assert against, so this package's own form/report rendering is grounded in exactly the producer output the reader beneath it was built from.
//
// `decodeOdbPackage` comes from documents.js, not odf.js -- documents.js's own `decodeDocumentPackage(format, bytes)` dispatches to odf.js internally, but only for a real `DocumentFormat` member (odt/odp/ods/odg/odf); `.odb` is deliberately not one of those (see the README's own gotcha), so `decodeOdbPackage` is the .odb-specific sibling that decodes the identical raw ODF container without this fixture reaching past documents.js's own package-codec surface.

const FIXTURE_URL = new URL('./fixtures/form-and-report.odb', import.meta.url);

// A real filesystem path, for a test that needs to hand the fixture to a command as a positional `<input>` argument rather than decode it in process.
export const FORM_AND_REPORT_ODB_PATH = fileURLToPath(FIXTURE_URL);

export function loadFormAndReportOdbPackage(): Package {
  return decodeOdbPackage(new Uint8Array(readFileSync(FIXTURE_URL)));
}

export function loadFormAndReportOdbForms(): readonly OdbForm[] {
  return readOdbForms(loadFormAndReportOdbPackage());
}

export function loadFormAndReportOdbReports(): readonly OdbReport[] {
  return readOdbReports(loadFormAndReportOdbPackage());
}
