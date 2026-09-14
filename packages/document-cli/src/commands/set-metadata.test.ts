import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createOds,
  decodeDocumentPackage,
  decodePackage,
  odsToXlsx,
  readDocxContent,
  readDocxExtras,
  readOdsContent,
  readPdf,
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
import { buildDocxWithExtras } from "../test-support/docx-extras-fixture";
import {
  BODY_TEXT,
  buildDocxWithMetadata,
  buildPdfWithMetadata,
  METADATA_FIXTURE,
} from "../test-support/metadata-fixture";

// Drives the real assembled commander program end to end against real fixtures, proving all three write paths setDocumentMetadata resolves to for this command's single call site: the docx docProps/core.xml in-place patch (patchDocxMetadata, resolved internally whenever source and target are both docx), which must leave docx-extras' own data (comments, footnotes, headers/footers, numbering) completely untouched; the ContentDocument full rebuild every other rebuild format goes through (xlsx here, standing in for pptx/odt/odp/ods/odg/markdown, which all go through the identical readXContent -> buildXPackage shape); and the direct pdf metadata patch, which runs no layout engine at all and must leave every other page item untouched.

let savedExitCode: typeof process.exitCode;
let workspace: string;

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

const SHEET_CELL_TEXT = "A cell surviving an xlsx metadata patch";

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "document-cli-set-metadata-"));
  await writeFile(join(workspace, "source.docx"), buildDocxWithMetadata());
  await writeFile(join(workspace, "extras.docx"), buildDocxWithExtras());
  await writeFile(join(workspace, "source.pdf"), buildPdfWithMetadata());
  // setDocumentMetadata (documents.js) validates its own source/target format pair internally rather than the CLI pre-checking it, so the input file is now genuinely read before that rejection fires -- unlike a placeholder path, this needs to exist. Its content is never parsed: the rejection below fires purely on the '.odf' extension, before any real ODF decoding is attempted.
  await writeFile(join(workspace, "formula.odf"), new Uint8Array([0]));

  const odsEditor = createOds();
  const sheet = odsEditor.sheets()[0];
  if (sheet === undefined) {
    throw new Error("createOds() did not produce a default sheet");
  }
  sheet.cell(0, 0).value = { kind: "string", value: SHEET_CELL_TEXT };
  // See from-package.test.ts's own identical note: a cell()-materialized column/row otherwise reads back with no width/height style at all, which is irrelevant here but kept for consistency with the other xlsx fixture.
  sheet.setColumnWidth(0, 72);
  sheet.setRowHeight(0, 14);
  await writeFile(
    join(workspace, "source.xlsx"),
    odsToXlsx(odsEditor.toBytes()),
  );
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

describe("set-metadata", () => {
  it("patches a docx's own metadata in place, leaving everything else -- including the body paragraph -- untouched", async () => {
    const outputPath = join(workspace, "patched.docx");
    const { exitCode, stderr } = await runCli([
      "set-metadata",
      join(workspace, "source.docx"),
      outputPath,
      "--set-title",
      "New Title",
      "--set-keywords",
      " gamma, delta ,, ",
      "--quiet",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);

    const patched = readDocxContent(
      decodePackage(new Uint8Array(await readFile(outputPath))),
    );
    expect(patched.metadata.title).toBe("New Title");
    // Author/subject were never overridden, so they survive the merge from the source's own metadata.
    expect(patched.metadata.author).toBe(METADATA_FIXTURE.author);
    expect(patched.metadata.subject).toBe(METADATA_FIXTURE.subject);
    // --set-keywords splits on comma, trims, and drops empty entries.
    expect(patched.metadata.keywords).toStrictEqual(["gamma", "delta"]);
    // The paragraph itself survives the patch -- only metadata changed.
    expect(patched.kind).toBe("wordprocessing");
    const survived =
      patched.kind === "wordprocessing" &&
      patched.sections[0]?.blocks.some(
        (block) =>
          block.kind === "paragraph" &&
          block.runs.some((run) => run.text === BODY_TEXT),
      );
    expect(survived).toBe(true);
  });

  it("preserves docx-extras data (comments, footnotes, headers/footers, numbering) when patching a docx's metadata in place", async () => {
    const beforeBytes = new Uint8Array(
      await readFile(join(workspace, "extras.docx")),
    );
    const before = readDocxExtras(decodePackage(beforeBytes));
    expect(before.comments.length).toBeGreaterThan(0);
    expect(before.footnotes.length).toBeGreaterThan(0);
    expect(before.headerFooterParts.length).toBeGreaterThan(0);
    expect(Object.keys(before.numbering).length).toBeGreaterThan(0);

    const outputPath = join(workspace, "extras-patched.docx");
    const { exitCode } = await runCli([
      "set-metadata",
      join(workspace, "extras.docx"),
      outputPath,
      "--set-author",
      "New Author",
    ]);
    expect(exitCode).toBe(EXIT_SUCCESS);

    const after = readDocxExtras(
      decodePackage(new Uint8Array(await readFile(outputPath))),
    );
    expect(after).toStrictEqual(before);

    // The metadata edit itself still landed.
    const patchedContent = readDocxContent(
      decodePackage(new Uint8Array(await readFile(outputPath))),
    );
    expect(patchedContent.metadata.author).toBe("New Author");
  });

  it("patches a pdf directly, leaving every other page item byte-for-byte untouched", async () => {
    const sourceBytes = new Uint8Array(
      await readFile(join(workspace, "source.pdf")),
    );
    const sourceLayout = readPdf(sourceBytes);

    const outputPath = join(workspace, "patched.pdf");
    const { exitCode, stderr } = await runCli([
      "set-metadata",
      join(workspace, "source.pdf"),
      outputPath,
      "--set-subject",
      "A new subject",
      "--quiet",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);

    const patchedLayout = readPdf(new Uint8Array(await readFile(outputPath)));
    expect(patchedLayout.metadata.subject).toBe("A new subject");
    expect(patchedLayout.metadata.title).toBe(METADATA_FIXTURE.title);
    // No layout engine runs for the pdf path -- the page geometry and every item on it survive unchanged.
    expect(patchedLayout.pages).toStrictEqual(sourceLayout.pages);
  });

  it("patches an xlsx file in place now that documents.js wires a real xlsx content codec, leaving its cells untouched", async () => {
    // xlsx used to be rejected outright here -- documents.js's own DOCUMENT_FORMAT_CODECS registry gained a real xlsx content codec this session, and setDocumentMetadata now rebuilds xlsx through the identical readXContent -> buildXPackage shape every other REBUILD_FORMATS member already used.
    const outputPath = join(workspace, "rebuilt.xlsx");
    const { exitCode, stderr } = await runCli([
      "set-metadata",
      join(workspace, "source.xlsx"),
      outputPath,
      "--set-title",
      "New xlsx title",
      "--quiet",
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(EXIT_SUCCESS);

    // Round-trips the patched xlsx back through the real xlsx-to-ods bridge to prove the bytes are a genuine, readable xlsx workbook carrying both the new title and the original cell.
    const odsBackBytes = xlsxToOds(new Uint8Array(await readFile(outputPath)));
    const content = readOdsContent(decodeDocumentPackage("ods", odsBackBytes));
    if (content.kind !== "spreadsheet") {
      throw new Error(
        `expected a spreadsheet ContentDocument, got ${content.kind}`,
      );
    }
    expect(content.metadata.title).toBe("New xlsx title");
    expect(content.sheets[0]?.cells[0]?.value).toEqual({
      kind: "string",
      value: SHEET_CELL_TEXT,
    });
  });

  it("still rejects a cross-format request into xlsx -- set-metadata patches metadata in place, it does not convert format", async () => {
    const { exitCode, stderr } = await runCli([
      "set-metadata",
      join(workspace, "source.docx"),
      join(workspace, "never.xlsx"),
      "--set-title",
      "x",
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("does not convert format");
  });

  it("rejects a standalone odf formula document as a source, naming the missing write path", async () => {
    const { exitCode, stderr } = await runCli([
      "set-metadata",
      join(workspace, "formula.odf"),
      join(workspace, "never.odf"),
      "--set-title",
      "x",
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain(
      "'odf' (a standalone formula document) is not a supported setDocumentMetadata source or target",
    );
  });

  it("rejects a cross-format request -- set-metadata patches metadata in place, it does not convert format", async () => {
    const { exitCode, stderr } = await runCli([
      "set-metadata",
      join(workspace, "source.docx"),
      join(workspace, "never.odt"),
      "--set-title",
      "x",
    ]);

    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toContain("does not convert format");
  });

  it("rejects conflicting positional and --out destinations, naming both under the set-metadata command", async () => {
    const { exitCode, stderr } = await runCli([
      "set-metadata",
      join(workspace, "source.docx"),
      join(workspace, "positional.docx"),
      "--out",
      join(workspace, "flag.docx"),
      "--set-title",
      "x",
    ]);
    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toBe(
      `[set-metadata] conflicting output destinations: positional '${join(workspace, "positional.docx")}' and --out '${join(workspace, "flag.docx")}'\n`,
    );
  });

  it("fails with a usage error, prefixed under set-metadata, when the target format cannot be resolved at all", async () => {
    const { exitCode, stderr } = await runCli([
      "set-metadata",
      join(workspace, "source.docx"),
      "--set-title",
      "x",
    ]);
    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toBe(
      "[set-metadata] cannot infer a target format -- pass an output path with a recognised extension, --out with one, or --to <format>\n",
    );
  });

  it("fails with a usage error, prefixed under set-metadata, when the source format cannot be inferred", async () => {
    const unresolvedSource = join(workspace, "mystery.unknownext");
    await writeFile(unresolvedSource, "irrelevant");
    const { exitCode, stderr } = await runCli([
      "set-metadata",
      unresolvedSource,
      join(workspace, "never.docx"),
      "--set-title",
      "x",
    ]);
    expect(exitCode).not.toBe(EXIT_SUCCESS);
    expect(stderr).toBe(
      `[set-metadata] cannot infer a source format from '${unresolvedSource}'; rename the file with a recognised extension (docx, pptx, xlsx, odt, odp, ods, odg, svg, odf, csv, markdown, rtf, wpd, doc, xls, ppt, epub, pdf)\n`,
    );
  });

  it("registers set-metadata with its own description, help text, and every option", async () => {
    const command = createProgram().commands.find(
      (candidate) => candidate.name() === "set-metadata",
    );
    expect(command?.description()).toBe(
      "patch a document's own title/author/subject/keywords, leaving every other field and every other flag as-is",
    );

    // addHelpText's own "after" content is combined into the output only by outputHelp() (invoked here via --help through the real, assembled program), not by Command#helpInformation(), which renders only the built-in usage/options block.
    const { stdout } = await (async () => {
      const stdoutChunks: string[] = [];
      const stdoutSpy = vi
        .spyOn(process.stdout, "write")
        .mockImplementation((chunk) => {
          stdoutChunks.push(
            typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
          );
          return true;
        });
      try {
        await createProgram().parseAsync([
          "node",
          "document-cli",
          "set-metadata",
          "--help",
        ]);
      } catch {
        // exitOverride (program.ts) rethrows after writing help and setting process.exitCode -- the thrown CommanderError carries nothing this test needs.
      } finally {
        stdoutSpy.mockRestore();
      }
      return { stdout: stdoutChunks.join("") };
    })();

    expect(stdout).toContain(
      "Three write paths: a pdf source/target patches the metadata directly on the parsed PDF (writePdf), and a docx source/target",
    );
    expect(stdout).toContain(
      "patches docProps/core.xml directly on the decoded package -- both with no layout engine or ContentDocument rebuild involved",
    );
    expect(stdout).toContain(
      "at all, so everything else on the page (pdf) or in the package (docx -- comments, footnotes, headers/footers, numbering",
    );
    expect(stdout).toContain(
      "definitions included) survives byte-faithful. Every other supported format (pptx, xlsx, odt, odp, ods, odg, markdown, rtf)",
    );
    expect(stdout).toContain(
      "rebuilds a fresh package from that format's own ContentDocument instead.",
    );
    expect(stdout).toContain(
      "set-metadata does not convert format -- source and target must match. Run convert/from-package first, then",
    );
    expect(stdout).toContain(
      "set-metadata on the result, if you need a different target format.",
    );

    const longs = (command?.options ?? []).map((option) => option.long);
    expect(longs).toEqual(
      expect.arrayContaining([
        "--out",
        "--timeout",
        "--json",
        "--quiet",
        "--verbose",
        "--to",
        "--set-title",
        "--set-author",
        "--set-subject",
        "--set-keywords",
      ]),
    );
    const descriptionOf = (long: string): string | undefined =>
      command?.options.find((option) => option.long === long)?.description;
    expect(descriptionOf("--set-title")).toBe("set the title field");
    expect(descriptionOf("--set-author")).toBe("set the author field");
    expect(descriptionOf("--set-subject")).toBe("set the subject field");
    expect(descriptionOf("--set-keywords")).toBe(
      "set the keywords field, comma-separated (trimmed, empty entries dropped)",
    );
    expect(descriptionOf("--to")).toContain(
      "target format when it cannot be inferred from the output path",
    );
  });

  it("leaves metadata entirely unchanged when no --set-* flag is given at all", async () => {
    const outputPath = join(workspace, "untouched.docx");
    const { exitCode } = await runCli([
      "set-metadata",
      join(workspace, "source.docx"),
      outputPath,
    ]);

    expect(exitCode).toBe(EXIT_SUCCESS);
    const rebuilt = readDocxContent(
      decodePackage(new Uint8Array(await readFile(outputPath))),
    );
    expect(rebuilt.metadata.title).toBe(METADATA_FIXTURE.title);
    expect(rebuilt.metadata.author).toBe(METADATA_FIXTURE.author);
    expect(rebuilt.metadata.subject).toBe(METADATA_FIXTURE.subject);
    expect(rebuilt.metadata.keywords).toStrictEqual(METADATA_FIXTURE.keywords);
  });
});
