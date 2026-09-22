import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as DocumentsJs from "documents.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT_INPUT_ERROR, EXIT_SUCCESS } from "../runtime/exit-codes";

// A dedicated file, isolated from metadata.test.ts's own real-fixture tests: mocking readDocumentMetadata here is file-wide, so it must never share a module with a test that needs the genuine implementation. Covers the two branches no real fixture reaches cleanly — a document whose metadata reader returns no fields at all (a fresh createDocx() always stamps created/modified, so metadata.test.ts's own "omits every field" case can never exercise the truly-empty path), and the reader throwing (proving the [metadata] prefix, the non-verbose error formatting, and the exit-code mapping without needing a genuinely corrupt fixture).
vi.mock("documents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentsJs>();
  return {
    ...actual,
    readDocumentMetadata: vi.fn(),
  };
});

async function runMetadataCommand(input: string): Promise<{
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
      "metadata",
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

describe("metadata command against a mocked reader", () => {
  let workspace: string;
  let inputPath: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-cli-metadata-mock-"));
    inputPath = join(workspace, "fixture.docx");
    // Content is irrelevant — readDocumentMetadata is mocked below, so only readInput's own file-exists check ever touches these bytes.
    await writeFile(inputPath, "irrelevant");
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("prints the no-metadata sentinel line when the reader returns no fields at all", async () => {
    const { readDocumentMetadata } = await import("documents.js");
    vi.mocked(readDocumentMetadata).mockReturnValue({});

    const { exitCode, stdout, stderr } = await runMetadataCommand(inputPath);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toBe("This document carries no metadata.\n");
  });

  it("reports a thrown error with the [metadata] prefix, non-verbose, mapped to the input-error exit code", async () => {
    const { readDocumentMetadata } = await import("documents.js");
    vi.mocked(readDocumentMetadata).mockImplementation(() => {
      throw new Error("boom");
    });

    const { exitCode, stdout, stderr } = await runMetadataCommand(inputPath);

    expect(stdout).toBe("");
    expect(stderr).toBe("[metadata] error: boom\n");
    expect(exitCode).toBe(EXIT_INPUT_ERROR);
  });
});
