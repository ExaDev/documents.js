import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createDocx,
  createOdg,
  createOds,
  decodeDocumentPackage,
  openDocx,
  readOdsContent,
  xlsxToOds,
} from "documents.js";
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

// Drives the real assembled commander program end to end, closing the round trip --dump-package otherwise has no return path for: --dump-package writes the SOURCE document's own native DocumentTree (documents.js's readNativeDocumentTree), independent of --to/the output path (ExaDev/documents.js#823) -- a docx-to-pdf run's dump is a docx's native content-only tree (no pages, no frames: docx alone never runs a layout pass), while a pdf-sourced dump always carries pages/frames, since a PDF's native representation IS positioned layout. from-package reads that exact file back in via documentFromJson, and the docx it rebuilds from the package's own ContentDocument is opened again and checked for the original paragraph text -- proving the JSON this CLI writes is genuinely the JSON this CLI can read back, not just two independently-plausible-looking halves that happen to share a name.

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

const PARAGRAPH_TEXT =
  "A paragraph dumped to a DocumentTree and read back again";
const SHEET_CELL_TEXT = "A cell dumped to a DocumentTree and rebuilt as xlsx";

function docxWithParagraph(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: PARAGRAPH_TEXT });
  return editor.toBytes();
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-from-package-"));
  await writeFile(join(workspace, "source.docx"), docxWithParagraph());
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

describe("from-package", () => {
  it("reads a --dump-package JSON file back in and rebuilds a real docx from its ContentDocument", async () => {
    const packagePath = join(workspace, "dumped.package.json");
    const rebuiltPath = join(workspace, "rebuilt.docx");

    const dumpRun = await runCli([
      "docx-to-pdf",
      join(workspace, "source.docx"),
      join(workspace, "source.pdf"),
      "--dump-package",
      packagePath,
    ]);
    expect(dumpRun.exitCode).toBe(EXIT_SUCCESS);

    // The dumped file is tagged with a $schema documentFromJson can identify -- not merely well-formed JSON matching DocumentTree's own shape.
    const dumpedText = await readFile(packagePath, "utf-8");
    expect(dumpedText).toContain('"$schema"');
    expect(dumpedText).toContain("document-tree.schema.json");
    // The dump carries the tree form -- container groups under children -- but never the retired formatVersion integer or the old separate layout half. No pages/frames here: this is docx's own NATIVE tree (readNativeDocumentTree), read directly off the source bytes rather than captured from the docx-to-pdf conversion's own rendered layout pass -- see the test below for the pdf-sourced case, whose native tree does carry them.
    expect(dumpedText).toContain('"children"');
    expect(dumpedText).not.toContain('"pages"');
    expect(dumpedText).not.toContain('"frames"');
    expect(dumpedText).not.toContain('"formatVersion"');
    expect(dumpedText).not.toContain('"layout"');

    const fromPackageRun = await runCli([
      "from-package",
      packagePath,
      rebuiltPath,
    ]);
    expect(fromPackageRun.exitCode).toBe(EXIT_SUCCESS);

    const rebuilt = openDocx(new Uint8Array(await readFile(rebuiltPath)));
    const paragraphs = rebuilt.paragraphs();
    expect(
      paragraphs.some((paragraph) => paragraph.text === PARAGRAPH_TEXT),
    ).toBe(true);
  });

  it("rebuilds a pdf from a pdf source's own native frames and page sizes", async () => {
    const sourcePdfPath = join(workspace, "source-for-pdf-native.pdf");
    const packagePath = join(workspace, "dumped-for-pdf.package.json");
    const rebuiltPdfPath = join(workspace, "rebuilt.pdf");

    // A real pdf fixture, rendered from the shared docx -- its own bytes are not what --dump-package below reads from; that dump comes from the FOLLOWING pdf-to-docx run reading this pdf natively.
    const renderRun = await runCli([
      "docx-to-pdf",
      join(workspace, "source.docx"),
      sourcePdfPath,
    ]);
    expect(renderRun.exitCode).toBe(EXIT_SUCCESS);

    // pdf is the one DocumentFormat whose native tree always carries pages/frames -- reading it IS reconstruction from positioned layout (readNativeDocumentTree's pdf branch, the identical reconstruction pdf-to-docx's own conversion runs) -- so a pdf-sourced --dump-package dump is the correct fixture for a from-package pdf rebuild (documents.js's layoutDocumentFromPackage -> writePdf), unlike the docx-sourced dump the test above covers (content-only, no pages/frames at all).
    const dumpRun = await runCli([
      "pdf-to-docx",
      sourcePdfPath,
      join(workspace, "unused-pdf-to-docx.docx"),
      "--dump-package",
      packagePath,
    ]);
    expect(dumpRun.exitCode).toBe(EXIT_SUCCESS);

    const dumpedText = await readFile(packagePath, "utf-8");
    expect(dumpedText).toContain('"pages"');
    expect(dumpedText).toContain('"frames"');

    const fromPackageRun = await runCli([
      "from-package",
      packagePath,
      rebuiltPdfPath,
    ]);
    expect(fromPackageRun.exitCode).toBe(EXIT_SUCCESS);

    const rebuiltPdfBytes = new Uint8Array(await readFile(rebuiltPdfPath));
    expect(rebuiltPdfBytes.byteLength).toBeGreaterThan(0);
    // The minimal honest check on the rebuilt pdf itself: a real PDF file, not an empty or mislabelled write.
    expect(rebuiltPdfBytes[0]).toBe(0x25); // '%'
    expect(new TextDecoder().decode(rebuiltPdfBytes.subarray(0, 5))).toBe(
      "%PDF-",
    );
  });

  it("infers the target format from the output extension, matching --to explicitly given", async () => {
    const packagePath = join(workspace, "dumped-for-markdown.package.json");
    await runCli([
      "docx-to-pdf",
      join(workspace, "source.docx"),
      join(workspace, "unused.pdf"),
      "--dump-package",
      packagePath,
    ]);

    const viaExtension = join(workspace, "via-extension.md");
    const viaToOutput = join(workspace, "via-to-output");

    expect(
      (await runCli(["from-package", packagePath, viaExtension])).exitCode,
    ).toBe(EXIT_SUCCESS);
    expect(
      (
        await runCli([
          "from-package",
          packagePath,
          viaToOutput,
          "--to",
          "markdown",
        ])
      ).exitCode,
    ).toBe(EXIT_SUCCESS);

    const viaExtensionText = await readFile(viaExtension, "utf-8");
    expect(viaExtensionText).toContain(PARAGRAPH_TEXT);
    const viaToText = await readFile(viaToOutput, "utf-8");
    expect(viaToText).toBe(viaExtensionText);
  });

  it("fails with a usage error naming the incompatible target when a package built from wordprocessing content is asked for a spreadsheet format", async () => {
    const packagePath = join(workspace, "dumped-for-ods.package.json");
    await runCli([
      "docx-to-pdf",
      join(workspace, "source.docx"),
      join(workspace, "unused2.pdf"),
      "--dump-package",
      packagePath,
    ]);

    const { exitCode, stderr } = await runCli([
      "from-package",
      packagePath,
      join(workspace, "never-written.ods"),
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("requires a");
  });

  it("builds a real xlsx from a spreadsheet-kind DocumentTree now that documents.js wires a real xlsx content codec", async () => {
    // xlsx used to be rejected outright here -- documents.js's own DOCUMENT_FORMAT_CODECS registry gained a real xlsx content codec (wrapping ooxml.js's readXlsxContent/buildXlsxPackage) this session, and buildDocumentBytes was simplified to dispatch through it like every other format instead of naming xlsx as a special exception.
    const sheetPath = join(workspace, "source-for-xlsx.ods");
    const editor = createOds();
    // createOds() already starts with one default sheet -- reuse it rather than addSheet('Sheet1'), which would create a second, identically-named sheet and leave the first (empty) one at sheets[0].
    const sheet = editor.sheets()[0];
    if (sheet === undefined) {
      throw new Error("createOds() did not produce a default sheet");
    }
    sheet.cell(0, 0).value = { kind: "string", value: SHEET_CELL_TEXT };
    // A cell()-materialized column/row otherwise reads back with no width/height style at all (widthPt/heightPt 0), which fails DocumentTree's own schema validation once the dumped package round-trips through JSON below.
    sheet.setColumnWidth(0, 72);
    sheet.setRowHeight(0, 14);
    await writeFile(sheetPath, editor.toBytes());

    const packagePath = join(workspace, "dumped-for-xlsx.package.json");
    await runCli([
      "ods-to-pdf",
      sheetPath,
      join(workspace, "unused3.pdf"),
      "--dump-package",
      packagePath,
    ]);

    const xlsxPath = join(workspace, "rebuilt.xlsx");
    const { exitCode } = await runCli(["from-package", packagePath, xlsxPath]);
    expect(exitCode).toBe(EXIT_SUCCESS);

    // Round-trips the rebuilt xlsx back through the real xlsx-to-ods bridge to prove the bytes are a genuine, readable xlsx workbook carrying the original cell, not just a file that happened to get written.
    const xlsxBytes = new Uint8Array(await readFile(xlsxPath));
    const odsBackBytes = xlsxToOds(xlsxBytes);
    const content = readOdsContent(decodeDocumentPackage("ods", odsBackBytes));
    if (content.kind !== "spreadsheet") {
      throw new Error(
        `expected a spreadsheet ContentDocument, got ${content.kind}`,
      );
    }
    expect(content.sheets[0]?.cells[0]?.value).toEqual({
      kind: "string",
      value: SHEET_CELL_TEXT,
    });
  });

  it("fails with a usage error when the positional output and --out disagree, and succeeds when they agree", async () => {
    const packagePath = join(workspace, "dumped-for-conflict.package.json");
    await runCli([
      "docx-to-pdf",
      join(workspace, "source.docx"),
      join(workspace, "unused-conflict.pdf"),
      "--dump-package",
      packagePath,
    ]);

    const disagreeing = await runCli([
      "from-package",
      packagePath,
      join(workspace, "one.docx"),
      "--out",
      join(workspace, "other.docx"),
    ]);
    expect(disagreeing.exitCode).not.toBe(EXIT_SUCCESS);
    expect(disagreeing.stderr).toContain("[from-package]");
    expect(disagreeing.stderr).toContain("conflicting output destinations");

    const agreedPath = join(workspace, "agreed.docx");
    const agreeing = await runCli([
      "from-package",
      packagePath,
      agreedPath,
      "--out",
      agreedPath,
    ]);
    expect(agreeing.exitCode).toBe(EXIT_SUCCESS);
    expect(agreeing.stderr).not.toContain("conflicting output destinations");
  });

  it("writes to the path named by --out when no positional output is given", async () => {
    const packagePath = join(workspace, "dumped-for-out-flag.package.json");
    await runCli([
      "docx-to-pdf",
      join(workspace, "source.docx"),
      join(workspace, "unused-out-flag.pdf"),
      "--dump-package",
      packagePath,
    ]);

    const output = join(workspace, "via-out-flag.docx");
    const { exitCode } = await runCli([
      "from-package",
      packagePath,
      "--out",
      output,
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);
    const rebuilt = openDocx(new Uint8Array(await readFile(output)));
    expect(
      rebuilt
        .paragraphs()
        .some((paragraph) => paragraph.text === PARAGRAPH_TEXT),
    ).toBe(true);
  });

  it("builds real csv output from a spreadsheet-kind DocumentTree, threading --delimiter through", async () => {
    const sheetPath = join(workspace, "source-for-csv.ods");
    const editor = createOds();
    const sheet = editor.sheets()[0];
    if (sheet === undefined) {
      throw new Error("createOds() did not produce a default sheet");
    }
    sheet.cell(0, 0).value = { kind: "string", value: "A" };
    sheet.cell(0, 1).value = { kind: "string", value: "B" };
    sheet.setColumnWidth(0, 72);
    sheet.setColumnWidth(1, 72);
    sheet.setRowHeight(0, 14);
    await writeFile(sheetPath, editor.toBytes());

    const packagePath = join(workspace, "dumped-for-csv.package.json");
    await runCli([
      "ods-to-pdf",
      sheetPath,
      join(workspace, "unused-csv.pdf"),
      "--dump-package",
      packagePath,
    ]);

    const csvPath = join(workspace, "rebuilt.csv");
    const csvRun = await runCli([
      "from-package",
      packagePath,
      csvPath,
      "--delimiter",
      ";",
    ]);
    expect(csvRun.exitCode).toBe(EXIT_SUCCESS);
    const csvText = await readFile(csvPath, "utf-8");
    expect(csvText).toContain("A;B");
  });

  it("builds real svg output from a drawing-kind DocumentTree, threading --page through", async () => {
    const drawingPath = join(workspace, "source-for-svg.odg");
    const editor = createOdg();
    editor.addPage();
    editor.pages()[0]?.addRect({
      frame: { xPt: 5, yPt: 5, widthPt: 40, heightPt: 30 },
      fill: { r: 1, g: 0, b: 0 },
    });
    await writeFile(drawingPath, editor.toBytes());

    const packagePath = join(workspace, "dumped-for-svg.package.json");
    await runCli([
      "odg-to-pdf",
      drawingPath,
      join(workspace, "unused-svg.pdf"),
      "--dump-package",
      packagePath,
    ]);

    const svgPath = join(workspace, "rebuilt.svg");
    const svgRun = await runCli([
      "from-package",
      packagePath,
      svgPath,
      "--page",
      "0",
    ]);
    expect(svgRun.exitCode).toBe(EXIT_SUCCESS);
    const svgText = await readFile(svgPath, "utf-8");
    expect(svgText).toContain("<svg");
  });

  it("emits a JSON summary under --json and stays silent under --quiet", async () => {
    const packagePath = join(workspace, "dumped-for-json-quiet.package.json");
    await runCli([
      "docx-to-pdf",
      join(workspace, "source.docx"),
      join(workspace, "unused-json-quiet.pdf"),
      "--dump-package",
      packagePath,
    ]);

    const jsonOutput = join(workspace, "via-json.docx");
    const jsonRun = await runCli([
      "from-package",
      packagePath,
      jsonOutput,
      "--json",
    ]);
    expect(jsonRun.exitCode).toBe(EXIT_SUCCESS);
    const summary: unknown = JSON.parse(jsonRun.stderr);
    expect(summary).toMatchObject({ output: jsonOutput });

    const quietOutput = join(workspace, "via-quiet.docx");
    const quietRun = await runCli([
      "from-package",
      packagePath,
      quietOutput,
      "--quiet",
    ]);
    expect(quietRun.exitCode).toBe(EXIT_SUCCESS);
    expect(quietRun.stderr).toBe("");
  });

  it("rejects input bytes that are not valid UTF-8", async () => {
    const invalidUtf8Path = join(workspace, "invalid-utf8.package.json");
    // A lone continuation byte (0x80) is never valid at the start of a UTF-8 sequence -- TextDecoder("utf-8", { fatal: true }) throws on it rather than silently substituting U+FFFD.
    await writeFile(invalidUtf8Path, new Uint8Array([0x7b, 0x80, 0x7d]));

    const { exitCode, stderr } = await runCli([
      "from-package",
      invalidUtf8Path,
      join(workspace, "never-written-utf8.docx"),
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("not valid");
  });

  it("rejects a DocumentTree dump whose $schema pins a document-schema.js major other than the installed one", async () => {
    const mismatchPath = join(workspace, "version-mismatch.package.json");
    // A real document-tree.schema.json $schema URI (so it clears the rename/demotion tombstones and reaches the version gate) pinned to major 6 -- a major this workspace's installed document-schema.js (7.x) never was, so it can never accidentally stop mismatching the way a hardcoded "installed - 1" could coincide with a real future install.
    const mismatchDump = {
      $schema:
        "https://cdn.jsdelivr.net/npm/document-schema.js@6.0.0/schemas/document-tree.schema.json",
      children: [],
    };
    await writeFile(mismatchPath, JSON.stringify(mismatchDump, undefined, 2));

    const { exitCode, stderr } = await runCli([
      "from-package",
      mismatchPath,
      join(workspace, "never-written-mismatch.docx"),
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("document-schema.js@6.0.0");
    expect(stderr).toContain("reads only @");
    expect(stderr).toContain("-major dumps");
    expect(stderr).toContain("--dump-package");
  });

  it("rejects a plain JSON file with no recognised $schema", async () => {
    const plainPath = join(workspace, "plain.json");
    await writeFile(plainPath, JSON.stringify({ hello: "world" }));

    const { exitCode, stderr } = await runCli([
      "from-package",
      plainPath,
      join(workspace, "never-written2.docx"),
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("no recognised $schema");
  });

  it("rejects 'pdf' as the target when the dumped package came from a bridge conversion with no page sizes at all", async () => {
    const packagePath = join(workspace, "dumped-from-bridge.package.json");
    // odt (like every non-pdf source) reads its own native ContentDocument with no layout pass at all -- --dump-package always carries pages/frames for a pdf source and never for any other, regardless of which conversion (odt-to-docx here) --dump-package rides alongside -- unlike the pdf-sourced dump the earlier test uses.
    await runCli([
      "docx-to-odt",
      join(workspace, "source.docx"),
      join(workspace, "source.odt"),
    ]);
    const bridgeRun = await runCli([
      "odt-to-docx",
      join(workspace, "source.odt"),
      join(workspace, "unused-bridge.docx"),
      "--dump-package",
      packagePath,
    ]);
    expect(bridgeRun.exitCode).toBe(EXIT_SUCCESS);

    const { exitCode, stderr } = await runCli([
      "from-package",
      packagePath,
      join(workspace, "never-written4.pdf"),
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("this DocumentTree has no pages");
  });

  it("rejects a pre-4.0.0 flat-shape dump (a documents.js 2.x --dump-package file) through the rename tombstone, naming DocumentTree and the remedy", async () => {
    const oldDumpPath = join(workspace, "old-flat.package.json");
    // A user-provided old dump: the exact shape documents.js 2.x wrote via --dump-package -- $schema-tagged by a document-schema.js 3.x release, the flat { formatVersion, content, pages } envelope under the document-package.schema.json name every release before ExaDev/documents.js#661's rename used. Hand-built here rather than generated, since nothing in this tree can still produce that shape; documentFromJson's rename tombstone refuses any document-package-stemmed URI outright, by name alone -- it never even reaches the version-major gate, so the body's own fields never reach schema validation either.
    const oldDump = {
      $schema:
        "https://cdn.jsdelivr.net/npm/document-schema.js@3.9.9/schemas/document-package.schema.json",
      formatVersion: 2,
      content: {
        kind: "wordprocessing",
        formatVersion: 2,
        metadata: {},
        sections: [
          {
            blocks: [
              {
                kind: "paragraph",
                styleId: "Heading1",
                runs: [{ text: PARAGRAPH_TEXT }],
              },
            ],
          },
        ],
      },
      pages: [{ widthPt: 595, heightPt: 842 }],
    };
    await writeFile(oldDumpPath, JSON.stringify(oldDump, undefined, 2));

    const { exitCode, stderr } = await runCli([
      "from-package",
      oldDumpPath,
      join(workspace, "never-written5.docx"),
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    // The readable surfacing of DocumentPackageRenamedError: the rename itself and the CLI's own remedy -- no specific pinned version, since the tombstone fires identically for every document-package-stemmed release.
    expect(stderr).toContain("DocumentPackage was renamed to DocumentTree");
    expect(stderr).toContain("--dump-package");
  });

  it("rejects a formatVersion 1 dump (a documents.js 1.x --dump-package file) through the same rename tombstone", async () => {
    const v1DumpPath = join(workspace, "old-v1.package.json");
    // The oldest shape out there: formatVersion 1, content plus a separate layout half, tagged by a document-schema.js 1.x release -- also under the document-package.schema.json name, so it hits the identical rename tombstone the 2.x dump above does, regardless of how much further back its own shape sits.
    const v1Dump = {
      $schema:
        "https://cdn.jsdelivr.net/npm/document-schema.js@1.9.9/schemas/document-package.schema.json",
      formatVersion: 1,
      content: {
        kind: "wordprocessing",
        formatVersion: 2,
        metadata: {},
        sections: [
          { blocks: [{ kind: "paragraph", runs: [{ text: PARAGRAPH_TEXT }] }] },
        ],
      },
      layout: {
        formatVersion: 1,
        metadata: {},
        images: {},
        pages: [{ widthPt: 595, heightPt: 842, items: [] }],
      },
    };
    await writeFile(v1DumpPath, JSON.stringify(v1Dump, undefined, 2));

    const { exitCode, stderr } = await runCli([
      "from-package",
      v1DumpPath,
      join(workspace, "never-written6.docx"),
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("DocumentPackage was renamed to DocumentTree");
    expect(stderr).toContain("--dump-package");
  });

  it("rejects a layout-document dump (an old pdf-inspect --full output) with the demotion pointer", async () => {
    const layoutDumpPath = join(workspace, "old-layout.dump.json");
    // A document-schema.js 3.x layoutDocumentWithSchema artefact: documentFromJson answers its URI with the LayoutSchemaDemotedError tombstone (the kind moved to pdf-codec), which this command surfaces as its own readable line rather than an unrecognised-schema wall.
    const layoutDump = {
      $schema:
        "https://cdn.jsdelivr.net/npm/document-schema.js@3.9.9/schemas/layout-document.schema.json",
      formatVersion: 1,
      metadata: {},
      images: {},
      pages: [],
    };
    await writeFile(layoutDumpPath, JSON.stringify(layoutDump, undefined, 2));

    const { exitCode, stderr } = await runCli([
      "from-package",
      layoutDumpPath,
      join(workspace, "never-written7.docx"),
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("LayoutDocument dump");
    expect(stderr).toContain("pdf-codec");
  });
});
