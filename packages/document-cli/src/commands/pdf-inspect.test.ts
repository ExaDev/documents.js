import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocx, createPdf, docxToPdf, readPdf } from "documents.js";
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

// Drives the real assembled commander program against a real PDF (docxToPdf's own real output, not a hand-built LayoutDocument), proving `--full` writes the complete parsed LayoutDocument as plain JSON — untagged by design since the LayoutDocument family moved to pdf-codec at document-schema.js 4.0.0 and lost its schema-stamped JSON envelope.

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

// A genuinely decodable 1x1 red PNG (real IHDR/IDAT/IEND chunks) — appendImage decodes the pixel grid to size the image asset it registers, so a fake signature-only PNG would throw rather than produce a real "png" entry in imagesByFormat.
const REAL_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02,
  0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44,
  0x41, 0x54, 0x78, 0xda, 0x63, 0xf8, 0xcf, 0xc0, 0x00, 0x00, 0x03, 0x01, 0x01,
  0x00, 0xf7, 0x03, 0x41, 0x43, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

// Two pages, one text item and one rect on page 1 (a mixed item-kind histogram), one image on page 2 (a real, decodable PNG so it survives round-trip and populates imagesByFormat), plus document metadata — enough to exercise every branch of runPdfInspect's default and --json report paths (multi-page pluralisation, a non-empty histogram, the metadata section, and the images section).
function multiPagePdfBytes(): Uint8Array<ArrayBuffer> {
  const editor = createPdf();
  editor.metadata = { title: "Inspectable", author: "Test Suite" };
  const page0 = editor.pages()[0];
  if (page0 === undefined) {
    throw new Error("createPdf() always seeds one page");
  }
  page0.appendText({
    xPt: 10,
    yPt: 20,
    text: "Hello",
    font: { family: "Helvetica", weight: "normal", style: "normal" },
    sizePt: 12,
    color: { r: 0, g: 0, b: 0 },
  });
  page0.appendRect({
    xPt: 5,
    yPt: 5,
    widthPt: 20,
    heightPt: 20,
    fill: { r: 1, g: 0, b: 0 },
  });
  const page1 = editor.appendPage();
  page1.appendImage({
    xPt: 0,
    yPt: 0,
    widthPt: 30,
    heightPt: 30,
    bytes: REAL_PNG_BYTES,
    format: "png",
  });
  return editor.toBytes();
}

describe("pdf-inspect (default plain-text report)", () => {
  it("reports the page count, per-page size and item-kind histogram, metadata, and images by format", async () => {
    const pdfPath = join(workspace, "multi-page.pdf");
    await writeFile(pdfPath, multiPagePdfBytes());

    const { exitCode, stdout, stderr } = await runCli(["pdf-inspect", pdfPath]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain("2 pages");
    expect(stdout).toMatch(/page 1: .*\(.*text=1.*rect=1.*\)/);
    expect(stdout).toContain("page 2:");
    expect(stdout).toContain("metadata:");
    expect(stdout).toContain("Inspectable");
    expect(stdout).toContain("images:");
    expect(stdout).toContain("png: 1");
  });

  it("uses the singular '1 page' and omits the histogram parenthetical for a page with no items, and omits the images section when the document embeds none", async () => {
    const pdfPath = join(workspace, "single-empty-page.pdf");
    await writeFile(pdfPath, createPdf().toBytes());

    const { exitCode, stdout } = await runCli(["pdf-inspect", pdfPath]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    expect(stdout).toContain("1 page\n");
    expect(stdout).toContain("page 1: 612pt x 792pt\n");
    expect(stdout).not.toContain("()");
    expect(stdout).not.toContain("images:");
  });

  it("reports an error and a non-zero exit code for input that is not a real PDF", async () => {
    const pdfPath = join(workspace, "not-a-pdf.pdf");
    await writeFile(pdfPath, new Uint8Array([1, 2, 3, 4]));

    const { exitCode, stderr } = await runCli(["pdf-inspect", pdfPath]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).not.toBe("");
  });
});

describe("pdf-inspect --json", () => {
  it("emits the page/histogram/metadata/image summary as parseable JSON", async () => {
    const pdfPath = join(workspace, "multi-page-json.pdf");
    await writeFile(pdfPath, multiPagePdfBytes());

    const { exitCode, stdout, stderr } = await runCli([
      "pdf-inspect",
      pdfPath,
      "--json",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      pageCount: 2,
      pages: [{ itemKinds: { text: 1, rect: 1 } }, { itemKinds: { image: 1 } }],
      imagesByFormat: { png: 1 },
    });
    expect(stdout).toContain('"title":"Inspectable"');
  });
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

    // `toEqual`, not `toStrictEqual`: a JSON round trip cannot distinguish an explicitly-`undefined` optional field (how `readPdf`'s own in-memory value carries an absent one) from a genuinely missing key (what `JSON.stringify`/`JSON.parse` produces for it instead) — an inherent property of JSON itself.
    expect(parsed).toEqual(readPdf(new Uint8Array(await readFile(pdfPath))));

    // The dump is the plain pdf-codec value — no $schema key exists for a LayoutDocument any more (the family moved to pdf-codec at document-schema.js 4.0.0 and lost its schema-stamped envelope), so asserting its absence pins the demotion against an accidental re-tag with a schema that no longer defines this kind.
    expect(parsed).not.toHaveProperty("$schema");
  });
});
