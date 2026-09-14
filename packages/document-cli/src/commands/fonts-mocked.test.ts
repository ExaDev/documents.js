import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as DocumentsJs from "documents.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EXIT_SUCCESS } from "../runtime/exit-codes";

// A dedicated file, isolated from fonts.test.ts's own real-fixture tests: mocking extractSourceFontsForFormat here is file-wide, so it must never share a module with a test that needs the genuine implementation. Covers the human-readable report's own style-suffix rendering -- bold, italic, both, and neither -- which no real embedded-font fixture in fonts.test.ts carries (every fixture there embeds a plain regular face), plus the unrecognised-extension branch fonts.ts's own runFonts short-circuits on before ever reaching the extractor at all.
vi.mock("documents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentsJs>();
  return {
    ...actual,
    extractSourceFontsForFormat: vi.fn(),
  };
});

async function runFontsCommand(input: string): Promise<{
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
    await createProgram().parseAsync(["node", "document-cli", "fonts", input]);
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

describe("fonts command against a mocked extractor", () => {
  let workspace: string;
  let inputPath: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-cli-fonts-mock-"));
    inputPath = join(workspace, "fixture.docx");
    // Content is irrelevant -- extractSourceFontsForFormat is mocked below, so only readInput's own file-exists check ever touches these bytes.
    await writeFile(inputPath, "irrelevant");
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it("suffixes a bold-only face with '(bold)'", async () => {
    const { extractSourceFontsForFormat } = await import("documents.js");
    vi.mocked(extractSourceFontsForFormat).mockReturnValue([
      {
        family: "Example",
        bold: true,
        italic: false,
        bytes: new Uint8Array(3),
      },
    ]);

    const { stdout } = await runFontsCommand(inputPath);
    expect(stdout).toBe("Example (bold) -- 3 bytes\n");
  });

  it("suffixes an italic-only face with '(italic)'", async () => {
    const { extractSourceFontsForFormat } = await import("documents.js");
    vi.mocked(extractSourceFontsForFormat).mockReturnValue([
      {
        family: "Example",
        bold: false,
        italic: true,
        bytes: new Uint8Array(5),
      },
    ]);

    const { stdout } = await runFontsCommand(inputPath);
    expect(stdout).toBe("Example (italic) -- 5 bytes\n");
  });

  it("joins both styles with a space when a face is bold and italic", async () => {
    const { extractSourceFontsForFormat } = await import("documents.js");
    vi.mocked(extractSourceFontsForFormat).mockReturnValue([
      { family: "Example", bold: true, italic: true, bytes: new Uint8Array(7) },
    ]);

    const { stdout } = await runFontsCommand(inputPath);
    expect(stdout).toBe("Example (bold italic) -- 7 bytes\n");
  });

  it("omits the parenthetical suffix entirely for a plain regular face, not a blank pair", async () => {
    const { extractSourceFontsForFormat } = await import("documents.js");
    vi.mocked(extractSourceFontsForFormat).mockReturnValue([
      {
        family: "Example",
        bold: false,
        italic: false,
        bytes: new Uint8Array(2),
      },
    ]);

    const { stdout } = await runFontsCommand(inputPath);
    expect(stdout).toBe("Example -- 2 bytes\n");
    expect(stdout).not.toContain("(");
  });

  it("names the input and its lack of a recognised extension when the format cannot be inferred", async () => {
    const noExtensionPath = join(workspace, "no-extension-at-all");
    await writeFile(noExtensionPath, "irrelevant");

    const { exitCode, stderr } = await runFontsCommand(noExtensionPath);
    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toBe(
      `[fonts] cannot infer a document format from '${noExtensionPath}'; expected one of docx, pptx, odt, odp, ods, odg\n`,
    );
  });
});
