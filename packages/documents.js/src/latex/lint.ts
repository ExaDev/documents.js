import {
  flattenTree,
  type ContentFormula,
  type DocumentTree,
  type MathExpression,
  type MathSymbolEntry,
} from "document-schema.js";
import type { MathLintDiagnostic } from "./diagnostics";
import { collectDocumentFormulas } from "../model/formula";
import { lowerLatex } from "./lower";
import { reduceRational } from "./rational";

// The coherence lint: the two-layer model's read-only audit. For every formula carrying BOTH a presentation string and a content tree, re-parse the stored presentation with the same pinned parser, re-run the same lowering against the document's own symbol table, and compare the result with the stored content. Divergence means somebody edited one layer deliberately since the content was last derived -- the schema's atomic pair-edit rule guarantees the layers never drift by accident -- so the finding is a WARNING carrying the stored provenance (where the formula came from and what has touched it, per the edit trail), never an automatic re-derivation: this function computes a derived comparison view at comparison time and writes nothing back, exactly the discipline the schema's own comment prescribes.
//
// What agreement MEANS here is deliberately strict: the re-lowered tree and the stored tree must be structurally identical after canonicalisation (key-order-normalised objects; exact rationals compared by cross-multiplication, the schema's own exact-equality rule for producers that skip lowest-terms reduction). A stored content tree someone hand-curated into a BETTER reading than the mechanical lowering (resolving an mc^2 juxtaposition into an explicit multiply, say) will diverge from the mechanical re-lowering -- correctly, and reported as a warning: the lint's job is to surface that a deliberate edit happened, not to judge whether the edit was an improvement.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Canonical comparison view of an expression: objects rebuilt with sorted keys (so a hand-edited JSON blob and a freshly lowered tree compare by structure, not by key order) and rationals reduced to lowest terms (so 1/2 and 2/4 agree, per the schema's exact-equality rule for non-reduced producers -- lowest terms is the canonical spelling both sides reduce to). Everything else compares structurally, recursively.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (!isRecord(value)) {
    return value;
  }
  if (
    value.kind === "num" &&
    typeof value.numerator === "string" &&
    typeof value.denominator === "string"
  ) {
    return {
      kind: "num",
      ...reduceRational(BigInt(value.numerator), BigInt(value.denominator)),
    };
  }
  const entries = Object.entries(value).map(
    ([key, element]) => [key, canonical(element)] as const,
  );
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return Object.fromEntries(entries);
}

function expressionsAgree(
  left: MathExpression,
  right: MathExpression,
): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

// Whether a formula's content layer is itself a whole-expression degradation -- one root `unparsed` node. Such a stored tree agrees with any re-lowering that also degraded, and a stored degradation paired with an unparseable presentation is a quieter situation than a real lowering paired with an unreadable string, so only the latter warns.
function isUnparsedRoot(expression: MathExpression): boolean {
  return expression.kind === "unparsed";
}

function lintFormula(
  formula: ContentFormula,
  locate: string,
  symbolEntries: readonly MathSymbolEntry[] | undefined,
  warnings: MathLintDiagnostic[],
): void {
  const presentation = formula.presentation;
  const content = formula.content;
  if (presentation === undefined || content === undefined) {
    return;
  }
  const provenance =
    formula.provenance === undefined
      ? undefined
      : [formula.provenance.source, ...formula.provenance.editTrail].join(
          " -> ",
        );
  const relowered = lowerLatex(presentation.latex, { symbolEntries });
  const detail = `${locate}: ${presentation.latex}`;
  if (
    relowered.diagnostics.some(
      (diagnostic) => diagnostic.code === "latex/parse-error",
    )
  ) {
    if (!isUnparsedRoot(content)) {
      warnings.push({
        code: "math/coherence-unparseable-presentation",
        severity: "warning",
        ...(provenance === undefined ? {} : { provenance }),
        detail,
      });
    }
    return;
  }
  if (!expressionsAgree(relowered.expression, content)) {
    warnings.push({
      code: "math/coherence-divergence",
      severity: "warning",
      ...(provenance === undefined ? {} : { provenance }),
      detail,
    });
  }
}

// Lint every formula carrying both layers in a package. The tree-form package is flattened once at entry (the same single tree-to-flat authority every package consumer uses); collectDocumentFormulas (src/model/formula.ts) is the shared walk covering every arm a formula actually travels through in the flat form -- the wordprocessing sections' block flow, presentation slides and drawing pages (both via their shapes' own block flows, including table cells), the spreadsheet arm's own embeddedObjects array, the formula arm itself (a standalone formula document), and, at any depth beneath any of those, a non-formula embedded object's own nested document (a formula embedded inside a drawing embedded inside a spreadsheet, and so on -- document-schema.js's own ContentEmbeddedObject is mutually recursive with ContentDocument for exactly this reason, so the walk recurses to match). The exported signature keeps DocumentTree -- callers hand back exactly what onDocument gave them. Each entry's own `locate` -- a structural path the walk derives from container/index position, not the document's own sourcePath field -- is the diagnostic locate string: sourcePath is optional on every block (markdown-codec's own $$ lowering, src/lower/lower.ts's lowerMathBlock, never populates it at all -- and once this package's own src/markdown/math.ts replaces that block during read, every display formula's sourcePath is stamped with the identical literal "markdown:math-block", every inline formula's with "markdown:math-inline", so nothing stops two sibling formulas from sharing that same value), so keying the lint's own detail string on it would let two distinct formulas in one document produce byte-identical diagnostics. `locate` is guaranteed unique per formula within a document regardless of what the source format did or didn't record, including across a nesting boundary -- the nested walk's own locate rides after the embedding position, never colliding with it.
export function lintMathCoherence(
  pkg: DocumentTree,
): readonly MathLintDiagnostic[] {
  const warnings: MathLintDiagnostic[] = [];
  const content = flattenTree(pkg);
  const symbolEntries = content.symbolTable?.symbols;
  for (const { formula, locate } of collectDocumentFormulas(content)) {
    lintFormula(formula, locate, symbolEntries, warnings);
  }
  return warnings;
}
