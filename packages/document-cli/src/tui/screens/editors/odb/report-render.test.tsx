import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HsqldbTable } from "documents.js";
import { render } from "ink-testing-library";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  FORM_AND_REPORT_ODB_PATH,
  loadFormAndReportOdbReports,
} from "../../../../test-support/odb-fixture.js";
import { settle, waitForFrame } from "../../../test-support.js";
import { OdbHarness } from "./test-support.js";

// Unlike report-screens.test.tsx (which never touches disk, since browsing structure only ever reads the values seeded into the harness), rendering a report re-reads and re-decodes doc.path for real (render-odb-report.ts's own doc comment explains why an OdbOpenDocument carries no live Package). So this copies the real fixture into a scratch directory rather than pointing the harness at the checked-in fixture path directly -- the default destination the render screen pre-fills sits next to doc.path, and this suite genuinely writes there.
const REPORTS = loadFormAndReportOdbReports();
const SAMPLE_TABLES: readonly HsqldbTable[] = [
  {
    tableName: "SALES",
    columns: [{ name: "CUSTOMER", type: "VARCHAR" }],
    rows: [[{ kind: "string", value: "Ada Lovelace" }]],
  },
];

let workspace: string;
let odbPath: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-report-render-"));
  odbPath = join(workspace, "form-and-report.odb");
  await copyFile(FORM_AND_REPORT_ODB_PATH, odbPath);
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("the report-render flow (odbReportDetail -> odbReportRender)", () => {
  it("renders the report to a real pdf file at a destination path the user types", async () => {
    const { lastFrame, stdin } = render(
      <OdbHarness tables={SAMPLE_TABLES} reports={REPORTS} path={odbPath} />,
    );

    await waitForFrame(lastFrame, (frame) => frame.includes("SALES"));
    await settle();
    stdin.write("r");

    await waitForFrame(lastFrame, (frame) =>
      frame.includes("Reports (1 of 1)"),
    );
    await settle();
    stdin.write("\r");

    await waitForFrame(lastFrame, (frame) =>
      frame.includes("data source: query"),
    );
    await settle();
    // Enter, on the report detail screen, renders this report rather than opening any one line -- see report-detail.tsx's own onSelect.
    stdin.write("\r");

    await waitForFrame(lastFrame, (frame) =>
      frame.includes("Render report: SalesByRegion"),
    );
    await settle();

    // The destination field arrives pre-filled with a real, writable path next to doc.path (defaultReportRenderDestination in report-render.tsx), cursor at its end -- the same "starts filled, cursor at end, typed text appends" convention export-options.test.tsx already exercises for ExportOptionsScreen's own destination field. Typing a suffix that itself ends in .pdf keeps the whole path a valid render target (detectFormat reads the LAST '.' in the final path segment), while genuinely exercising the field's own typing/onChange path rather than accepting the default untouched.
    const typedSuffix = "-typed.pdf";
    const destination = join(
      dirname(odbPath),
      `SalesByRegion.pdf${typedSuffix}`,
    );
    stdin.write(typedSuffix);
    await settle();

    // Enter #1 moves focus from the destination field to the fonts field.
    stdin.write("\r");
    await waitForFrame(lastFrame, (frame) => frame.includes("Enter to render"));
    await settle();

    // Enter #2, with the fonts field left empty, submits the render.
    stdin.write("\r");

    // Success pops back to the report detail screen this flow started from.
    await waitForFrame(lastFrame, (frame) =>
      frame.includes("data source: query"),
    );

    const written = await readFile(destination);
    expect(new TextDecoder("latin1").decode(written.subarray(0, 5))).toBe(
      "%PDF-",
    );
  });
});
