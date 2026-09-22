import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDocx, openOdt } from "documents.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createProgram } from "../program";
import {
  EXIT_INPUT_ERROR,
  EXIT_SUCCESS,
  EXIT_USAGE_ERROR,
} from "../runtime/exit-codes";
import { FORM_AND_REPORT_ODB_PATH } from "../test-support/odb-fixture";

// A DocxTable/OdtTable structural shape, not either concrete class — both expose the identical rows()/cells()/cell.text surface (see documents.js's own README, "src/edit/" architecture entry: OdpShape and friends reuse OdtParagraph/OdtTable wholesale), so one helper reads a rendered report's own printed-band content back out of either format.
interface CellTextTable {
  rows(): readonly { cells(): readonly { readonly text: string }[] }[];
}

function allTableCellText(tables: readonly CellTextTable[]): string[] {
  return tables.flatMap((table) =>
    table.rows().flatMap((row) => row.cells().map((cell) => cell.text)),
  );
}

// Drives the real assembled commander program against the real `.odb` fixture (see test-support/odb-fixture.ts), not the formatting functions in isolation — that half is covered by src/odb-structure.test.ts. What this file proves is the wiring: that `odb-forms`/`odb-reports` are registered under those names, that each reads and decodes a genuine .odb through odf.js's decodePackage rather than documents.js's OOXML same-named function, that the structure reaches stdout, and that `--json` emits parseable JSON of the same structure. `createProgram()` never parses argv or exits by itself (see program.ts), so calling `parseAsync` here is the whole command path minus the bin's own process wiring.

// Commander's action sets `process.exitCode` on the real process; a command that failed would otherwise leave a non-zero code behind and fail the whole vitest run for reasons unrelated to any assertion here.
let savedExitCode: typeof process.exitCode;

interface CapturedRun {
  readonly exitCode: typeof process.exitCode;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCli(args: readonly string[]): Promise<CapturedRun> {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk) => {
      stdoutChunks.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    });
  const stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation((chunk) => {
      stderrChunks.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    });
  try {
    await createProgram().parseAsync(["node", "document-cli", ...args]);
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  return {
    exitCode: process.exitCode,
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
  };
}

beforeEach(() => {
  savedExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  // Every real runOdb* call registers its own SIGINT listener via createRuntimeSignal and never removes it — harmless for a real one-shot CLI process, but this file alone now drives enough real invocations in one vitest worker to cross Node's default MaxListeners (10) and print a warning straight to the captured stderr some of the tests above assert is empty (the same fix outline.test.ts already applies for the identical reason).
  process.removeAllListeners("SIGINT");
});

describe("odb-to-xlsx", () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-cli-odb-to-xlsx-"));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("extracts the fixture's own SALES table into one xlsx workbook sheet, at the default output path when neither a positional output nor --out is given", async () => {
    const input = join(workspace, "default-name.odb");
    await writeFile(input, await readFile(FORM_AND_REPORT_ODB_PATH));
    const { exitCode, stderr } = await runCli(["odb-to-xlsx", input]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toContain("wrote");
    const output = join(workspace, "default-name.xlsx");
    const bytes = await readFile(output);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("writes to an explicit positional output path", async () => {
    const output = join(workspace, "explicit.xlsx");
    const { exitCode } = await runCli([
      "odb-to-xlsx",
      FORM_AND_REPORT_ODB_PATH,
      output,
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const bytes = await readFile(output);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("writes to the path named by --out when no positional output is given", async () => {
    const output = join(workspace, "via-out-flag.xlsx");
    const { exitCode } = await runCli([
      "odb-to-xlsx",
      FORM_AND_REPORT_ODB_PATH,
      "--out",
      output,
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const bytes = await readFile(output);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("succeeds when the positional output and --out agree", async () => {
    const output = join(workspace, "agreeing.xlsx");
    const { exitCode, stderr } = await runCli([
      "odb-to-xlsx",
      FORM_AND_REPORT_ODB_PATH,
      output,
      "--out",
      output,
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).not.toContain("conflicting output destinations");
  });

  it("fails with a usage error when the positional output and --out disagree", async () => {
    const { exitCode, stderr } = await runCli([
      "odb-to-xlsx",
      FORM_AND_REPORT_ODB_PATH,
      join(workspace, "one.xlsx"),
      "--out",
      join(workspace, "other.xlsx"),
    ]);

    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("conflicting output destinations");
    expect(stderr).toContain("one.xlsx");
    expect(stderr).toContain("other.xlsx");
  });
});

describe("odb-to-csv", () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-cli-odb-to-csv-"));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("exports the fixture's own sole table to CSV at the default output path derived from the input's own name", async () => {
    const input = join(workspace, "sales.odb");
    await writeFile(input, await readFile(FORM_AND_REPORT_ODB_PATH));
    const { exitCode, stderr } = await runCli(["odb-to-csv", input]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).toContain("wrote");
    const csv = await readFile(join(workspace, "sales.csv"), "utf8");
    expect(csv).toContain("Acme Ltd");
  });

  it("writes to an explicit positional output path", async () => {
    const output = join(workspace, "explicit.csv");
    const { exitCode } = await runCli([
      "odb-to-csv",
      FORM_AND_REPORT_ODB_PATH,
      output,
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const csv = await readFile(output, "utf8");
    expect(csv).toContain("Acme Ltd");
  });

  it("writes to the path named by --out when no positional output is given", async () => {
    const output = join(workspace, "via-out-flag.csv");
    const { exitCode } = await runCli([
      "odb-to-csv",
      FORM_AND_REPORT_ODB_PATH,
      "--out",
      output,
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const csv = await readFile(output, "utf8");
    expect(csv).toContain("Acme Ltd");
  });

  it("succeeds when the positional output and --out agree", async () => {
    const output = join(workspace, "agreeing.csv");
    const { exitCode, stderr } = await runCli([
      "odb-to-csv",
      FORM_AND_REPORT_ODB_PATH,
      output,
      "--out",
      output,
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stderr).not.toContain("conflicting output destinations");
  });

  it("fails with a usage error when the positional output and --out disagree", async () => {
    const { exitCode, stderr } = await runCli([
      "odb-to-csv",
      FORM_AND_REPORT_ODB_PATH,
      join(workspace, "one.csv"),
      "--out",
      join(workspace, "other.csv"),
    ]);

    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("conflicting output destinations");
  });

  it("exports the table named by --table", async () => {
    const output = join(workspace, "by-name.csv");
    const { exitCode } = await runCli([
      "odb-to-csv",
      FORM_AND_REPORT_ODB_PATH,
      output,
      "--table",
      "SALES",
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const csv = await readFile(output, "utf8");
    expect(csv).toContain("Acme Ltd");
  });

  it("fails naming the available tables when --table names one the .odb does not declare", async () => {
    const { exitCode, stderr } = await runCli([
      "odb-to-csv",
      FORM_AND_REPORT_ODB_PATH,
      join(workspace, "never-written.csv"),
      "--table",
      "NO_SUCH_TABLE",
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("NO_SUCH_TABLE");
    expect(stderr).toContain(
      "run 'odb-tables' first to see the available tables",
    );
  });
});

describe("odb-tables", () => {
  it("prints the fixture's own table name, column names/types, and row count as a human-readable report", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      "odb-tables",
      FORM_AND_REPORT_ODB_PATH,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain("SALES (6 rows)");
    expect(stdout).toContain("AMOUNT:");
    expect(stdout).toContain("CUSTOMER:");
  });

  it("emits the same structure as parseable JSON under --json", async () => {
    const { exitCode, stdout } = await runCli([
      "odb-tables",
      FORM_AND_REPORT_ODB_PATH,
      "--json",
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(stdout).toContain('"tableName":"SALES"');
    expect(stdout).toContain('"rowCount":6');
  });
});

describe("odb-forms", () => {
  it("prints the fixture's own form, its table command, and every bound control", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      "odb-forms",
      FORM_AND_REPORT_ODB_PATH,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain(
      "SalesForm [forms/Obj11] — 1 form, 6 controls (5 bound)",
    );
    expect(stdout).toContain('form SalesForm on table "SALES"');
    expect(stdout).toContain("form:text txtCustomer -> CUSTOMER");
    expect(stdout).toContain("form:listbox lstQuarter -> QUARTER");
    // The sub-form sits on a saved query rather than on its parent's table — the one structural fact a form reader is most likely to flatten away.
    expect(stdout).toContain(
      'subform HighValueSubForm on query "HighValueSales"',
    );
    expect(stdout).toContain("form:text txtSubCustomer -> CUSTOMER");
  });

  it("emits the same structure as parseable JSON under --json", async () => {
    const { exitCode, stdout } = await runCli([
      "odb-forms",
      FORM_AND_REPORT_ODB_PATH,
      "--json",
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    // Asserted against the serialised text rather than by narrowing the parsed `unknown` field by field: this test's subject is the command's stdout, and JSON.parse succeeding above already proves the payload is well-formed JSON.
    expect(stdout).toContain('"name":"SalesForm"');
    expect(stdout).toContain('"href":"forms/Obj11"');
    expect(stdout).toContain('"dataField":"AMOUNT"');
    expect(stdout).toContain('"command":"HighValueSales"');
  });
});

describe("odb-reports", () => {
  it("prints the fixture's own report, its data-source command, band structure, and rpt: formulas", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      "odb-reports",
      FORM_AND_REPORT_ODB_PATH,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain(
      'SalesByRegion [reports/Obj11] — on query "HighValueSales", 2 groups, 13 elements',
    );
    expect(stdout).toContain('data source: query "HighValueSales"');
    expect(stdout).toContain('report-header "Report Header"');
    expect(stdout).toContain('page-header "Page Header"');
    expect(stdout).toContain('detail "Detail"');
    expect(stdout).toContain('report-footer "Report Footer"');
    // A group key is an expression, not a bare column name, and the inner group is keyed on the report's own user-defined function.
    expect(stdout).toContain(
      'group rpt:HASCHANGED("REGION") (sort REGION ascending)',
    );
    expect(stdout).toContain('group rpt:HASCHANGED("LEFT_QUARTER")');
    expect(stdout).toContain(
      'rpt:formatted-text "Formatted field" = rpt:SUM([AMOUNT])',
    );
    expect(stdout).toContain("LEFT_QUARTER = rpt:LEFT([QUARTER];2)");
  });

  it("emits the report verbatim as parseable JSON under --json", async () => {
    const { exitCode, stdout } = await runCli([
      "odb-reports",
      FORM_AND_REPORT_ODB_PATH,
      "--json",
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(stdout).toContain('"name":"SalesByRegion"');
    expect(stdout).toContain('"commandType":"query"');
    expect(stdout).toContain('"formula":"rpt:SUM([AMOUNT])"');
    expect(stdout).toContain('"kind":"detail"');
  });
});

describe("odb-query", () => {
  it("runs an inline --sql SELECT over the extracted tables and prints an aligned plain-text table", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      "odb-query",
      FORM_AND_REPORT_ODB_PATH,
      "--sql",
      "SELECT ID, CUSTOMER, AMOUNT FROM SALES WHERE REGION = 'North' ORDER BY AMOUNT DESC",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain("ID");
    expect(stdout).toContain("CUSTOMER");
    expect(stdout).toContain("AMOUNT");
    expect(stdout).toContain("Crown Foods");
    expect(stdout).toContain("2750.25");
    expect(stdout).toContain("Acme Ltd");
    expect(stdout).toContain("Bolt Supplies");
    expect(stdout).toContain("3 rows");
  });

  it("emits the bare { columns, rows } SqlResultSet as parseable JSON under --json", async () => {
    const { exitCode, stdout } = await runCli([
      "odb-query",
      FORM_AND_REPORT_ODB_PATH,
      "--sql",
      "SELECT ID, CUSTOMER, AMOUNT FROM SALES WHERE REGION = 'North' ORDER BY AMOUNT DESC",
      "--json",
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toEqual({
      columns: ["ID", "CUSTOMER", "AMOUNT"],
      rows: [
        [
          { kind: "number", value: 3 },
          { kind: "string", value: "Crown Foods" },
          { kind: "number", value: 2750.25 },
        ],
        [
          { kind: "number", value: 1 },
          { kind: "string", value: "Acme Ltd" },
          { kind: "number", value: 1200.5 },
        ],
        [
          { kind: "number", value: 2 },
          { kind: "string", value: "Bolt Supplies" },
          { kind: "number", value: 340 },
        ],
      ],
    });
  });

  it("runs one of the .odb's own saved queries by name via --query", async () => {
    const { exitCode, stdout } = await runCli([
      "odb-query",
      FORM_AND_REPORT_ODB_PATH,
      "--query",
      "HighValueSales",
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain("Everest Tools");
    expect(stdout).toContain("4 rows");
  });

  it("fails with a usage error when both --sql and --query are given", async () => {
    const { exitCode, stderr } = await runCli([
      "odb-query",
      FORM_AND_REPORT_ODB_PATH,
      "--sql",
      "SELECT ID FROM SALES",
      "--query",
      "HighValueSales",
    ]);

    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("pass --sql or --query, not both");
  });

  it("fails with a usage error when neither --sql nor --query is given", async () => {
    const { exitCode, stderr } = await runCli([
      "odb-query",
      FORM_AND_REPORT_ODB_PATH,
    ]);

    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("pass --sql <text> or --query <savedName>");
  });

  it("fails naming the available saved queries when --query names one the .odb does not declare", async () => {
    const { exitCode, stderr } = await runCli([
      "odb-query",
      FORM_AND_REPORT_ODB_PATH,
      "--query",
      "NoSuchQuery",
    ]);

    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("no saved query named 'NoSuchQuery'");
    expect(stderr).toContain("HighValueSales");
  });

  it("fails naming the construct for a real SQL feature this bounded engine does not implement", async () => {
    const { exitCode, stderr } = await runCli([
      "odb-query",
      FORM_AND_REPORT_ODB_PATH,
      "--sql",
      "SELECT ID FROM SALES JOIN OTHER ON SALES.ID = OTHER.ID",
    ]);

    expect(exitCode).toBe(EXIT_INPUT_ERROR);
    expect(stderr).toContain("JOIN");
  });

  it("fails for input that is not well-formed SQL under this grammar", async () => {
    const { exitCode, stderr } = await runCli([
      "odb-query",
      FORM_AND_REPORT_ODB_PATH,
      "--sql",
      "SELECT FROM",
    ]);

    expect(exitCode).toBe(EXIT_INPUT_ERROR);
    expect(stderr).toContain("parse error");
  });
});

describe("odb-render-report", () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-cli-odb-render-"));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("renders the report to docx as real, editable table content", async () => {
    const output = join(workspace, "report.docx");
    const { exitCode, stderr } = await runCli([
      "odb-render-report",
      FORM_AND_REPORT_ODB_PATH,
      output,
    ]);

    // Not asserted empty: unlike odb-forms/odb-reports/odb-tables above, this command follows buildConversionAction's own convention of a one-line stderr summary on success (wrote N bytes ...) — see the `wrote` assertion below.
    expect(stderr).toContain(`wrote`);
    expect(exitCode).toBe(EXIT_SUCCESS);
    const editor = openDocx(new Uint8Array(await readFile(output)));
    const cellText = allTableCellText(editor.tables());
    expect(cellText).toContain("Grand total:");
    expect(cellText).toContain("6100.75");
    expect(cellText).toContain("Acme Ltd");
  });

  it("renders the report to odt as real, editable table content", async () => {
    const output = join(workspace, "report.odt");
    const { exitCode, stderr } = await runCli([
      "odb-render-report",
      FORM_AND_REPORT_ODB_PATH,
      output,
    ]);

    expect(stderr).toContain(`wrote`);
    expect(exitCode).toBe(EXIT_SUCCESS);
    const editor = openOdt(new Uint8Array(await readFile(output)));
    const cellText = allTableCellText(editor.tables());
    expect(cellText).toContain("Grand total:");
    expect(cellText).toContain("6100.75");
    expect(cellText).toContain("Acme Ltd");
  });

  it("renders the report to a real pdf", async () => {
    const output = join(workspace, "report.pdf");
    const { exitCode } = await runCli([
      "odb-render-report",
      FORM_AND_REPORT_ODB_PATH,
      output,
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const bytes = await readFile(output);
    expect(new TextDecoder("latin1").decode(bytes.subarray(0, 5))).toBe(
      "%PDF-",
    );
  });

  it("accepts an explicit --report naming the one report the fixture declares", async () => {
    const output = join(workspace, "report-named.docx");
    const { exitCode } = await runCli([
      "odb-render-report",
      FORM_AND_REPORT_ODB_PATH,
      output,
      "--report",
      "SalesByRegion",
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
  });

  it("fails clearly, naming the available reports, when --report names one the .odb does not declare", async () => {
    const output = join(workspace, "never-written.docx");
    const { exitCode, stderr } = await runCli([
      "odb-render-report",
      FORM_AND_REPORT_ODB_PATH,
      output,
      "--report",
      "NoSuchReport",
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("SalesByRegion");
  });

  it("rejects a target format outside docx/odt/pdf", async () => {
    const output = join(workspace, "never-written.xlsx");
    const { exitCode, stderr } = await runCli([
      "odb-render-report",
      FORM_AND_REPORT_ODB_PATH,
      output,
    ]);

    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("docx, odt, pdf");
  });
});
