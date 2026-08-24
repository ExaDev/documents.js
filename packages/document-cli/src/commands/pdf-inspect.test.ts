import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocx, docxToPdf, readPdf } from "documents.js";
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
import { EXIT_SUCCESS } from "../runtime/exit-codes";

// Drives the real assembled commander program against a real PDF (docxToPdf's own real output, not a hand-built LayoutDocument), proving `--full` writes the complete parsed LayoutDocument as plain JSON -- untagged by design since the LayoutDocument family moved to pdf-codec at document-schema.js 4.0.0 and lost its schema-stamped JSON envelope.

let savedExitCode: typeof process.exitCode;
let workspace: string;
let pdfPath: string;

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
  workspace = await mkdtemp(join(tmpdir(), "document-cli-pdf-inspect-"));
  const editor = createDocx();
  editor.body
    .appendParagraph()
    .appendRun({ text: "A paragraph of ordinary body text." });
  const pdfBytes = docxToPdf(editor.toBytes());
  pdfPath = join(workspace, "sample.pdf");
  await writeFile(pdfPath, pdfBytes);
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

describe("pdf-inspect --full", () => {
  it("writes the complete parsed LayoutDocument as plain untagged JSON, matching a direct readPdf of the same bytes", async () => {
    const { exitCode, stdout, stderr } = await runCli([
      "pdf-inspect",
      pdfPath,
      "--full",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);

    const parsed: unknown = JSON.parse(stdout);

    // `toEqual`, not `toStrictEqual`: a JSON round trip cannot distinguish an explicitly-`undefined` optional field (how `readPdf`'s own in-memory value carries an absent one) from a genuinely missing key (what `JSON.stringify`/`JSON.parse` produces for it instead) -- an inherent property of JSON itself.
    expect(parsed).toEqual(readPdf(new Uint8Array(await readFile(pdfPath))));

    // The dump is the plain pdf-codec value -- no $schema key exists for a LayoutDocument any more (the family moved to pdf-codec at document-schema.js 4.0.0 and lost its schema-stamped envelope), so asserting its absence pins the demotion against an accidental re-tag with a schema that no longer defines this kind.
    expect(parsed).not.toHaveProperty("$schema");
  });
});
