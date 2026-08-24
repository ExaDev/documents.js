import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocx } from "documents.js";
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
import { EXIT_SUCCESS, EXIT_USAGE_ERROR } from "../runtime/exit-codes";
import {
  buildDocxWithEmbeddedFont,
  buildOdtWithEmbeddedFont,
  buildPptxWithEmbeddedFont,
} from "../test-support/embedded-font-fixture";
import {
  FIXTURE_FONT_FAMILY,
  fixtureCalibriFontBytes,
} from "../test-support/font-fixture";

// Drives the real assembled commander program against real docx/pptx/odt fixtures that genuinely embed a source font face (test-support/embedded-font-fixture.ts), not extractSourceFonts in isolation -- proving `fonts` is registered under that name, dispatches docx/pptx through ooxml.js's decodePackage and odt/odp/ods/odg through odf.js's, and reaches stdout as both a human-readable report and parseable --json.

let savedExitCode: typeof process.exitCode;
let workspace: string;
let fontByteLength: number;

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

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-fonts-"));
  const fontBytes = fixtureCalibriFontBytes();
  fontByteLength = fontBytes.length;
  await writeFile(
    join(workspace, "embedded.docx"),
    buildDocxWithEmbeddedFont({ family: FIXTURE_FONT_FAMILY, fontBytes }),
  );
  await writeFile(
    join(workspace, "embedded.pptx"),
    buildPptxWithEmbeddedFont({ family: FIXTURE_FONT_FAMILY, fontBytes }),
  );
  await writeFile(
    join(workspace, "embedded.odt"),
    buildOdtWithEmbeddedFont({ family: FIXTURE_FONT_FAMILY, fontBytes }),
  );
  const plain = createDocx();
  plain.body.appendParagraph().appendRun({ text: "No fonts embedded here." });
  await writeFile(join(workspace, "plain.docx"), plain.toBytes());
  // extractSourceFontsForFormat (documents.js) validates the format itself rather than the CLI pre-checking it, so the input file is now genuinely read before that rejection fires -- unlike a bare nonexistent path, this needs to exist. Its content is never parsed: the rejection below fires purely on the '.xlsx' extension.
  await writeFile(join(workspace, "unused.xlsx"), new Uint8Array([0]));
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

describe("fonts", () => {
  it("lists the one embedded face a docx declares, as a human-readable report", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      "fonts",
      join(workspace, "embedded.docx"),
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain(FIXTURE_FONT_FAMILY);
    expect(stdout).toContain(`${fontByteLength} bytes`);
  });

  it("lists the one embedded face a pptx declares, dispatched through the identical extractor", async () => {
    const { exitCode, stdout } = await runCli([
      "fonts",
      join(workspace, "embedded.pptx"),
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain(FIXTURE_FONT_FAMILY);
    expect(stdout).toContain(`${fontByteLength} bytes`);
  });

  it("lists the one embedded face an odt declares, dispatched through odf.js decodePackage rather than ooxml.js", async () => {
    const { exitCode, stdout } = await runCli([
      "fonts",
      join(workspace, "embedded.odt"),
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain(FIXTURE_FONT_FAMILY);
    expect(stdout).toContain(`${fontByteLength} bytes`);
  });

  it("emits {family, bold, italic, byteLength} objects under --json, never the raw font bytes", async () => {
    const { exitCode, stdout } = await runCli([
      "fonts",
      join(workspace, "embedded.docx"),
      "--json",
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toStrictEqual([
      {
        family: FIXTURE_FONT_FAMILY,
        bold: false,
        italic: false,
        byteLength: fontByteLength,
      },
    ]);
  });

  it("says so plainly for a document that embeds no source fonts", async () => {
    const { exitCode, stdout } = await runCli([
      "fonts",
      join(workspace, "plain.docx"),
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain("This document embeds no source fonts.");
  });

  it("rejects a format with no source-embedded-font concept, naming the restriction", async () => {
    const { exitCode, stderr } = await runCli([
      "fonts",
      join(workspace, "unused.xlsx"),
    ]);

    expect(exitCode).toBe(EXIT_USAGE_ERROR);
    expect(stderr).toContain("xlsx");
    expect(stderr).toContain("docx, pptx, odt, odp, ods, odg");
  });
});
