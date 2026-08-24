import type { MathMlNode } from "document-schema.js";
import temml from "temml";

// The pinned LaTeX parser. temml (https://temml.org, MIT, zero dependencies of its own) is the one component of the two-layer math model this ecosystem deliberately does not hand-write -- a LaTeX grammar is a large, fiddly surface with no supply-chain-averse payoff the way the hand-written MathML typesetting engine has one -- so it is a real dependency, pinned to the EXACT version recorded in package.json ("temml": "0.13.4", no caret). The pin is load-bearing, not tidiness: this module consumes temml's underscore-prefixed internal API (__parse, the KaTeX-style parse-node tree, and __renderToMathMLTree, the virtual MathML tree), which carries no stability guarantee across releases, and the two-layer model's storage contract says a stored presentation string has ONE defined parse. A caret range would silently change that defined meaning under a consumer's feet; the exact pin makes "which parse does this stored string have" a function of the package's own version. Bumping the pin is a deliberate act that must re-run src/latex/lower.test.ts, whose lowering table cases pin the parse-node shapes this version produces.
//
// Worker-isomorphism holds: temml is pure JavaScript with no dependencies, its parser and virtual-MathML tree builder never touch the DOM (only the optional render/renderMathInElement entry points do, and they feature-detect `document` before using it -- this module never calls them), and test/workers/ proves the whole lowering path under workerd. The eslint no-restricted-imports guard enforcing the rest of src/'s isomorphism applies here unchanged.

// What the parse and MathML passes are invoked with: throwOnError true because the lowering wants real parse failures surfaced (an unknown command degrades the whole expression to one `unparsed` node with a diagnostic, via the union below), not temml's error-coloured fallback rendering; maxExpand left at its default, which already bounds macro expansion against pathological input.
const TEMML_OPTIONS = { throwOnError: true } as const;

// A temml parse node, seen only through the structural fields src/latex/lower.ts consumes. temml's own type declarations hand the tree back as `any`, so this package re-declares the surface it reads and narrows into it with the guards below -- the same treatment every loosely-typed third-party value gets at this package's boundaries. `type` is the node's discriminant ('mathord', 'genfrac', 'supsub', ...); every other field is `unknown` until a guard narrows it.
export interface TemmlNode {
  readonly type: string;
  readonly [field: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTemmlNode(value: unknown): value is TemmlNode {
  return isRecord(value) && typeof value.type === "string";
}

export function isTemmlNodeArray(value: unknown): value is TemmlNode[] {
  return Array.isArray(value) && value.every(isTemmlNode);
}

// A node's source span: the verbatim substring of the parsed string this node came from, used wherever the lowering degrades something to an `unparsed` node -- the schema's contract is that a coverage gap stays visible as the exact source that resisted lowering, and a re-serialisation of the tree would not be that. Returns undefined only for nodes temml synthesised without a source position (its internal spacing/rule artefacts), which the lowering either skips as presentation-only or degrades with the enclosing construct's own span.
export interface TemmlSourceSpan {
  readonly start: number;
  readonly end: number;
}

export function sourceSpanOf(node: TemmlNode): TemmlSourceSpan | undefined {
  const loc = node.loc;
  if (!isRecord(loc)) {
    return undefined;
  }
  const start = loc.start;
  const end = loc.end;
  if (
    typeof start !== "number" ||
    typeof end !== "number" ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start
  ) {
    return undefined;
  }
  return { start, end };
}

export function sourceSlice(
  input: string,
  span: TemmlSourceSpan | undefined,
): string {
  if (span === undefined) {
    return "";
  }
  return input.slice(span.start, span.end);
}

// The result of handing one LaTeX string to the pinned parser: either the parse-node list plus the presentation-MathML tree (both derived from the same single parse, so the two views can never disagree about what the string said), or the parser's own failure message.
export type LatexParseResult =
  | {
      readonly status: "parsed";
      readonly nodes: readonly TemmlNode[];
      readonly mathml: readonly MathMlNode[];
    }
  | { readonly status: "unparseable"; readonly message: string };

export function parseLatex(latex: string): LatexParseResult {
  try {
    const nodes: unknown = temml.__parse(latex, TEMML_OPTIONS);
    if (!isTemmlNodeArray(nodes)) {
      return {
        status: "unparseable",
        message: "parser returned a shape this package does not recognise",
      };
    }
    const mathml = mathmlOf(latex);
    return { status: "parsed", nodes, mathml };
  } catch (error) {
    return { status: "unparseable", message: errorMessage(error) };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// The parse-node list re-expressed as presentation MathML nodes -- the `mathml` field a lowered ContentFormula carries, so a LaTeX-authored formula renders through the existing MathML typesetting engine (src/mathml/layout.ts) exactly like an ODF-sourced one instead of degrading to its text stand-in. Derived from the same pinned parser at parse time and stored beside the verbatim latex: both are the presentation layer (the schema's rendering-authoritative half), so deriving one from the other at rest violates nothing -- what the schema forbids is re-deriving EITHER from the semantic layer. Returns an empty list when the tree holds a node shape this walk does not recognise, which is the schema-anticipated empty-mathml state (rendering falls back to the plain-text stand-in); the presentation string itself stays authoritative either way.
function mathmlOf(latex: string): MathMlNode[] {
  let root: unknown;
  try {
    root = temml.__renderToMathMLTree(latex, TEMML_OPTIONS);
  } catch {
    return [];
  }
  return toMathMlNodes(root) ?? [];
}

// temml's virtual MathML tree has three node shapes: MathNode (a tag string, a plain-object attribute map, child nodes), TextNode (a text payload), and DocumentFragment (a transparent grouping with children and nothing else -- temml wraps some trees' content in one). The walk maps them onto document-schema.js's MathMlNode (itself a transcription of odf.js's generic XML node shape), flattening fragments into their parent's children (MathML has no fragment construct) and dropping MathNode's classes/style/label fields -- those are temml-internal presentation metadata with no meaning to this package's MathML consumer, which keys off element names and the MathML spec's own attributes. An unrecognised child makes the whole conversion return undefined (the caller's [] degradation above): half a MathML tree is worse than none, because a renderer would typeset a silently amputated formula.
function toMathMlNodes(value: unknown): MathMlNode[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (typeof value.text === "string" && value.type === undefined) {
    return [{ type: "text", value: value.text }];
  }
  if (!Array.isArray(value.children)) {
    return undefined;
  }
  const children: MathMlNode[] = [];
  for (const child of value.children) {
    const converted = toMathMlNodes(child);
    if (converted === undefined) {
      return undefined;
    }
    children.push(...converted);
  }
  if (value.type === undefined) {
    // A DocumentFragment: transparent, its converted children stand in for it directly.
    return children;
  }
  if (typeof value.type !== "string") {
    return undefined;
  }
  const attributes = attributesOf(value.attributes);
  if (attributes === undefined) {
    return undefined;
  }
  return [{ type: "element", tag: value.type, attributes, children }];
}

function attributesOf(
  value: unknown,
): { readonly name: string; readonly value: string }[] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const attributes: { name: string; value: string }[] = [];
  for (const [name, attributeValue] of Object.entries(value)) {
    if (
      typeof attributeValue === "string" ||
      typeof attributeValue === "number" ||
      typeof attributeValue === "boolean"
    ) {
      attributes.push({ name, value: String(attributeValue) });
    }
  }
  return attributes;
}
