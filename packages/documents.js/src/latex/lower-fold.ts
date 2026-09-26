import type { LoweringContext } from "./lower";
import type { MathExpression } from "document-schema.js";
import {
  RELATION_OPERATORS,
  SUBTRACT_OPERATOR,
  UNARY_MINUS_OPERATOR,
  app,
  diagnose,
  lowerTerm,
  unparsed,
} from "./lower";
import type { TemmlNode } from "./temml";
// The term-arithmetic folding pass of LaTeX lowering, split from lower.ts: normalising unary minus, folding operator chains and arithmetic over constant operands, and lowering a folded segment back into term items. lower.ts keeps the node walk, the per-construct lowering and the public entry points.
// One operand segment in fold's input, carrying whether a preceding unary minus makes the segment's folded operand negate: a subtract operator whose FOLLOWING segment is empty (`T = -0.36`, `a + -b`, a leading `-x`) is not a binary subtraction at all — the minus is the sign of the segment after the empty one. The normalisation pass below rewrites that shape into a subtract-free operator list with the flag set, so fold and foldArithmetic only ever see real binary operators and one flag per segment.
export interface FoldSegment {
  readonly nodes: readonly TemmlNode[];
  readonly negated: boolean;
}

// Rewrites every empty-segment-with-a-subtract-after-it into a negation flag on the segment following the subtract (parity-counted, so `a = --b` negates twice), leaving any other empty segment (a genuine placement error, like `a = = b`) for fold's own diagnostic. This generalises the leading-minus-only reading the walk used to special-case: `T = -0.36` degraded the ENTIRE equality under the old spelling, because the empty segment sat after a relation rather than at the head of the sequence — found by the generated at-scale worked-example corpus (12% of its first run), whose negative stated answers are textbook-ordinary.
export function normaliseUnaryMinus(
  operators: readonly string[],
  segments: readonly FoldSegment[],
): { operators: string[]; segments: FoldSegment[] } {
  const outOperators: string[] = [];
  const outSegments: FoldSegment[] = [];
  let pendingNegate = false;
  let skipOperator = false;
  for (const [index, segment] of segments.entries()) {
    if (index > 0 && !skipOperator) {
      const operator = operators[index - 1];
      if (operator !== undefined) {
        outOperators.push(operator);
      }
    }
    skipOperator = false;
    if (segment.nodes.length === 0 && operators[index] === SUBTRACT_OPERATOR) {
      pendingNegate = !pendingNegate;
      skipOperator = true;
      continue;
    }
    outSegments.push({ nodes: segment.nodes, negated: pendingNegate });
    pendingNegate = false;
  }
  return { operators: outOperators, segments: outSegments };
}

// Standard mathematical convention binds a relation (=, <, \leq, ...) looser than every arithmetic operator, regardless of which side of the relation the arithmetic sits on: `c = a + b` and `a + b = c` both read as eq(add(a,b), c), never add(eq(...), ...) or add(..., eq(...)). A single flat left-to-right fold over the mixed operator list cannot express that — it folds whichever operator comes first in source order, so `F = m \times a` (relation before arithmetic) folded eq before multiply and produced multiply(eq(F,m), a), a tree with no sound mathematical reading (multiplying an equation by a value). fold instead runs two tiers: foldArithmetic resolves every maximal run of consecutive arithmetic operators into one operand first (unchanged left-to-right arithmetic behaviour within a run), and only then folds those operands together with the relation operators between them, left to right — so arithmetic always binds first no matter which side of a relation it sits on.
export function fold(
  first: MathExpression,
  operators: readonly string[],
  segments: readonly FoldSegment[],
  context: LoweringContext,
  detail: string,
): MathExpression {
  let runFirst = first;
  let runOperators: string[] = [];
  let runSegments: FoldSegment[] = [];
  const operands: MathExpression[] = [];
  const relations: string[] = [];

  for (let index = 0; index < operators.length; index += 1) {
    const operator = operators[index];
    const segment = segments[index];
    if (operator === undefined || segment === undefined) {
      throw new Error(
        "operator and segment lists diverged while folding a lowered sequence",
      );
    }
    if (segment.nodes.length === 0) {
      diagnose(context, "latex/operator-placement-unparsed", detail);
      return unparsed(detail);
    }
    if (RELATION_OPERATORS.has(operator)) {
      operands.push(
        foldArithmetic(runFirst, runOperators, runSegments, context),
      );
      relations.push(operator);
      runFirst = lowerFoldSegment(segment, context);
      runOperators = [];
      runSegments = [];
      continue;
    }
    runOperators.push(operator);
    runSegments.push(segment);
  }
  operands.push(foldArithmetic(runFirst, runOperators, runSegments, context));

  let folded = operands[0];
  if (folded === undefined) {
    throw new Error("fold produced no operand for a non-empty operator list");
  }
  for (let index = 0; index < relations.length; index += 1) {
    const relation = relations[index];
    const operand = operands[index + 1];
    if (relation === undefined || operand === undefined) {
      throw new Error(
        "relation and operand lists diverged while folding a lowered sequence",
      );
    }
    folded = app(relation, [folded, operand]);
  }
  return folded;
}

// One maximal run of consecutive arithmetic operators, folded strictly left-to-right (the header comment's own contract: a - b - c is subtract(subtract(a,b),c), one application per source operator). `operators` here never contains a relation — fold above only ever calls this on the arithmetic-only slices between relation boundaries.
export function foldArithmetic(
  first: MathExpression,
  operators: readonly string[],
  segments: readonly FoldSegment[],
  context: LoweringContext,
): MathExpression {
  let folded = first;
  for (let index = 0; index < operators.length; index += 1) {
    const operator = operators[index];
    const segment = segments[index];
    if (operator === undefined || segment === undefined) {
      throw new Error(
        "operator and segment lists diverged while folding an arithmetic run",
      );
    }
    folded = app(operator, [folded, lowerFoldSegment(segment, context)]);
  }
  return folded;
}

// One segment's folded operand, with the unary-minus flag normalisation attached (negate wraps the folded term, never the raw nodes — negation is an operation on the lowered value).
export function lowerFoldSegment(
  segment: FoldSegment,
  context: LoweringContext,
): MathExpression {
  const folded = lowerTerm(segment.nodes, context);
  return segment.negated ? app(UNARY_MINUS_OPERATOR, [folded]) : folded;
}
