import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocx } from "documents.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createProgram } from "../program";
import { EXIT_SUCCESS, EXIT_USAGE_ERROR } from "../runtime/exit-codes";

let workspace: string;
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
  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);
  try {
    await createProgram().parseAsync(["node", "document-cli", ...args]);
  } finally {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  }
  return { exitCode: process.exitCode, stderr: stderrChunks.join("") };
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-convert-"));
  const docx = createDocx();
  docx.body.appendParagraph().appendRun({ text: "hello" });
  await writeFile(join(workspace, "input.docx"), docx.toBytes());
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

afterEach(() => {
  process.exitCode = savedExitCode;
});

beforeAll(() => {
  savedExitCode = process.exitCode;
});

describe("convert", () => {
  it("converts a real docx to pdf via the generic command, inferring both formats", async () => {
    const output = join(workspace, "generic-output.pdf");
    const { exitCode } = await runCli([
      "convert",
      join(workspace, "input.docx"),
      output,
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);
  });

  it("rejects a .odm input, naming odm-to-pdf as the alternative", async () => {
    const { exitCode, stderr } = await runCli([
      "convert",
      join(workspace, "book.odm"),
      join(workspace, "out.pdf"),
    ]);
    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("'.odm' master documents are not supported");
    expect(stderr).toContain("odm-to-pdf");
  });

  it("rejects a .odb input, naming the odb-specific commands as the alternative", async () => {
    const { exitCode, stderr } = await runCli([
      "convert",
      join(workspace, "database.odb"),
      join(workspace, "out.pdf"),
    ]);
    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("'.odb' embedded databases are not supported");
    expect(stderr).toContain("odb-to-csv");
    expect(stderr).toContain("odb-to-xlsx");
    expect(stderr).toContain("odb-tables");
  });

  it("fails clearly when the source format cannot be inferred from the input extension", async () => {
    const { exitCode, stderr } = await runCli([
      "convert",
      join(workspace, "mystery.xyz"),
      join(workspace, "out.pdf"),
    ]);
    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("cannot infer a source format from");
    expect(stderr).toContain("mystery.xyz");
  });

  it("fails clearly when the target format cannot be resolved at all", async () => {
    const { exitCode, stderr } = await runCli([
      "convert",
      join(workspace, "input.docx"),
    ]);
    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("convert:");
  });

  it("prefers --to over the output path's own extension for the target format", async () => {
    const output = join(workspace, "explicit-to.pdf");
    const { exitCode } = await runCli([
      "convert",
      join(workspace, "input.docx"),
      output,
      "--to",
      "pdf",
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);
  });
});

describe("docx-to-pdf", () => {
  it("registers the explicit per-pair command and runs a real conversion", async () => {
    const output = join(workspace, "explicit-output.pdf");
    const { exitCode } = await runCli([
      "docx-to-pdf",
      join(workspace, "input.docx"),
      output,
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);
  });
});

describe("registerConversionCommands option wiring", () => {
  const program = createProgram();
  const byName = (name: string) =>
    program.commands.find((command) => command.name() === name);
  const hasOption = (
    command: ReturnType<typeof byName>,
    long: string,
  ): boolean => (command?.options ?? []).some((option) => option.long === long);

  it("describes each explicit per-pair command by its own source and target", () => {
    expect(byName("docx-to-pdf")?.description()).toBe(
      "convert a docx document to pdf",
    );
    expect(byName("pdf-to-docx")?.description()).toBe(
      "convert a pdf document to docx",
    );
  });

  it("adds --delimiter only to a command whose source or target is csv", () => {
    expect(hasOption(byName("docx-to-csv"), "--delimiter")).toBe(true);
    expect(hasOption(byName("csv-to-docx"), "--delimiter")).toBe(true);
    expect(hasOption(byName("docx-to-pdf"), "--delimiter")).toBe(false);
  });

  it("adds --sheet only to a command whose target is csv", () => {
    expect(hasOption(byName("docx-to-csv"), "--sheet")).toBe(true);
    expect(hasOption(byName("csv-to-docx"), "--sheet")).toBe(false);
    expect(hasOption(byName("docx-to-pdf"), "--sheet")).toBe(false);
  });

  it("adds --page only to a command whose target is svg", () => {
    expect(hasOption(byName("docx-to-svg"), "--page")).toBe(true);
    expect(hasOption(byName("docx-to-csv"), "--page")).toBe(false);
    expect(hasOption(byName("docx-to-pdf"), "--page")).toBe(false);
  });

  it("describes the generic convert command and registers its shared and --to options", () => {
    const generic = byName("convert");
    expect(generic?.description()).toBe(
      "convert between any two supported document formats, inferring source/target from file extensions where possible",
    );
    expect(hasOption(generic, "--json")).toBe(true);
    expect(hasOption(generic, "--dump-package")).toBe(true);
    expect(hasOption(generic, "--sheet")).toBe(true);
    expect(hasOption(generic, "--page")).toBe(true);
    const toOption = generic?.options.find((option) => option.long === "--to");
    expect(toOption?.description).toContain(
      "target format when it cannot be inferred from the output path",
    );
  });
});
