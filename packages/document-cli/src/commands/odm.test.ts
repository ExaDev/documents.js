import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOdt } from "documents.js";
import { FIXTURE_FONT_FAMILY } from "../test-support/font-fixture";
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
import { singleChapterOdmBytes } from "../test-support/odm-fixture";

let workspace: string;
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
    // program.ts's own exitOverride sets process.exitCode BEFORE rethrowing a commander-level parse failure (an unknown option, or -- as here -- a custom coerce function's own InvalidArgumentError), so the rejection itself carries nothing this suite needs beyond the exit code already recorded on process.exitCode; every other command action already resolves normally with process.exitCode set the identical way.
    await createProgram().parseAsync(["node", "document-cli", ...args]);
  } catch {
    // Swallowed deliberately -- see the comment above.
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

beforeAll(async () => {
  savedExitCode = process.exitCode;
  workspace = await mkdtemp(join(tmpdir(), "document-cli-odm-"));
  await writeFile(
    join(workspace, "book.odm"),
    singleChapterOdmBytes("chapter1.odt"),
  );
  const chapter = createOdt();
  chapter.body.appendParagraph().appendRun({ text: "Chapter content" });
  await writeFile(join(workspace, "chapter1.odt"), chapter.toBytes());

  await writeFile(
    join(workspace, "book-calibri.odm"),
    singleChapterOdmBytes("calibri-chapter.odt"),
  );
  const calibriChapter = createOdt();
  calibriChapter.body.appendParagraph().appendRun({
    text: "A paragraph set in Calibri",
    fontFamily: FIXTURE_FONT_FAMILY,
  });
  await writeFile(
    join(workspace, "calibri-chapter.odt"),
    calibriChapter.toBytes(),
  );
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

afterEach(() => {
  process.exitCode = savedExitCode;
});

describe("odm-to-pdf", () => {
  it("resolves a chapter via --chapters-dir, matched by basename", async () => {
    const output = join(workspace, "via-dir.pdf");
    const { exitCode } = await runCli([
      "odm-to-pdf",
      join(workspace, "book.odm"),
      output,
      "--chapters-dir",
      workspace,
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);
    const bytes = await readFile(output);
    expect(new TextDecoder("latin1").decode(bytes.subarray(0, 5))).toBe(
      "%PDF-",
    );
  });

  it("resolves a chapter via an explicit --chapter href=file override", async () => {
    const output = join(workspace, "via-override.pdf");
    const { exitCode } = await runCli([
      "odm-to-pdf",
      join(workspace, "book.odm"),
      output,
      "--chapter",
      `chapter1.odt=${join(workspace, "chapter1.odt")}`,
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);
  });

  it("fails, naming both --chapters-dir and --chapter, when a chapter cannot be resolved", async () => {
    const output = join(workspace, "unresolved.pdf");
    const { exitCode, stderr } = await runCli([
      "odm-to-pdf",
      join(workspace, "book.odm"),
      output,
    ]);
    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("--chapters-dir");
    expect(stderr).toContain("--chapter");
  });

  it("fails the same way when --chapters-dir is given but does not contain the href's basename", async () => {
    const emptyDir = join(workspace, "empty-chapters-dir");
    await mkdir(emptyDir);
    const { exitCode, stderr } = await runCli([
      "odm-to-pdf",
      join(workspace, "book.odm"),
      join(workspace, "unresolved-via-dir.pdf"),
      "--chapters-dir",
      emptyDir,
    ]);
    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("--chapters-dir");
    expect(stderr).toContain("--chapter");
  });

  it("rejects a malformed --chapter flag missing the '=' separator", async () => {
    const { exitCode, stderr } = await runCli([
      "odm-to-pdf",
      join(workspace, "book.odm"),
      join(workspace, "never.pdf"),
      "--chapter",
      "no-equals-sign",
    ]);
    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("--chapter must be formatted as <href>=<file>");
  });

  it("rejects conflicting positional and --out destinations, naming both under the odm-to-pdf command", async () => {
    const { exitCode, stderr } = await runCli([
      "odm-to-pdf",
      join(workspace, "book.odm"),
      join(workspace, "positional.pdf"),
      "--out",
      join(workspace, "flag.pdf"),
      "--chapters-dir",
      workspace,
    ]);
    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toBe(
      `[odm-to-pdf] conflicting output destinations: positional '${join(workspace, "positional.pdf")}' and --out '${join(workspace, "flag.pdf")}'\n`,
    );
  });

  it("emits a JSON result summary on stderr under --json, naming the real output path", async () => {
    const output = join(workspace, "via-json.pdf");
    const { exitCode, stderr } = await runCli([
      "odm-to-pdf",
      join(workspace, "book.odm"),
      output,
      "--chapters-dir",
      workspace,
      "--json",
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);
    const lastLine = stderr.trim().split("\n").at(-1) ?? "";
    expect(JSON.parse(lastLine)).toMatchObject({
      type: "result",
      output,
    });
  });

  it("writes to the path named by --out when no positional output is given", async () => {
    const output = join(workspace, "via-out-flag.pdf");
    const { exitCode } = await runCli([
      "odm-to-pdf",
      join(workspace, "book.odm"),
      "--out",
      output,
      "--chapters-dir",
      workspace,
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);
    const bytes = new Uint8Array(await readFile(output));
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it("prints a font-substitution event under --report-font-substitutions, and stays silent without it", async () => {
    const reported = await runCli([
      "odm-to-pdf",
      join(workspace, "book-calibri.odm"),
      join(workspace, "reported.pdf"),
      "--chapters-dir",
      workspace,
      "--report-font-substitutions",
    ]);
    expect(reported.exitCode).toBe(EXIT_SUCCESS);
    expect(reported.stderr).toContain(
      '[odm-to-pdf] font substitution: "Calibri" -> "carlito" (vendored-substitute)',
    );

    const silent = await runCli([
      "odm-to-pdf",
      join(workspace, "book-calibri.odm"),
      join(workspace, "silent.pdf"),
      "--chapters-dir",
      workspace,
    ]);
    expect(silent.exitCode).toBe(EXIT_SUCCESS);
    expect(silent.stderr).not.toContain("font substitution");
  });

  it("registers odm-to-pdf with its own description and every conversion/font/chapter option", () => {
    const command = createProgram().commands.find(
      (candidate) => candidate.name() === "odm-to-pdf",
    );
    expect(command?.description()).toBe(
      "convert a .odm master document to pdf, resolving each chapter's external .odt reference via --chapters-dir and/or --chapter",
    );
    const longs = (command?.options ?? []).map((option) => option.long);
    expect(longs).toEqual(
      expect.arrayContaining([
        "--out",
        "--timeout",
        "--json",
        "--quiet",
        "--verbose",
        "--font-file",
        "--report-font-substitutions",
        "--chapters-dir",
        "--chapter",
      ]),
    );
    const chaptersDirOption = command?.options.find(
      (option) => option.long === "--chapters-dir",
    );
    expect(chaptersDirOption?.description).toBe(
      "directory to search for each unresolved chapter href, matched by the href's own basename",
    );
    const chapterOption = command?.options.find(
      (option) => option.long === "--chapter",
    );
    expect(chapterOption?.description).toBe(
      "resolve one chapter href to a local file explicitly; repeatable",
    );
  });
});
