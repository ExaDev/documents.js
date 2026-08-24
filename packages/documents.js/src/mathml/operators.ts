// A deliberately bounded operator dictionary, not the MathML3 specification's own multi-thousand-entry, form-dependent (prefix/infix/postfix) table (https://www.w3.org/TR/MathML3/appendixc.html) -- this covers the operators real formulas overwhelmingly use (arithmetic, relations, set/logic symbols, calculus big-operators, fences, punctuation), one entry per character regardless of which position it appears in, and falls back to a single sane infix-shaped default for anything it doesn't recognise. See this module's own README/gotchas note for the exact scope line.
export interface OperatorProperties {
  readonly lspaceEm: number;
  readonly rspaceEm: number;
  readonly stretchy: boolean;
  readonly largeop: boolean;
  readonly movablelimits: boolean;
  readonly fence: boolean;
  readonly separator: boolean;
}

// The four spacing classes this dictionary distinguishes, in em (relative to the operator's own font size) -- a coarser approximation of MathML's own per-operator lspace/rspace table (which assigns one of six named space keywords, from 0em to thickmathspace = 5/18em, per operator and per form), but the same shape: named classes, not per-operator hand-tuned values.
const ZERO_SPACE = 0;
const THIN_SPACE = 1 / 6; // MathML's own 'thinmathspace'
const MEDIUM_SPACE = 2 / 9; // 'mediummathspace' -- ordinary binary arithmetic operators
const THICK_SPACE = 5 / 18; // 'thickmathspace' -- relations, logical connectives, arrows

const DEFAULT_OPERATOR: OperatorProperties = {
  lspaceEm: THICK_SPACE,
  rspaceEm: THICK_SPACE,
  stretchy: false,
  largeop: false,
  movablelimits: false,
  fence: false,
  separator: false,
};

function binary(): OperatorProperties {
  return {
    ...DEFAULT_OPERATOR,
    lspaceEm: MEDIUM_SPACE,
    rspaceEm: MEDIUM_SPACE,
  };
}

function relation(): OperatorProperties {
  return { ...DEFAULT_OPERATOR, lspaceEm: THICK_SPACE, rspaceEm: THICK_SPACE };
}

function fence(isOpen: boolean): OperatorProperties {
  return {
    ...DEFAULT_OPERATOR,
    lspaceEm: isOpen ? ZERO_SPACE : THIN_SPACE,
    rspaceEm: isOpen ? THIN_SPACE : ZERO_SPACE,
    stretchy: true,
    fence: true,
  };
}

function separator(): OperatorProperties {
  return {
    ...DEFAULT_OPERATOR,
    lspaceEm: ZERO_SPACE,
    rspaceEm: THIN_SPACE,
    separator: true,
  };
}

// largeop + movablelimits: a symbol whose under/over-script content moves to sub/sup position outside display style (sum, product, union, intersection, ⋁/⋀, the coproduct family) -- this is the standard TeX/MathML \nolimits-vs-\limits distinction for "big operators whose limits are conventionally inline in running text".
//
// NOT stretchy, matching MathML3's own dictionary entry for every one of these (appendix C gives U+2211 and its siblings stretchy="false"): a big operator grows by selecting a larger DESIGNED size in display style -- the largeop mechanism -- never by stretching to whatever else happens to share its row. The distinction is load-bearing now that layout.ts genuinely stretches a stretchy operator to its row's content: STIX Two Math does declare vertical MathVariants for ∑/∏/⋃, so claiming stretchy here would visibly deform a summation sign standing next to a tall fraction.
function bigOperatorMovable(): OperatorProperties {
  return {
    ...DEFAULT_OPERATOR,
    lspaceEm: THIN_SPACE,
    rspaceEm: THIN_SPACE,
    largeop: true,
    movablelimits: true,
    stretchy: false,
  };
}

// largeop, NOT movablelimits: the integral family, whose limits are always sub/sup-positioned even in display style (an integral is never written with the bounds stacked directly above/below the sign).
function bigOperatorFixed(): OperatorProperties {
  return {
    ...DEFAULT_OPERATOR,
    lspaceEm: THIN_SPACE,
    rspaceEm: THIN_SPACE,
    largeop: true,
    movablelimits: false,
    stretchy: false,
  };
}

function prefixSymbol(): OperatorProperties {
  return { ...DEFAULT_OPERATOR, lspaceEm: ZERO_SPACE, rspaceEm: ZERO_SPACE };
}

const OPERATORS = new Map<string, OperatorProperties>([
  // Arithmetic and binary
  ["+", binary()],
  ["-", binary()],
  ["−", binary()], // minus sign
  ["*", binary()],
  ["×", binary()], // multiplication sign
  ["÷", binary()], // division sign
  ["⋅", binary()], // dot operator
  ["∘", binary()], // ring operator (function composition)
  ["±", binary()], // plus-minus
  ["∓", binary()], // minus-plus
  ["/", binary()],

  // Relations
  ["=", relation()],
  ["≠", relation()], // not equal
  ["<", relation()],
  [">", relation()],
  ["≤", relation()], // <=
  ["≥", relation()], // >=
  ["≪", relation()], // much less than
  ["≫", relation()], // much greater than
  ["≈", relation()], // approximately equal
  ["≡", relation()], // identical to
  ["∝", relation()], // proportional to
  ["∼", relation()], // tilde operator
  ["≅", relation()], // approximately equal to
  ["≃", relation()], // asymptotically equal to

  // Set theory
  ["∈", relation()], // element of
  ["∉", relation()], // not an element of
  ["∋", relation()], // contains as member
  ["⊂", relation()], // subset of
  ["⊆", relation()], // subset of or equal to
  ["⊃", relation()], // superset of
  ["⊇", relation()], // superset of or equal to
  ["∪", binary()], // union
  ["∩", binary()], // intersection
  ["∖", binary()], // set minus
  ["∅", prefixSymbol()], // empty set

  // Logic
  ["∧", binary()], // logical and
  ["∨", binary()], // logical or
  ["¬", prefixSymbol()], // logical not
  ["∀", prefixSymbol()], // for all
  ["∃", prefixSymbol()], // there exists
  ["∄", prefixSymbol()], // there does not exist

  // Arrows
  ["→", relation()], // right arrow
  ["←", relation()], // left arrow
  ["↔", relation()], // left-right arrow
  ["⇒", relation()], // implies
  ["⇐", relation()], // implied by
  ["⇔", relation()], // if and only if

  // Big operators
  ["∑", bigOperatorMovable()], // n-ary summation
  ["∏", bigOperatorMovable()], // n-ary product
  ["∐", bigOperatorMovable()], // n-ary coproduct
  ["⋃", bigOperatorMovable()], // n-ary union
  ["⋂", bigOperatorMovable()], // n-ary intersection
  ["⋁", bigOperatorMovable()], // n-ary logical or
  ["⋀", bigOperatorMovable()], // n-ary logical and
  ["⨁", bigOperatorMovable()], // n-ary circled plus
  ["⨂", bigOperatorMovable()], // n-ary circled times
  ["∫", bigOperatorFixed()], // integral
  ["∬", bigOperatorFixed()], // double integral
  ["∭", bigOperatorFixed()], // triple integral
  ["∮", bigOperatorFixed()], // contour integral
  ["∯", bigOperatorFixed()], // surface integral
  ["∰", bigOperatorFixed()], // volume integral

  // Fences
  ["(", fence(true)],
  [")", fence(false)],
  ["[", fence(true)],
  ["]", fence(false)],
  ["{", fence(true)],
  ["}", fence(false)],
  ["⌈", fence(true)], // left ceiling
  ["⌉", fence(false)], // right ceiling
  ["⌊", fence(true)], // left floor
  ["⌋", fence(false)], // right floor
  ["⟨", fence(true)], // left angle bracket
  ["⟩", fence(false)], // right angle bracket
  ["|", { ...fence(true), lspaceEm: ZERO_SPACE, rspaceEm: ZERO_SPACE }], // vertical bar -- symmetric, both a fence and an "absolute value" delimiter
  ["‖", { ...fence(true), lspaceEm: ZERO_SPACE, rspaceEm: ZERO_SPACE }], // double vertical bar (norm)

  // Punctuation / separators
  [",", separator()],
  [";", separator()],
  [":", relation()],

  // Miscellaneous
  ["′", { ...DEFAULT_OPERATOR, lspaceEm: ZERO_SPACE, rspaceEm: ZERO_SPACE }], // prime
  ["…", { ...DEFAULT_OPERATOR, lspaceEm: ZERO_SPACE, rspaceEm: ZERO_SPACE }], // horizontal ellipsis
  ["⋯", { ...DEFAULT_OPERATOR, lspaceEm: ZERO_SPACE, rspaceEm: ZERO_SPACE }], // midline ellipsis
  [
    "√",
    {
      ...DEFAULT_OPERATOR,
      lspaceEm: ZERO_SPACE,
      rspaceEm: ZERO_SPACE,
      stretchy: true,
    },
  ], // radical sign, when it appears as a bare <mo> rather than inside msqrt/mroot

  // Over/under-brace: MathML3 Appendix C gives U+23DE/U+23DF form="postfix", lspace=rspace=0, stretchy="true", accent="true" -- this dictionary's OperatorProperties has no accent field of its own, since accent-attachment centring is driven by the *element's* own accent="true"/accentunder="true" attribute on munder/mover/munderover (see layout.ts's own layoutUnderOverElement), not by the operator dictionary; only stretchy carries through here. These two only ever occur as munder/mover script content -- an over/under-brace standing alone as an ordinary inline operator is not a real MathML use case.
  [
    "⏞",
    {
      ...DEFAULT_OPERATOR,
      lspaceEm: ZERO_SPACE,
      rspaceEm: ZERO_SPACE,
      stretchy: true,
    },
  ], // U+23DE TOP CURLY BRACKET (over-brace)
  [
    "⏟",
    {
      ...DEFAULT_OPERATOR,
      lspaceEm: ZERO_SPACE,
      rspaceEm: ZERO_SPACE,
      stretchy: true,
    },
  ], // U+23DF BOTTOM CURLY BRACKET (under-brace)
]);

// The operator dictionary entry for `text` (an <mo> element's own text content, already trimmed), or the default infix-shaped entry when `text` is not one of the operators this dictionary specifically recognises.
export function operatorProperties(text: string): OperatorProperties {
  return OPERATORS.get(text) ?? DEFAULT_OPERATOR;
}
