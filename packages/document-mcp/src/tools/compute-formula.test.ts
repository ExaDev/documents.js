import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { assembleTree } from "document-schema.js";
import {
  buildDocumentBytes,
  buildFormulaBlock,
  bytesToBase64,
  createDocx,
  createOds,
  formulaDocument,
  latexToFormula,
} from "documents.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createServer } from "../server";
import { odfFormulaBytes } from "../test-support/odf-formula-fixture";
import { ComputeFormulaOutputSchema } from "./compute-formula";

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- proving compute_formula is registered under that name, reads a document's real embedded formulas via documents.js's own readNativeDocumentTree + document-schema.js's flattenTree + documents.js's shared collectDocumentFormulas walk, and evaluates each through a real document-compute.js evaluate() call. Mirrors src/tools/metadata.test.ts's own connection harness.

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({
    name: "compute-formula-test-client",
    version: "0.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, close: async () => client.close() };
}

// A tool result's structuredContent is typed `unknown` on the wire -- ComputeFormulaOutputSchema.parse narrows it in one call rather than an isRecord guard plus a manual field-by-field cast (ExaDev/documents.js#928's round-1 review, defect 3: compute_formula declared no outputSchema at all).
function structuredContentOf(result: { structuredContent?: unknown }) {
  return ComputeFormulaOutputSchema.parse(result.structuredContent);
}

// One $$ ... $$ fenced display-math block, matching markdown-codec's own block grammar (the delimiter must be alone on its own line) -- the identical helper document-compute.js's own harness/corpus.test.ts uses to build its markdown fixtures.
function mathBlock(latex: string): string {
  return `$$\n${latex}\n$$`;
}

function markdownBytes(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

describe("compute_formula", () => {
  let workspace: string;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-mcp-compute-formula-"));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  let pair: ConnectedPair;

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  it("evaluates a fully closed formula with no bindings required", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: {
          bytesBase64: markdownBytes(mathBlock("2 + 3")),
          format: "markdown",
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = structuredContentOf(result);
    expect(output.sourceFormat).toBe("markdown");
    expect(output.documentKind).toBe("wordprocessing");
    expect(output.formulaCount).toBe(1);
    const [entry] = output.formulas;
    if (entry === undefined) {
      throw new Error("expected one formula entry");
    }
    expect(entry.outcome.status).toBe("evaluated");
    expect(entry.outcome).toEqual({
      status: "evaluated",
      result: { kind: "quantity", magnitude: 5, dimension: {} },
    });

    // content mirrors structuredContent as JSON text -- the same convention every other tool in this package follows.
    const [block] = result.content;
    expect(block?.type).toBe("text");
    expect(block?.type === "text" ? JSON.parse(block.text) : undefined).toEqual(
      result.structuredContent,
    );
  });

  // ExaDev/documents.js#928 round-5 review: lowerMarkdownMath (documents.js's src/markdown/math.ts) stamps the identical constant sourcePath "markdown:math-block" on every display formula it lowers -- markdown is also the only format whose formulas ever reach an "evaluated" outcome, so a two-equation markdown document is the tool's own primary real-world use case, not an edge case. A caller distinguishing formulas by sourcePath alone cannot tell these two apart; locate must differ.
  it("distinguishes two formulas in one markdown document by locate, even though both share the identical sourcePath markdown stamps on every display formula", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: {
          bytesBase64: markdownBytes(
            `${mathBlock("2 + 3")}\n\n${mathBlock("10 - 4")}`,
          ),
          format: "markdown",
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = structuredContentOf(result);
    expect(output.formulaCount).toBe(2);
    const [first, second] = output.formulas;
    if (first === undefined || second === undefined) {
      throw new Error("expected two formula entries");
    }
    // The actual collision this test guards against: both entries share the one constant sourcePath lowerMarkdownMath stamps on every markdown display formula.
    expect(first.sourcePath).toBe("markdown:math-block");
    expect(second.sourcePath).toBe("markdown:math-block");
    expect(first.sourcePath).toBe(second.sourcePath);
    // locate is the reliable per-formula identifier -- distinct here, not merely by array index.
    expect(typeof first.locate).toBe("string");
    expect(typeof second.locate).toBe("string");
    expect(first.locate).not.toBe(second.locate);
    expect(first.outcome).toEqual({
      status: "evaluated",
      result: { kind: "quantity", magnitude: 5, dimension: {} },
    });
    expect(second.outcome).toEqual({
      status: "evaluated",
      result: { kind: "quantity", magnitude: 6, dimension: {} },
    });
  });

  it("evaluates a formula referencing symbols once their values are supplied via bindings", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: {
          bytesBase64: markdownBytes(mathBlock("m \\times a")),
          format: "markdown",
        },
        bindings: {
          "symbols:m": {
            kind: "quantity",
            magnitude: 2,
            dimension: { mass: 1 },
          },
          "symbols:a": {
            kind: "quantity",
            magnitude: 3,
            dimension: { length: 1, time: -2 },
          },
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = structuredContentOf(result);
    const [entry] = output.formulas;
    if (entry === undefined) {
      throw new Error("expected one formula entry");
    }
    expect(entry.outcome).toEqual({
      status: "evaluated",
      result: {
        kind: "quantity",
        magnitude: 6,
        dimension: { mass: 1, length: 1, time: -2 },
      },
    });
  });

  it("reports an UnboundSymbolError outcome for a symbol-referencing formula with no bindings supplied, without failing the whole call", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: {
          bytesBase64: markdownBytes(mathBlock("m \\times a")),
          format: "markdown",
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = structuredContentOf(result);
    const [entry] = output.formulas;
    if (entry?.outcome.status !== "error") {
      throw new Error("expected one error outcome");
    }
    expect(entry.outcome.errorType).toBe("UnboundSymbolError");
    expect(entry.outcome.message).toContain("symbols:m");
  });

  it("reports a no-content outcome for a formula whose semantic layer was never lowered, from a standalone odf formula document", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: {
          bytesBase64: bytesToBase64(odfFormulaBytes()),
          format: "odf",
        },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = structuredContentOf(result);
    expect(output.documentKind).toBe("formula");
    expect(output.formulaCount).toBe(1);
    const [entry] = output.formulas;
    if (entry === undefined) {
      throw new Error("expected one formula entry");
    }
    expect(entry.outcome.status).toBe("no-content");
    // A standalone formula document has no embedding block, so there is no sourcePath to report.
    expect(entry.sourcePath).toBeUndefined();
  });

  it("returns an empty formula list, not an error, for a document with no formulas at all", async () => {
    const sourcePath = join(workspace, "no-formulas.docx");
    await writeFile(sourcePath, createDocx().toBytes());

    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: { source: { path: sourcePath } },
    });

    expect(result.isError).toBeFalsy();
    const output = structuredContentOf(result);
    expect(output.sourceFormat).toBe("docx");
    expect(output.formulaCount).toBe(0);
    expect(output.formulas).toEqual([]);
  });

  // ExaDev/documents.js#928's round-1 review, defect 1: a real .ods carrying a cell-anchored formula object used to report formulaCount: 0, because compute-formula.ts's own walk had a no-op `case "spreadsheet": break`. The fix moved the whole walk into documents.js's shared collectDocumentFormulas, which does walk a sheet's own embeddedObjects array -- this drives that fix through a real .ods built by OdsSheet.addEmbeddedObject (documents.js's own ODS editor), not just a recompiled unit test, so a regression here would mean the real read path, not just the type, is broken again.
  it("walks a spreadsheet's own cell-anchored formula object, from a real .ods", async () => {
    const editor = createOds();
    const sheet = editor.sheets()[0];
    if (sheet === undefined) {
      throw new Error("createOds() did not produce a default sheet");
    }
    sheet.addEmbeddedObject({
      objectKind: "formula",
      document: formulaDocument({ mathml: [] }),
      frame: { xPt: 10, yPt: 10, widthPt: 30, heightPt: 15 },
      anchorRow: 3,
      anchorColumn: 2,
    });

    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: { bytesBase64: bytesToBase64(editor.toBytes()), format: "ods" },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = structuredContentOf(result);
    expect(output.sourceFormat).toBe("ods");
    expect(output.documentKind).toBe("spreadsheet");
    expect(output.formulaCount).toBe(1);
    const [entry] = output.formulas;
    if (entry === undefined) {
      throw new Error("expected one formula entry");
    }
    // A sheet's own embeddedObjects entries are a bare ContentEmbeddedObject, never wrapped in a ContentEmbeddedObjectBlock -- structurally no sourcePath field to report, not merely an unassigned one.
    expect(entry.sourcePath).toBeUndefined();
    // odf.js's own formula sub-document carries MathML/StarMath only -- no semantic MathExpression layer survives a real .ods round trip, so this is a no-content outcome rather than an evaluated one, exactly like the standalone .odf case above.
    expect(entry.outcome.status).toBe("no-content");
  });

  // The presentation-slide-shape arm of the same walk, driven through a real pptx: buildPptxPackage's own appendShape writes a shape whose sole block is a formula embeddedObject as a real OOXML equation (PptxShape.appendOfficeMath), so this is a genuine byte-level round trip, not a hand-built ContentDocument fed straight to the walk.
  it("walks a presentation slide's own shape, from a real pptx", async () => {
    const formula = latexToFormula("x^2", {
      source: "test:compute-formula",
    }).formula;
    const tree = assembleTree({
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          notes: "",
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 40 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [
                buildFormulaBlock(
                  formula,
                  { xPt: 0, yPt: 0, widthPt: 200, heightPt: 40 },
                  "test:compute-formula",
                ),
              ],
            },
          ],
        },
      ],
    });
    const pptxBytes = buildDocumentBytes(tree, "pptx");

    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: { bytesBase64: bytesToBase64(pptxBytes), format: "pptx" },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = structuredContentOf(result);
    expect(output.sourceFormat).toBe("pptx");
    expect(output.documentKind).toBe("presentation");
    expect(output.formulaCount).toBe(1);
    const [entry] = output.formulas;
    if (entry === undefined) {
      throw new Error("expected one formula entry");
    }
    // readPptxContent's own source-path assignment (ooxml.js's typed/shared/source-path.ts) reaches a slide shape's own blocks -- unlike the standalone-formula and spreadsheet cases above, this block genuinely has one.
    expect(typeof entry.sourcePath).toBe("string");
    // Real OOXML math (OMML) round-trips MathML, not the documents.js-internal LaTeX/MathExpression two-layer model -- no on-disk OOXML construct carries either, so this is a no-content outcome, exactly like the pptx-adjacent standalone-formula and spreadsheet cases above.
    expect(entry.outcome.status).toBe("no-content");
  });

  // The table-cell-recursion and drawing-page arms of the same walk have no real per-format writer to round-trip through today: every table-cell writer in this package (docx/odt) and the odg drawing-page shape writer silently skip a non-paragraph/non-image block (see documents.js's own src/model/formula.test.ts, which is where those two arms are exercised directly against collectDocumentFormulas instead). This test at least proves the tool-level plumbing end to end for the one construct docx CAN carry a formula through -- a section-level embeddedObject block, structurally identical to the block a table cell would hold if any writer produced one -- via a real docx byte round trip, not a hand-built ContentDocument fed straight to the tool's own read path.
  it("walks a wordprocessing section's own embeddedObject block, from a real docx", async () => {
    const formula = latexToFormula("a + b", {
      source: "test:compute-formula",
    }).formula;
    const tree = assembleTree({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 595, heightPt: 842 },
          margins: { topPt: 20, rightPt: 20, bottomPt: 20, leftPt: 20 },
          blocks: [
            buildFormulaBlock(
              formula,
              { xPt: 0, yPt: 0, widthPt: 0, heightPt: 22 },
              "test:compute-formula",
            ),
          ],
        },
      ],
    });
    const docxBytes = buildDocumentBytes(tree, "docx");

    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: { bytesBase64: bytesToBase64(docxBytes), format: "docx" },
      },
    });

    expect(result.isError).toBeFalsy();
    const output = structuredContentOf(result);
    expect(output.documentKind).toBe("wordprocessing");
    expect(output.formulaCount).toBe(1);
    expect(output.formulas[0]?.outcome.status).toBe("no-content");
  });

  it("surfaces a read failure as an isError result, exactly like every other document-input tool", async () => {
    const result = await pair.client.callTool({
      name: "compute_formula",
      arguments: {
        source: { path: join(workspace, "does-not-exist.docx") },
      },
    });

    expect(result.isError).toBe(true);
    const [block] = result.content;
    expect(block?.type).toBe("text");
  });
});
