// The LaTeX lowering's degrade-with-diagnostic channel, following the same three-tier failure policy pdf-codec established and src/svg/diagnostics.ts restates for the svg read: input temml cannot parse at all degrades the whole expression to one `unparsed` node, notation the grammar covers degrades construct-by-construct, and nothing is ever a silent guess -- every degradation leaves the verbatim source visible inside the expression tree (the schema's `unparsed` variant) and names itself here. Every code below names one deliberate scope limit of the lowering rules in src/latex/lower.ts; a formula whose every construct is mechanical lowers with zero diagnostics.

export const LATEX_DIAGNOSTIC_CODES = [
  // temml's parser rejected the string outright (an unknown command, an unmatched brace): the whole expression becomes one `unparsed` node carrying the full verbatim source.
  "latex/parse-error",
  // A construct the lowering grammar has no rule for (an integral, an accent, an overline): that construct becomes an `unparsed` node carrying its verbatim source span.
  "latex/construct-unparsed",
  // Two operands sit adjacent with no operator between them (juxtaposition -- `mc^2`, `f(x)`, `2(x+1)`): multiplication and function application are the two conventional readings and LaTeX notation cannot say which, so the whole run becomes one `unparsed` node rather than guessing.
  "latex/juxtaposition-unparsed",
  // A \text{...} node: prose inside mathematics has no MathExpression reading, so its verbatim source becomes an `unparsed` node.
  "latex/text-unparsed",
  // A subscript that is not a simple symbol suffix (`a_{i+1}`, `x_{(n)}`): the grammar has no indexed-access operator, so the whole scripted construct becomes an `unparsed` node.
  "latex/subscript-unparsed",
  // A \sum/\prod whose bound is written as a bare glyph or a non-relation (`\sum_i`, `\sum_{i \in S}`) rather than `name = expression`: the binder still lowers, with the missing bound itself an `unparsed` node.
  "latex/binder-bound-implicit",
  // A \sum/\prod whose subscript could not be read as a bound at all: the whole binder becomes an `unparsed` node.
  "latex/binder-bound-unreadable",
  // A binary/relation operator with no mapping in the core registry (\pm, \approx, \cup, \to): the sequence around it becomes one `unparsed` node rather than dropping or guessing the operator.
  "latex/operator-unmapped",
  // A subscript or superscript whose base is itself an `unparsed` construct: scripts attach to nothing lowerable, so the whole scripted span degrades with it.
  "latex/script-base-unparsed",
  // An array environment other than the plain matrix family (align, cases, aligned): layout-semantic environments have no MathExpression reading, so the whole environment becomes one `unparsed` node.
  "latex/array-environment-unparsed",
  // A binomial or other generalised fraction drawn with delimiters or without a bar: only the plain stacked fraction is unambiguously division.
  "latex/genfrac-unparsed",
  // A binary/relation operator this lowering cannot place: a leading operator other than the one unary minus reading, or an operator with no operand on one side (`a + + b`, a trailing `+`).
  "latex/operator-placement-unparsed",
  // The prose scanner found and seeded a symbol-table definition -- an informational audit channel, not a degradation: one diagnostic per definition found, so a caller can see exactly what the scanner inferred from the document's own sentences.
  "symbols/prose-definition-found",
] as const;

export type LatexDiagnosticCode = (typeof LATEX_DIAGNOSTIC_CODES)[number];

export interface LatexDiagnostic {
  readonly code: LatexDiagnosticCode;
  // The verbatim source construct the diagnostic is about -- the same string the corresponding `unparsed` node carries, so a diagnostic and the visible gap in the tree always agree on what degraded.
  readonly detail?: string;
}

export type LatexDiagnosticSink = (diagnostic: LatexDiagnostic) => void;

// The coherence lint's own vocabulary, separate from the lowering's because it reports a different phenomenon: not "this construct would not lower" but "this formula's two stored layers no longer agree", which means somebody edited one layer deliberately since the content was last derived.
export const MATH_LINT_CODES = [
  // Re-lowering the stored presentation string produced a different expression tree than the stored content layer: a warning carrying provenance, never an automatic re-derivation -- the schema's atomic pair-edit rule says the edit was deliberate and the stored layers stay exactly as stored.
  "math/coherence-divergence",
  // A stored presentation string no longer parses at all while the stored content layer holds a lowered (non-unparsed-root) tree: a stronger form of the divergence above, since the presentation layer's own text has become unreadable to the pinned parser.
  "math/coherence-unparseable-presentation",
] as const;

export type MathLintCode = (typeof MATH_LINT_CODES)[number];

export interface MathLintDiagnostic {
  readonly code: MathLintCode;
  readonly severity: "warning";
  // The formula's stored provenance (its source and edit trail), carried into the warning so the reader can see who last touched either layer before judging which side is stale.
  readonly provenance?: string;
  readonly detail?: string;
}
