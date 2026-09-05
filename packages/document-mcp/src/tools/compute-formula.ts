import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { evaluate, type EvaluationResult } from "document-compute.js";
import {
  flattenTree,
  FormulaBindingsSchema,
  type ContentBlock,
  type ContentDocument,
  type ContentFormula,
  type FormulaBindings,
  type SymbolTable,
} from "document-schema.js";
import { formulaOfBlock, readNativeDocumentTree } from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";

// ExaDev/documents.js#928: document-compute.js's evaluate() had no consumer anywhere in the family. This tool is the first one -- reading a document's own embedded formulas (ContentFormula.content, the MathExpression semantic layer beside its LaTeX/MathML presentation) and evaluating each through document-compute.js, so an agent can ask "does this document's arithmetic actually check out" without hand-walking the schema itself.

function toErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

interface FormulaEntry {
  readonly formula: ContentFormula;
  // The embedding block's own sourcePath, when the source format assigns one -- undefined for the standalone 'formula' document kind, which has no embedding block at all.
  readonly sourcePath: string | undefined;
}

// Recurses into table cells exactly like document-compute.js's own harness/corpus.ts collectFormulasFromBlocks -- a table cell is block-flow content like any other, and a formula can sit inside one.
function collectFormulaBlocks(
  blocks: readonly ContentBlock[],
  out: FormulaEntry[],
): void {
  for (const block of blocks) {
    if (block.kind === "table") {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          collectFormulaBlocks(cell.blocks, out);
        }
      }
      continue;
    }
    if (block.kind === "embeddedObject") {
      const formula = formulaOfBlock(block);
      if (formula !== undefined) {
        out.push({ formula, sourcePath: block.sourcePath });
      }
    }
  }
}

// Every place document-schema.js's own content model lets a ContentFormula travel: a wordprocessing section's block flow, a presentation slide's or drawing page's own shape's block flow (both structurally identical to a section's, per ContentShapeSchema/ContentEmbeddedObjectBlock's own comments -- "the block-level anchoring point for an embedded object inside a wordprocessing section's or a presentation/drawing shape's own block flow"), and the standalone 'formula' document kind, whose single child IS the formula rather than a block wrapping one. A spreadsheet's cell-anchored embedded objects (ContentSheetSchema.embeddedObjects) are the one shape this does not walk: they carry a bare ContentEmbeddedObject, not a ContentEmbeddedObjectBlock, so they have no block flow and no sourcePath to report -- a genuinely different case from the four handled here, not an oversight.
function collectDocumentFormulas(document: ContentDocument): FormulaEntry[] {
  const out: FormulaEntry[] = [];
  switch (document.kind) {
    case "wordprocessing":
      for (const section of document.sections) {
        collectFormulaBlocks(section.blocks, out);
      }
      break;
    case "presentation":
      for (const slide of document.slides) {
        for (const shape of slide.shapes) {
          collectFormulaBlocks(shape.blocks, out);
        }
      }
      break;
    case "drawing":
      for (const page of document.pages) {
        for (const shape of page.shapes) {
          collectFormulaBlocks(shape.blocks, out);
        }
      }
      break;
    case "spreadsheet":
      break;
    case "formula":
      out.push({ formula: document.formula, sourcePath: undefined });
      break;
  }
  return out;
}

// evaluate()'s own contract (document-compute.js's compute/evaluate.ts) is a plain Quantity | Interval on success and a thrown, named Error subclass on every real failure -- never a `{ ok, error }` wrapper. This mirrors that one level up: a per-formula outcome, not a per-formula exception, so one formula referencing an unbound symbol never aborts every other formula's result in the same document.
type FormulaOutcome =
  | { readonly status: "evaluated"; readonly result: EvaluationResult }
  // ContentFormulaSchema's own field comment: "Absent means nobody has lowered this formula to semantics yet" -- a real, distinct outcome, not a failure to evaluate.
  | { readonly status: "no-content" }
  | {
      readonly status: "error";
      readonly errorType: string;
      readonly message: string;
    };

function evaluateFormula(
  formula: ContentFormula,
  bindings: FormulaBindings,
  symbolTable: SymbolTable | undefined,
): FormulaOutcome {
  if (formula.content === undefined) {
    return { status: "no-content" };
  }
  try {
    return {
      status: "evaluated",
      result: evaluate(formula.content, bindings, symbolTable),
    };
  } catch (error) {
    return {
      status: "error",
      errorType: error instanceof Error ? error.name : String(error),
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerComputeFormulaTools(server: McpServer): void {
  server.registerTool(
    "compute_formula",
    {
      title: "Compute document formulas",
      description:
        "Reads every formula a document embeds (docx/odt/markdown/rtf paragraphs, pptx/odp slide shapes, odg drawing pages, table cells, and a standalone .odf formula document) and evaluates each through document-compute.js's units-typed evaluate() -- an agent's way to check whether a document's stated arithmetic actually checks out. A formula referencing a symbol (e.g. F = m * a) needs that symbol's value supplied via bindings, keyed by the document's own symbol-table id (see the document's symbolTable.symbols[].id, or a returned formula's own latex to identify which symbol is which); a formula with no free symbols (units and numeric literals only) evaluates with no bindings at all. Each formula reports its own outcome independently -- 'evaluated' with the result, 'no-content' when the formula was never lowered to a computable MathExpression, or 'error' naming which document-compute.js error it hit (e.g. UnboundSymbolError) -- so one formula needing more bindings never blocks the others. Spreadsheet cell-anchored formula objects are not walked, since they carry a structurally different, block-less embedding.",
      inputSchema: z.object({
        source: DocumentInputSchema.describe(
          "The document to read formulas from.",
        ),
        bindings: FormulaBindingsSchema.optional().describe(
          "Known values for symbols the document's formulas reference, keyed by symbol-table id (a Quantity { kind: 'quantity', magnitude, dimension } or an Interval { kind: 'interval', min, max, dimension } per symbol). Omit for a document whose formulas are fully closed (units and numeric literals only, no 'sym' nodes).",
        ),
      }),
    },
    async ({ source, bindings }, ctx) => {
      const { signal } = ctx.mcpReq;
      try {
        const { bytes, format } = await resolveDocumentInput(source, {
          signal,
        });
        const tree = readNativeDocumentTree(format, bytes, { signal });
        const document = flattenTree(tree);
        const entries = collectDocumentFormulas(document);
        const resolvedBindings: FormulaBindings = bindings ?? {};
        const formulas = entries.map((entry, index) => ({
          index,
          sourcePath: entry.sourcePath,
          latex: entry.formula.presentation?.latex,
          outcome: evaluateFormula(
            entry.formula,
            resolvedBindings,
            document.symbolTable,
          ),
        }));
        const structuredContent = {
          sourceFormat: format,
          documentKind: document.kind,
          formulaCount: formulas.length,
          formulas,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(structuredContent) }],
          structuredContent,
        };
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
