import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocx } from "documents.js";
import type * as DocumentsJs from "documents.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT_INPUT_ERROR } from "../runtime/exit-codes";
import type * as RuntimeIo from "../runtime/io";

// A dedicated file, isolated from docx-extras.test.ts's own real-fixture tests: mocking readDocxExtras here is file-wide, so it must never share a module with a test that needs the genuine implementation. Covers the error path no real fixture reaches (proving the "[docx-extras]" prefix names this command specifically, not merely some non-empty string, and that a thrown error maps to the input-error exit code) and proves the abort signal createRuntimeSignal builds is genuinely threaded through to readInput's own options, not dropped.
vi.mock("documents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentsJs>();
  return {
    ...actual,
    readDocxExtras: vi.fn(),
  };
});

vi.mock("../runtime/io", async (importOriginal) => {
  const actual = await importOriginal<typeof RuntimeIo>();
  return {
    ...actual,
    readInput: vi.fn(actual.readInput),
  };
});

async function runDocxExtrasCommand(input: string): Promise<{
  readonly exitCode: typeof process.exitCode;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const { createProgram } = await import("../program");
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
  const savedExitCode = process.exitCode;
  try {
    await createProgram().parseAsync([
      "node",
      "document-cli",
      "docx-extras",
      input,
    ]);
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  }
  const result = {
    exitCode: process.exitCode,
    stdout: stdoutChunks.join(""),
    stderr: stderrChunks.join(""),
  };
  process.exitCode = savedExitCode;
  return result;
}

describe("docx-extras command against a mocked reader", () => {
  let workspace: string;
  let inputPath: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-cli-docx-extras-mock-"));
    inputPath = join(workspace, "fixture.docx");
    await writeFile(inputPath, createDocx().toBytes());
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("reports a thrown error with the '[docx-extras]' prefix naming this command specifically, mapped to the input-error exit code", async () => {
    const { readDocxExtras } = await import("documents.js");
    vi.mocked(readDocxExtras).mockImplementation(() => {
      throw new Error("boom");
    });

    const { exitCode, stdout, stderr } = await runDocxExtrasCommand(inputPath);

    expect(stdout).toBe("");
    expect(stderr).toBe("[docx-extras] error: boom\n");
    expect(exitCode).toBe(EXIT_INPUT_ERROR);
  });

  it("threads a real AbortSignal through to readInput's own options, not an empty options object", async () => {
    const { readDocxExtras } = await import("documents.js");
    vi.mocked(readDocxExtras).mockReturnValue({
      comments: [],
      footnotes: [],
      headerFooterParts: [],
      sectionHeaderFooters: [],
      numbering: {},
    });
    const { readInput } = await import("../runtime/io");

    await runDocxExtrasCommand(inputPath);

    const call = vi.mocked(readInput).mock.calls[0];
    expect(call?.[0]).toBe(inputPath);
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });
});
