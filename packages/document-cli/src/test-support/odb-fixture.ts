import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OdbForm, OdbReport } from 'documents.js';
import { readOdbForms, readOdbReports } from 'documents.js';
import { decodePackage, type Package } from 'odf.js';

// The one real `.odb` fixture this repo checks in, and the only binary fixture in the tree at all -- every other test builds its input through documents.js's own live-view editors (createDocx()/createOds()/...), which is impossible here because documents.js has no `.odb` write direction to build one with. Copied verbatim from `ExaDev/odf.js`'s own `src/typed/odb/fixtures/form-and-report.odb`: a genuine embedded-Firebird `.odb` generated through LibreOffice 26.2's own in-process UNO API and never hand-edited afterwards, carrying a real SALES table, a real saved query (HighValueSales), a real field-bound form (SalesForm, with a nested sub-form), and a real Report Builder report (SalesByRegion, with two nested groups, a user-defined rpt: function, and rpt:SUM aggregate formulas). It is the same file odf.js's own readOdbForm/readOdbReport suites assert against, so this package's own form/report rendering is grounded in exactly the producer output the reader beneath it was built from.
//
// `decodePackage` comes from odf.js, never from documents.js -- documents.js re-exports ooxml.js's own same-named function for OOXML packages, and that one cannot read an ODF `.odb` container at all (see the README's own gotcha).

const FIXTURE_URL = new URL('./fixtures/form-and-report.odb', import.meta.url);

// A real filesystem path, for a test that needs to hand the fixture to a command as a positional `<input>` argument rather than decode it in process.
export const FORM_AND_REPORT_ODB_PATH = fileURLToPath(FIXTURE_URL);

export function loadFormAndReportOdbPackage(): Package {
  return decodePackage(new Uint8Array(readFileSync(FIXTURE_URL)));
}

export function loadFormAndReportOdbForms(): readonly OdbForm[] {
  return readOdbForms(loadFormAndReportOdbPackage());
}

export function loadFormAndReportOdbReports(): readonly OdbReport[] {
  return readOdbReports(loadFormAndReportOdbPackage());
}
