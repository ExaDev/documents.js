import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { evaluate, type EvaluationResult } from "document-compute.js";
import {
  ContentDocumentSchema,
  EvaluationValueSchema,
  flattenTree,
  FormulaBindingsSchema,
  type ContentFormula,
  type FormulaBindings,
  type SymbolTable,
} from "document-schema.js";
import {
  collectDocumentFormulas,
  DocumentFormatSchema,
  readNativeDocumentTree,
} from "documents.js";
import { z } from "zod";
import {
  DocumentInputSchema,
  resolveDocumentInput,
} from "../io/document-input";

// ExaDev/documents.js#928: document-compute.js's evaluate() had no consumer anywhere in the family. This tool is the first one -- reading a document's own embedded formulas (ContentFormula.content, the MathExpression semantic layer beside its LaTeX/MathML presentation) and evaluating each through document-compute.js, so an agent can ask "does this document's arithmetic actually check out" without hand-walking the schema itself. The walk over every ContentDocument arm a formula can travel through -- wordprocessing/presentation/drawing block flow (table cells included), the spreadsheet embeddedObjects array, the standalone 'formula' kind, and, at any depth beneath any of those, a non-formula embedded object's own nested document (a formula embedded inside a drawing embedded inside a spreadsheet, and so on) -- is documents.js's own collectDocumentFormulas (src/model/formula.ts): the same shared function src/latex/lint.ts's coherence lint consumes, so this tool and that lint can never silently diverge on which formulas a document actually carries.

function toErrorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
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

// Module-private: this is the exact function the registered tool below calls per formula entry (never a test-local reimplementation), but nothing needs to drive it directly -- the test suite exercises every outcome (evaluated/no-content/error, including a nested formula's own governing symbolTable) through the real MCP callTool round trip instead, which reaches this same code path end to end.
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

// One formula outcome's own structuredContent shape, matching this package's own convert.ts/odm.ts convention (see ConvertDocumentOutputSchema/OdmToPdfOutputSchema) -- lets registerTool validate/type a successful result via outputSchema, and lets a caller (this file's own test included) read result.structuredContent without an unsafe cast or an isRecord guard.
const FormulaOutcomeSchema = z.union([
  z.object({
    status: z.literal("evaluated"),
    result: EvaluationValueSchema,
  }),
  z.object({ status: z.literal("no-content") }),
  z.object({
    status: z.literal("error"),
    errorType: z.string(),
    message: z.string(),
  }),
]);

// Derived from ContentDocumentSchema's own discriminated-union members rather than hand-listed, so deleting or renaming a ContentDocument kind is caught here at the type level (documentKind's own z.enum stops accepting the removed literal, and every caller of it fails to typecheck) instead of surfacing only at runtime as a ProtocolError the first time a document of that kind is read -- the same drift risk collectDocumentFormulas's own exhaustiveness guard (documents.js's src/model/formula.ts) already closes for its switch.
const documentKindValues = ContentDocumentSchema.options.map(
  (option) => option.shape.kind.value,
);

// The full structuredContent shape compute_formula returns -- exported for the same reason as this package's other tools' own OutputSchema constants.
export const ComputeFormulaOutputSchema = z.object({
  sourceFormat: DocumentFormatSchema,
  documentKind: z.enum(documentKindValues),
  formulaCount: z.number(),
  formulas: z.array(
    z.object({
      index: z.number(),
      sourcePath: z.string().optional(),
      locate: z.string(),
      latex: z.string().optional(),
      outcome: FormulaOutcomeSchema,
    }),
  ),
});

export function registerComputeFormulaTools(server: McpServer): void {
  server.registerTool(
    "compute_formula",
    {
      title: "Compute document formulas",
      description:
        "Reads every formula a document embeds (docx/odt/markdown paragraphs and pptx/odp slide shapes; a table cell's own blocks too -- docx's own reader recovers a real equation nested inside a table cell; structurally, the walk also covers a drawing page's own shape flow, though no writer in the family populates a formula there today; a spreadsheet's own cell-anchored formula objects; a standalone .odf formula document; and a formula nested inside another embedded object at any depth, e.g. a formula embedded in a drawing embedded in a spreadsheet) and evaluates each through document-compute.js's units-typed evaluate() -- an agent's way to check whether a document's stated arithmetic actually checks out. A formula referencing a symbol (e.g. F = m * a) needs that symbol's value supplied via bindings, keyed by the document's own symbol-table id (see the document's symbolTable.symbols[].id, or a returned formula's own latex to identify which symbol is which); a formula with no free symbols (units and numeric literals only) evaluates with no bindings at all. Each formula reports its own outcome independently -- 'evaluated' with the result, 'no-content' when the formula was never lowered to a computable MathExpression (the common case for a spreadsheet's own embedded formula object, or any format other than markdown, none of which yet stores the semantic layer on disk), or 'error' naming which document-compute.js error it hit (e.g. UnboundSymbolError) -- so one formula needing more bindings never blocks the others. Each entry's own `locate` field is the reliable way to tell two formulas in the same document apart -- a structural path guaranteed unique per formula -- unlike `sourcePath`, which several formats leave undefined or stamp with the identical constant across sibling formulas (markdown's own display-math lowering among them).",
      inputSchema: z.object({
        source: DocumentInputSchema.describe(
          "The document to read formulas from.",
        ),
        bindings: FormulaBindingsSchema.optional().describe(
          "Known values for symbols the document's formulas reference, keyed by symbol-table id (a Quantity { kind: 'quantity', magnitude, dimension } or an Interval { kind: 'interval', min, max, dimension } per symbol). Omit for a document whose formulas are fully closed (units and numeric literals only, no 'sym' nodes).",
        ),
      }),
      outputSchema: ComputeFormulaOutputSchema,
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
          locate: entry.locate,
          latex: entry.formula.presentation?.latex,
          // entry.symbolTable is the GOVERNING table for this specific formula (documents.js's src/model/formula.ts, resolved nested-first) -- never the outermost document's own symbolTable, which for a formula nested inside another embedded object's document would resolve its symbol/unit ids against the wrong curation entirely: two documents fused by embedding can mint the same id against a different quantityKind or a different unit conversion factor, so evaluating against the outer table can throw a bogus UnknownUnitError or, worse, silently return a wrong numeric result with no error at all.
          outcome: evaluateFormula(
            entry.formula,
            resolvedBindings,
            entry.symbolTable,
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
