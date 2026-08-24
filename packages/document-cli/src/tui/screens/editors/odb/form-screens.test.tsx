import type { HsqldbTable } from "documents.js";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { loadFormAndReportOdbForms } from "../../../../test-support/odb-fixture.js";
import { settle, waitForFrame } from "../../../test-support.js";
import { OdbHarness } from "./test-support.js";

// Driven by the real `.odb` fixture (see test-support/odb-fixture.ts for its provenance) rather than a hand-built OdbForm: these screens render whatever `readOdbForms` produces, so asserting against genuine LibreOffice output is what proves the rendering matches the reader's actual shape -- most of all the sub-form, which sits on a different command from its parent.
const FORMS = loadFormAndReportOdbForms();

const SAMPLE_TABLES: readonly HsqldbTable[] = [
  {
    tableName: "SALES",
    columns: [{ name: "CUSTOMER", type: "VARCHAR" }],
    rows: [[{ kind: "string", value: "Ada Lovelace" }]],
  },
];

describe("OdbFormListScreen and OdbFormDetailScreen", () => {
  it("reaches the form list from the table list with 'f', showing the form's own control counts", async () => {
    const { lastFrame, stdin } = render(
      <OdbHarness tables={SAMPLE_TABLES} forms={FORMS} />,
    );
    const tableFrame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("SALES"),
    );
    expect(tableFrame).toContain("f for forms (1)");
    await settle();

    stdin.write("f");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Forms (1 of 1)"),
    );
    expect(frame).toContain(
      "SalesForm [forms/Obj11] -- 1 form, 6 controls (5 bound)",
    );
  });

  it("opens a form's own control tree on Enter, with every field binding and the sub-form's own query command", async () => {
    const { lastFrame, stdin } = render(
      <OdbHarness tables={SAMPLE_TABLES} forms={FORMS} />,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("SALES"));
    await settle();
    stdin.write("f");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Forms (1 of 1)"),
    );
    await settle();

    stdin.write("\r");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("form SalesForm"),
    );
    expect(frame).toContain("forms/Obj11");
    expect(frame).toContain('form SalesForm on table "SALES"');
    expect(frame).toContain("form:text txtCustomer -> CUSTOMER");
    expect(frame).toContain(
      'subform HighValueSubForm on query "HighValueSales"',
    );
    expect(frame).toContain("form:text txtSubCustomer -> CUSTOMER");
  });

  it("goes back from the form list to the table list on Esc", async () => {
    const { lastFrame, stdin } = render(
      <OdbHarness tables={SAMPLE_TABLES} forms={FORMS} />,
    );
    await waitForFrame(lastFrame, (candidate) => candidate.includes("SALES"));
    await settle();
    stdin.write("f");
    await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Forms (1 of 1)"),
    );
    await settle();

    stdin.write("h");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Tables (1 of 1)"),
    );
    expect(frame).toContain("SALES (1 columns, 1 rows)");
  });

  it("says so plainly when the database declares no forms at all", async () => {
    const { lastFrame, stdin } = render(<OdbHarness tables={SAMPLE_TABLES} />);
    await waitForFrame(lastFrame, (candidate) => candidate.includes("SALES"));
    await settle();

    stdin.write("f");

    const frame = await waitForFrame(lastFrame, (candidate) =>
      candidate.includes("Forms (0 of 0)"),
    );
    expect(frame).toContain("This database declares no forms.");
  });
});
