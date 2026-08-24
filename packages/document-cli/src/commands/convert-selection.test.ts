import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOdg, createOds } from "documents.js";
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
import { EXIT_NEEDS_INFO, EXIT_SUCCESS } from "../runtime/exit-codes";

// Drives the real assembled commander program end to end against a real multi-sheet .ods and a real multi-page .odg, asserting the three csv/svg edge selections this CLI threads into documents.js's own ConversionOptions: a csv target that would be ambiguous fails with exit 3 naming the sheets (the CLI's own translation of CsvSheetNotSpecifiedError), --sheet answers it, --delimiter reaches both the csv write edge (and the csv read edge, via the read-side fixture below), and --page picks which page an svg target draws. The odg pages carry a rect each at disjoint coordinates rather than textboxes because buildSvgText itself draws vectors only -- a draw:frame shape has no SVG vector representation and is reported as svg/shape-unsupported instead, so a textbox would assert nothing.

let workspace: string;

// Commander's action sets `process.exitCode` on the real process; a command that failed would otherwise leave a non-zero code behind and fail the whole vitest run for reasons unrelated to any assertion here.
let savedExitCode: typeof process.exitCode;

interface CapturedRun {
  readonly exitCode: typeof process.exitCode;
  readonly stderr: string;
}

async function runCli(args: readonly string[]): Promise<CapturedRun> {
  const stderrChunks: string[] = [];
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
    stderrSpy.mockRestore();
  }
  return { exitCode: process.exitCode, stderr: stderrChunks.join("") };
}

// Two sheets so a csv target has to be told which one; two columns in the picked sheet so --delimiter has a boundary to draw.
function multiSheetOdsBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOds();
  const first = editor.sheets()[0];
  if (first === undefined) throw new Error("createOds produced no sheets");
  first.cell(0, 0).value = { kind: "string", value: "AlphaCell" };
  first.cell(0, 1).value = { kind: "number", value: 42 };
  const beta = editor.addSheet("Beta");
  beta.cell(0, 0).value = { kind: "string", value: "BetaCell" };
  beta.cell(0, 1).value = { kind: "number", value: 7 };
  return editor.toBytes();
}

// Two pages whose only vector sits at disjoint coordinates, so which page an svg target drew is a substring check on the emitted <rect>.
function multiPageOdgBytes(): Uint8Array<ArrayBuffer> {
  const editor = createOdg();
  editor
    .addPage()
    .addRect({ frame: { xPt: 20, yPt: 20, widthPt: 100, heightPt: 50 } });
  editor
    .addPage()
    .addRect({ frame: { xPt: 300, yPt: 400, widthPt: 100, heightPt: 50 } });
  return editor.toBytes();
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-selection-"));
  await writeFile(join(workspace, "multi.ods"), multiSheetOdsBytes());
  await writeFile(join(workspace, "multi.odg"), multiPageOdgBytes());
  // A semicolon-delimited csv the read side needs --delimiter to parse as two columns rather than one.
  await writeFile(join(workspace, "semi.csv"), "Left;Right\nfirst;second\n");
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

beforeEach(() => {
  savedExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = savedExitCode;
});

describe("ods-to-csv sheet selection", () => {
  it("fails with exit 3 naming the sheets when the source has more than one and --sheet is absent", async () => {
    const run = await runCli([
      "ods-to-csv",
      join(workspace, "multi.ods"),
      join(workspace, "unpicked.csv"),
    ]);
    expect(run.exitCode).toBe(EXIT_NEEDS_INFO);
    expect(run.stderr).toContain("Sheet1");
    expect(run.stderr).toContain("Beta");
  });

  it("writes the named sheet with --sheet", async () => {
    const output = join(workspace, "beta.csv");
    const run = await runCli([
      "ods-to-csv",
      join(workspace, "multi.ods"),
      output,
      "--sheet",
      "Beta",
    ]);
    expect(run.exitCode).toBe(EXIT_SUCCESS);
    await expect(readFile(output, "utf8")).resolves.toContain("BetaCell,7");
  });

  it("fails with exit 3 when --sheet names a sheet the source does not have", async () => {
    const run = await runCli([
      "ods-to-csv",
      join(workspace, "multi.ods"),
      join(workspace, "missing.csv"),
      "--sheet",
      "Nope",
    ]);
    expect(run.exitCode).toBe(EXIT_NEEDS_INFO);
    expect(run.stderr).toContain("Nope");
  });
});

describe("csv delimiter selection", () => {
  it("writes the csv target with --delimiter", async () => {
    const output = join(workspace, "semi-out.csv");
    const run = await runCli([
      "ods-to-csv",
      join(workspace, "multi.ods"),
      output,
      "--sheet",
      "Sheet1",
      "--delimiter",
      ";",
    ]);
    expect(run.exitCode).toBe(EXIT_SUCCESS);
    await expect(readFile(output, "utf8")).resolves.toContain("AlphaCell;42");
  });

  it("reads the csv source with --delimiter", async () => {
    const output = join(workspace, "semi-to.md");
    const run = await runCli([
      "csv-to-markdown",
      join(workspace, "semi.csv"),
      output,
      "--delimiter",
      ";",
    ]);
    expect(run.exitCode).toBe(EXIT_SUCCESS);
    const markdown = await readFile(output, "utf8");
    expect(markdown).toContain("Left");
    expect(markdown).toContain("first");
    // A single comma-free table row proves the read split on semicolons: an unparsed 'first;second' cell would surface verbatim.
    expect(markdown).not.toContain("first;second");
  });
});

describe("odg-to-svg page selection", () => {
  it("fails with exit 3 naming the page count when the source has more than one page and --page is absent", async () => {
    const run = await runCli([
      "odg-to-svg",
      join(workspace, "multi.odg"),
      join(workspace, "unpicked.svg"),
    ]);
    expect(run.exitCode).toBe(EXIT_NEEDS_INFO);
    expect(run.stderr).toContain("page");
  });

  it("draws the 0-based --page index selected", async () => {
    const output = join(workspace, "page1.svg");
    const run = await runCli([
      "odg-to-svg",
      join(workspace, "multi.odg"),
      output,
      "--page",
      "1",
    ]);
    expect(run.exitCode).toBe(EXIT_SUCCESS);
    const svg = await readFile(output, "utf8");
    expect(svg).toContain('<rect x="300" y="400"');
    expect(svg).not.toContain('<rect x="20" y="20"');
  });

  it("fails with exit 3 when --page indexes past the last page", async () => {
    const run = await runCli([
      "odg-to-svg",
      join(workspace, "multi.odg"),
      join(workspace, "over.svg"),
      "--page",
      "5",
    ]);
    expect(run.exitCode).toBe(EXIT_NEEDS_INFO);
    expect(run.stderr).toContain("page index 5");
  });
});

describe("csv and svg through the generic convert command", () => {
  it("converts a csv source to pdf", async () => {
    const output = join(workspace, "semi.pdf");
    const run = await runCli([
      "convert",
      join(workspace, "semi.csv"),
      output,
      "--delimiter",
      ";",
    ]);
    expect(run.exitCode).toBe(EXIT_SUCCESS);
    // A minimal but real PDF: the header announces the format and the byte length clears the smallest well-formed file.
    const bytes = await readFile(output);
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it("carries --page through the generic convert command to an svg target", async () => {
    const output = join(workspace, "generic.svg");
    const run = await runCli([
      "convert",
      join(workspace, "multi.odg"),
      output,
      "--page",
      "0",
    ]);
    expect(run.exitCode).toBe(EXIT_SUCCESS);
    const svg = await readFile(output, "utf8");
    expect(svg).toContain('<rect x="20" y="20"');
    expect(svg).not.toContain('<rect x="300" y="400"');
  });
});
