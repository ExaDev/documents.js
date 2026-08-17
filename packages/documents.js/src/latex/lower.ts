import type { ContentFormula, MathExpression, MathMlNode, MathSymbolEntry } from 'document-schema.js';
import type { LatexDiagnostic, LatexDiagnosticSink } from './diagnostics';
import { isTemmlNode, parseLatex, type LatexParseResult, type TemmlNode } from './temml';
import { glyphOfSymbolText, SymbolResolver } from './symbols';
import { decimalToRational } from './rational';

// LaTeX presentation -> MathExpression, the string-to-tree half of the two-layer math model (document-schema.js src/math.ts states the contract: this direction is total -- any input at least degrades to an `unparsed` node -- while tree-to-string rendering is partial, which is why storage carries both layers verbatim). The rules are mechanical exactly where notation is unambiguous and degrade to visible `unparsed` data everywhere else, per the design the issue records: `\frac` is always division, a radical is always a root, a scripted Sigma with limits is always a binder, and juxtaposition -- the one construct with two defensible readings (multiplication, function application) -- is NEVER guessed, because a wrong guess is indistinguishable from a correct lowering until someone computes with it.
//
// The input tree is temml's KaTeX-style parse tree (src/latex/temml.ts, the pinned parser). Everything here reads it through structural guards, so a temml release that reshapes a node changes a type-guard failure in the test suite rather than silently mis-lowering.

// -- The operator registries this lowering emits into --
//
// The core arithmetic registry ('math:' prefix): every operator below is one the schema names the grammar's reference consumers implement. Binary operators fold strictly left-to-right, one application per source operator, so the stored tree mirrors the source's own structure (a - b - c is subtract(subtract(a, b), c), not a variadic rewrite -- associativity is a semantics-layer judgement, not this lowering's to make).

const BINARY_ATOM_OPERATORS: Readonly<Record<string, string>> = {
  '+': 'math:add',
  '-': 'math:subtract',
  '\\cdot': 'math:multiply',
  '\\times': 'math:multiply',
  '\\div': 'math:divide',
};

const RELATION_ATOM_OPERATORS: Readonly<Record<string, string>> = {
  '=': 'math:eq',
  '\\neq': 'math:neq',
  '\\ne': 'math:neq',
  '<': 'math:lt',
  '\\leq': 'math:leq',
  '\\le': 'math:leq',
  '>': 'math:gt',
  '\\geq': 'math:geq',
  '\\ge': 'math:geq',
};

// The subtraction operator, named so the unary-minus reading below can reference the SOURCE operator it applies to (a leading token mapping to math:subtract) distinctly from the operator it EMITS (math:negate).
const SUBTRACT_OPERATOR = 'math:subtract';
const UNARY_MINUS_OPERATOR = 'math:negate';

// Named single-argument functions. A function name is not reused as a variable in any convention these rules cover, so \sin applied to what follows is mechanical in a way bare f(x) is not -- which is exactly why f(x) degrades (juxtaposition) while \sin(x) lowers. Deliberately excludes variadic and ordering-sensitive names (\min, \max, \arg): their argument-list semantics have no representation in a single-argument registry entry, and half a variadic reading is a wrong reading.
const NAMED_FUNCTION_OPERATORS: Readonly<Record<string, string>> = {
  '\\sin': 'math:sin',
  '\\cos': 'math:cos',
  '\\tan': 'math:tan',
  '\\cot': 'math:cot',
  '\\sec': 'math:sec',
  '\\csc': 'math:csc',
  '\\arcsin': 'math:arcsin',
  '\\arccos': 'math:arccos',
  '\\arctan': 'math:arctan',
  '\\sinh': 'math:sinh',
  '\\cosh': 'math:cosh',
  '\\tanh': 'math:tanh',
  '\\exp': 'math:exp',
  '\\log': 'math:log',
  '\\ln': 'math:ln',
};

// temml node types that carry no mathematics at all -- spacing commands, the zero-size `rule` artefact temml inserts as a radical's vinculum, kerns. Skipping them is not a degradation (there is nothing to degrade); everything else unknown degrades visibly instead.
const PRESENTATION_ONLY_TYPES: ReadonlySet<string> = new Set(['spacing', 'rule', 'kern']);

// Node types whose whole job is to wrap a body in presentation styling -- unwrapped, with the body lowered in place. Not in PRESENTATION_ONLY_TYPES because their body is mathematics.
const WRAPPER_TYPES: ReadonlySet<string> = new Set(['styling', 'color']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A temml node's `text` field when it holds a plain written character or a symbol command -- the things a glyph can be built from.
function nodeText(node: TemmlNode): string | undefined {
  return typeof node.text === 'string' ? node.text : undefined;
}

// The written glyph this node carries, for glyph-shaped nodes only (a mathord, or a textord holding a symbol command): the raw character for plain text, the mapped Unicode glyph for a command.
function glyphOfNode(node: TemmlNode): string | undefined {
  const text = nodeText(node);
  return text === undefined ? undefined : glyphOfSymbolText(text);
}

// One lowerable item in a term: either a temml node, or a numeric literal folded out of a run of digit textords ('4' '2' -> 42; '3' '.' '1' '4' -> 3.14). temml emits each digit as its own textord, so the fold is what makes decimal notation visible to the lowering at all; the folded literal is validated and reduced through src/latex/rational.ts, keeping the exact-rational contract bit-exact for arbitrarily long literals. A folded item keeps the textords it came from so degradation spans stay verbatim-complete ('2x' degrades carrying the 2, not just the x).
type TermItem = { readonly kind: 'node'; readonly node: TemmlNode } | { readonly kind: 'number'; readonly literal: string; readonly nodes: readonly TemmlNode[] };

function numericText(text: string): boolean {
  return text.length === 1 && text >= '0' && text <= '9';
}

// The per-run state every lowering level threads: the verbatim input (source spans slice into it), the glyph resolver, the lexically scoped binder names (a bound variable shadows the table inside its binder's body), and the diagnostics this run accumulated.
interface LoweringContext {
  readonly input: string;
  readonly resolver: SymbolResolver;
  readonly binders: readonly string[];
  readonly diagnostics: LatexDiagnostic[];
  readonly sink?: LatexDiagnosticSink;
}

function diagnose(context: LoweringContext, code: LatexDiagnostic['code'], detail?: string): void {
  context.diagnostics.push({ code, ...(detail === undefined ? {} : { detail }) });
  context.sink?.({ code, ...(detail === undefined ? {} : { detail }) });
}

function unparsed(latex: string): MathExpression {
  return { kind: 'unparsed', latex };
}

function app(operator: string, args: readonly MathExpression[]): MathExpression {
  return { kind: 'app', operator, args: [...args] };
}

// The verbatim source substring a set of nodes came from -- what every degradation carries, per the schema's contract that a coverage gap stays visible as the exact source that resisted lowering. temml attaches positions to tokens and groups but not to the wrapper nodes built over them (supsub, genfrac, sqrt), so the walk descends: a wrapper without a position of its own is covered by the outermost span of its descendants. Nodes temml synthesised with no position and no positioned descendants (the radical-vinculum rule) contribute nothing; an all-synthetic set yields ''.
function spanOfNodes(context: LoweringContext, nodes: readonly TemmlNode[]): string {
  let start: number | undefined;
  let end: number | undefined;
  const visit = (node: TemmlNode): void => {
    const loc = node.loc;
    if (isRecord(loc) && typeof loc.start === 'number' && typeof loc.end === 'number') {
      if (start === undefined || loc.start < start) {
        start = loc.start;
      }
      if (end === undefined || loc.end > end) {
        end = loc.end;
      }
    }
    for (const value of Object.values(node)) {
      if (isTemmlNode(value)) {
        visit(value);
      } else if (Array.isArray(value)) {
        for (const element of value) {
          if (isTemmlNode(element)) {
            visit(element);
          }
        }
      }
    }
  };
  for (const node of nodes) {
    visit(node);
  }
  return start === undefined || end === undefined ? '' : context.input.slice(start, end);
}

// A sup/sub value as a node list: temml hands scripts as single nodes, with braces becoming an ordgroup -- unwrapped here so `^{n+1}` and `^n` reach the same lowering path. Styling wrappers unwrap the same way.
function nodesOfScript(script: unknown): readonly TemmlNode[] | undefined {
  if (!isTemmlNode(script)) {
    return undefined;
  }
  if (script.type === 'ordgroup' || WRAPPER_TYPES.has(script.type)) {
    const body = script.body;
    return Array.isArray(body) && body.every(isTemmlNode) ? body : undefined;
  }
  return [script];
}

// -- The lowering levels --

// A node list with binary/relation operators folded: partition at operator atoms, lower each run as a term, then fold left-to-right. This is where `a + b = c` becomes eq(add(a, b), c), and where unmapped operators (\pm, \approx, \to) and malformed operator placement (a trailing '+', an empty middle run) degrade the whole list to one `unparsed` node -- there is no mechanical reading of a sequence this function cannot fold.
function lowerNodeList(nodes: readonly TemmlNode[], context: LoweringContext): MathExpression {
  const present = nodes.filter((node) => !PRESENTATION_ONLY_TYPES.has(node.type));
  const segments: TemmlNode[][] = [];
  const operators: string[] = [];
  let current: TemmlNode[] = [];
  let unmappable: string | undefined;
  for (const node of present) {
    const operator = operatorOfNode(node);
    if (operator !== undefined) {
      segments.push(current);
      operators.push(operator);
      current = [];
      continue;
    }
    if (isOperatorAtom(node)) {
      unmappable = unmappable ?? (nodeText(node) ?? node.type);
      continue;
    }
    current.push(node);
  }
  segments.push(current);
  if (unmappable !== undefined) {
    const detail = spanOfNodes(context, present) || unmappable;
    diagnose(context, 'latex/operator-unmapped', detail);
    return unparsed(detail);
  }
  const [firstSegment = [], ...restSegments] = segments;
  if (operators.length === 0) {
    return lowerTerm(firstSegment, context);
  }
  const detail = spanOfNodes(context, present);
  if (firstSegment.length === 0) {
    const leading = operators[0];
    const secondSegment = restSegments[0] ?? [];
    if (leading !== SUBTRACT_OPERATOR || secondSegment.length === 0) {
      diagnose(context, 'latex/operator-placement-unparsed', detail);
      return unparsed(detail);
    }
    return fold(app(UNARY_MINUS_OPERATOR, [lowerTerm(secondSegment, context)]), operators.slice(1), restSegments.slice(1), context, detail);
  }
  return fold(lowerTerm(firstSegment, context), operators, restSegments, context, detail);
}

// Whether this node is an atom in the bin/rel families carrying an operator glyph this registry does not map -- the unmapped ones (\pm between two operands) that must degrade the sequence rather than be dropped.
function isOperatorAtom(node: TemmlNode): boolean {
  return node.type === 'atom' && (node.family === 'bin' || node.family === 'rel');
}

function operatorOfNode(node: TemmlNode): string | undefined {
  // Operator mapping keys off the atom's own text, not its family: TeX relabels a binary operator's atom by position (a leading '-' arrives as family 'open', an operator before another operator as 'ord'), which is a RENDERING convention about spacing, not a statement that the glyph stopped being an operator -- '-' at the head of `-x + y` is still subtraction-shaped and still lowers through the unary-minus reading below.
  if (node.type === 'atom') {
    const text = nodeText(node);
    if (text === undefined) {
      return undefined;
    }
    return BINARY_ATOM_OPERATORS[text] ?? RELATION_ATOM_OPERATORS[text];
  }
  // '/' is a textord, not an atom, but a/b is as mechanically division as \frac{a}{b} -- the same operator, reached by the inline spelling.
  if (node.type === 'textord' && nodeText(node) === '/') {
    return 'math:divide';
  }
  return undefined;
}

function fold(first: MathExpression, operators: readonly string[], segments: readonly TemmlNode[][], context: LoweringContext, detail: string): MathExpression {
  let folded = first;
  for (let index = 0; index < operators.length; index += 1) {
    const operator = operators[index];
    const segmentNodes = segments[index];
    if (operator === undefined || segmentNodes === undefined) {
      throw new Error('operator and segment lists diverged while folding a lowered sequence');
    }
    if (segmentNodes.length === 0) {
      diagnose(context, 'latex/operator-placement-unparsed', detail);
      return unparsed(detail);
    }
    folded = app(operator, [folded, lowerTerm(segmentNodes, context)]);
  }
  return folded;
}

// A run of nodes with no binary/relation operator inside: binders and named functions consume the rest of the run, digit runs fold into one numeric literal, and ANY remaining adjacency degrades to one `unparsed` node -- the juxtaposition rule. Juxtaposition is where the issue draws the line between mechanical and context-starved: `mc^2`, `f(x)`, `2(x+1)` all have multiplication AND function application as defensible readings, and LaTeX notation cannot say which, so the run stays visible data with a diagnostic instead of becoming a guess.
function lowerTerm(nodes: readonly TemmlNode[], context: LoweringContext): MathExpression {
  return lowerTermItems(termItems(nodes), context);
}

function lowerTermItems(items: readonly TermItem[], context: LoweringContext): MathExpression {
  const first = items[0];
  if (first === undefined) {
    diagnose(context, 'latex/construct-unparsed');
    return unparsed('');
  }
  if (first.kind === 'node') {
    const binder = readBinder(first.node, context);
    if (binder.status === 'binder') {
      const rest = items.slice(1);
      const body = rest.length === 0 ? implicitArgument(context) : lowerTermItems(rest, { ...context, binders: [binder.binder, ...context.binders] });
      return { kind: binder.kind, binder: binder.binder, lower: binder.lower, upper: binder.upper, body };
    }
    if (binder.status === 'degraded') {
      return unparsed(binder.detail);
    }
    const namedFunction = namedFunctionOfOp(first.node);
    if (namedFunction !== undefined) {
      const rest = items.slice(1);
      const argument = rest.length === 0 ? implicitArgument(context) : lowerTermItems(rest, context);
      return app(namedFunction, [argument]);
    }
  }
  const lowered = lowerTermItem(first, context);
  if (items.length > 1) {
    const detail = spanOfNodes(context, nodesOfItems(items));
    diagnose(context, 'latex/juxtaposition-unparsed', detail);
    return unparsed(detail);
  }
  return lowered;
}

function nodesOfItems(items: readonly TermItem[]): readonly TemmlNode[] {
  const nodes: TemmlNode[] = [];
  for (const item of items) {
    if (item.kind === 'node') {
      nodes.push(item.node);
    } else {
      nodes.push(...item.nodes);
    }
  }
  return nodes;
}

// A binder or named function whose run held nothing after it: the application still lowers, with the missing operand itself an `unparsed` node so the gap is data.
function implicitArgument(context: LoweringContext): MathExpression {
  diagnose(context, 'latex/construct-unparsed');
  return unparsed('');
}

// Fold runs of digit textords into single numeric items, leaving every other node as its own item.
function termItems(nodes: readonly TemmlNode[]): readonly TermItem[] {
  const items: TermItem[] = [];
  let digits: string[] = [];
  let digitNodes: TemmlNode[] = [];
  const flushDigits = (): void => {
    if (digits.length > 0) {
      items.push({ kind: 'number', literal: digits.join(''), nodes: digitNodes });
      digits = [];
      digitNodes = [];
    }
  };
  for (const node of nodes) {
    const text = nodeText(node);
    if (node.type === 'textord' && text !== undefined && (numericText(text) || text === '.')) {
      digits.push(text);
      digitNodes.push(node);
      continue;
    }
    flushDigits();
    items.push({ kind: 'node', node });
  }
  flushDigits();
  return items;
}

function lowerTermItem(item: TermItem, context: LoweringContext): MathExpression {
  if (item.kind === 'number') {
    const rational = decimalToRational(item.literal);
    if (rational === undefined) {
      diagnose(context, 'latex/construct-unparsed', item.literal);
      return unparsed(item.literal);
    }
    return { kind: 'num', numerator: rational.numerator, denominator: rational.denominator };
  }
  return lowerNode(item.node, context);
}

// A single node. Everything that is not one of the mechanical constructs below degrades to its own verbatim span with a construct diagnostic -- the total-by-degradation contract.
function lowerNode(node: TemmlNode, context: LoweringContext): MathExpression {
  switch (node.type) {
    case 'mathord': {
      const glyph = glyphOfNode(node);
      return glyph === undefined ? degradeNode(node, context) : symbolExpression(glyph, context);
    }
    case 'textord': {
      const text = nodeText(node);
      if (text === undefined) {
        return degradeNode(node, context);
      }
      if (/^[0-9]$/.test(text)) {
        return { kind: 'num', numerator: text, denominator: '1' };
      }
      const glyph = glyphOfSymbolText(text);
      return glyph === undefined ? degradeNode(node, context) : symbolExpression(glyph, context);
    }
    case 'atom': {
      // bin/rel atoms that reach here sit where no operator folding applies (a lone '=', a '+' with nothing around it); punct/open/close atoms are interval-and-list notation the grammar has no reading for. All degrade.
      return degradeNode(node, context);
    }
    case 'genfrac':
      return lowerGenfrac(node, context);
    case 'sqrt':
      return lowerSqrt(node, context);
    case 'supsub':
      return lowerSupsub(node, context);
    case 'op':
      // Ops that reach here have no argument following them in their run (a bare \sum or \sin); the term level handles every scripted binder and every applied function.
      return degradeNode(node, context);
    case 'ordgroup':
    case 'styling':
    case 'color': {
      const body = node.body;
      if (!Array.isArray(body) || !body.every(isTemmlNode)) {
        return degradeNode(node, context);
      }
      return lowerNodeList(body, context);
    }
    case 'delimiter':
    case 'leftright':
      return lowerGrouping(node, context);
    case 'array':
      return lowerArray(node, context);
    case 'text': {
      const detail = spanOfNodes(context, [node]);
      diagnose(context, 'latex/text-unparsed', detail);
      return unparsed(detail);
    }
    default:
      return degradeNode(node, context);
  }
}

function degradeNode(node: TemmlNode, context: LoweringContext): MathExpression {
  const span = spanOfNodes(context, [node]);
  const detail = span !== '' ? span : (nodeText(node) ?? node.type);
  diagnose(context, 'latex/construct-unparsed', detail);
  return unparsed(detail);
}

function symbolExpression(glyph: string, context: LoweringContext): MathExpression {
  // The lexical rule: an in-scope binder's name shadows everything else -- the bound variable is local to the binder's body, and its id is the binder name itself rather than a table reference.
  if (context.binders.includes(glyph)) {
    return { kind: 'sym', id: glyph };
  }
  return { kind: 'sym', id: context.resolver.resolve(glyph) };
}

// \frac -- the one generalised fraction that is unambiguously division: a bar, no delimiters. \binom and friends (delimiters drawn around them) and the bar-less \genfrac forms degrade rather than become a division they do not assert. temml spells "no delimiter" as null on the genfrac node, so absence is null-or-undefined on both fields.
function lowerGenfrac(node: TemmlNode, context: LoweringContext): MathExpression {
  const hasBar = node.hasBarLine !== false;
  const delimited = (node.leftDelim !== null && node.leftDelim !== undefined) || (node.rightDelim !== null && node.rightDelim !== undefined);
  if (!hasBar || delimited || !isTemmlNode(node.numer) || !isTemmlNode(node.denom)) {
    const detail = spanOfNodes(context, [node]);
    diagnose(context, 'latex/genfrac-unparsed', detail);
    return unparsed(detail);
  }
  return app('math:divide', [lowerNode(node.numer, context), lowerNode(node.denom, context)]);
}

// Radicals: \sqrt{x} is math:sqrt; \sqrt[n]{x} is x raised to the exact rational 1/n -- the mechanical identity between radical index and rational exponent, with the exponent itself built as a division so n never rounds. temml spells "no index" as null on the sqrt node.
function lowerSqrt(node: TemmlNode, context: LoweringContext): MathExpression {
  const index = node.index === null ? undefined : node.index;
  if (!isTemmlNode(node.body) || (index !== undefined && !isTemmlNode(index))) {
    return degradeNode(node, context);
  }
  const body = lowerNode(node.body, context);
  if (index === undefined) {
    return app('math:sqrt', [body]);
  }
  return app('math:pow', [body, app('math:divide', [{ kind: 'num', numerator: '1', denominator: '1' }, lowerNode(index, context)])]);
}

// A grouping construct -- bare parenthesised (content) arrives as a 'delimiter' node, \left(...\right) as 'leftright'. Both lower their inner sequence, so (a + b)^2 becomes pow(add(a, b), 2); a grouping adjacent to anything else was already degraded by the term level's juxtaposition rule. A grouping wrapping exactly one array node is a bracketed matrix (pmatrix, bmatrix) -- the wrapper is presentation, the array is the content.
function lowerGrouping(node: TemmlNode, context: LoweringContext): MathExpression {
  const body = node.body;
  if (!Array.isArray(body) || !body.every(isTemmlNode)) {
    return degradeNode(node, context);
  }
  if (body.length === 1) {
    const only = body[0];
    if (only?.type === 'array') {
      return lowerArray(only, context);
    }
  }
  return lowerNodeList(body, context);
}

// The matrix environments: rows of cells, each cell lowered whole. Layout-semantic environments (align, cases, aligned -- anything carrying envClasses) and column-spec arrays with separators degrade, and so does a ragged body, because the schema's matrix demands equal row widths and inventing padding cells would be a silent guess.
function lowerArray(node: TemmlNode, context: LoweringContext): MathExpression {
  const separated = Array.isArray(node.cols) && node.cols.some((col) => !isTemmlNode(col) || col.type === 'separator');
  const body = node.body;
  const envClasses = node.envClasses;
  const layoutEnvironment = Array.isArray(envClasses) && envClasses.length > 0;
  if (layoutEnvironment || separated || !Array.isArray(body)) {
    const detail = spanOfNodes(context, [node]);
    diagnose(context, layoutEnvironment ? 'latex/array-environment-unparsed' : 'latex/construct-unparsed', detail);
    return unparsed(detail);
  }
  const rows: MathExpression[][] = [];
  for (const row of body) {
    if (!Array.isArray(row) || !row.every(isTemmlNode)) {
      return degradeNode(node, context);
    }
    rows.push(row.map((cell) => lowerNode(cell, context)));
  }
  if (rows.length > 0 && new Set(rows.map((row) => row.length)).size > 1) {
    const detail = spanOfNodes(context, [node]);
    diagnose(context, 'latex/construct-unparsed', detail);
    return unparsed(detail);
  }
  return { kind: 'matrix', rows };
}

// -- Scripts --

// The one place presentation is allowed to change SEMANTICS by lookup: a subscript makes a distinct symbol identity (x_1 is never x times 1 -- subscripting is how notation spells "another symbol"), resolved through the symbol table like any other glyph; a superscript is exponentiation UNLESS the table already curates the scripted form as one symbol (a document where an embellished pair is a single named quantity -- the table says so, the notation cannot).
function lowerSupsub(node: TemmlNode, context: LoweringContext): MathExpression {
  const binder = readBinder(node, context);
  if (binder.status === 'binder') {
    // A scripted Sigma reached as a bare node rather than a term head: it owns no summand here, and that gap stays an unparsed body.
    return { kind: binder.kind, binder: binder.binder, lower: binder.lower, upper: binder.upper, body: implicitArgument(context) };
  }
  if (binder.status === 'degraded') {
    return unparsed(binder.detail);
  }
  const detail = spanOfNodes(context, [node]);
  const base = isTemmlNode(node.base) ? node.base : undefined;
  const sub = node.sub === undefined ? undefined : nodesOfScript(node.sub);
  const sup = node.sup === undefined ? undefined : nodesOfScript(node.sup);
  if (sub !== undefined) {
    const subWritten = simpleScriptGlyph(sub);
    const baseGlyph = base !== undefined && (base.type === 'mathord' || base.type === 'textord') ? glyphOfNode(base) : undefined;
    if (baseGlyph === undefined || subWritten === undefined) {
      diagnose(context, 'latex/subscript-unparsed', detail);
      return unparsed(detail);
    }
    const subscriptedGlyph = `${baseGlyph}_${subWritten}`;
    if (sup === undefined) {
      return symbolExpression(subscriptedGlyph, context);
    }
    const tripleGlyph = `${subscriptedGlyph}^${scriptWrittenForm(sup, context)}`;
    if (context.resolver.isCurated(tripleGlyph)) {
      return symbolExpression(tripleGlyph, context);
    }
    return app('math:pow', [symbolExpression(subscriptedGlyph, context), lowerNodeList(sup, context)]);
  }
  if (sup === undefined) {
    return degradeNode(node, context);
  }
  const exponent = lowerNodeList(sup, context);
  if (base === undefined) {
    return degradeNode(node, context);
  }
  if (base.type !== 'mathord' && base.type !== 'textord') {
    const loweredBase = lowerNode(base, context);
    if (loweredBase.kind === 'unparsed') {
      diagnose(context, 'latex/script-base-unparsed', detail);
      return unparsed(detail);
    }
    return app('math:pow', [loweredBase, exponent]);
  }
  const baseGlyph = glyphOfNode(base);
  if (baseGlyph === undefined) {
    return degradeNode(node, context);
  }
  const scriptedGlyph = `${baseGlyph}^${scriptWrittenForm(sup, context)}`;
  if (context.resolver.isCurated(scriptedGlyph)) {
    return symbolExpression(scriptedGlyph, context);
  }
  return app('math:pow', [symbolExpression(baseGlyph, context), exponent]);
}

// The written form of a superscript run, for the combined glyphs the table curates ('x' + '2' -> 'x^2'): the verbatim source slice when the nodes carry positions, else the concatenated glyph texts. Verbatim first because the glyph field is "the written form as it appears in presentation".
function scriptWrittenForm(nodes: readonly TemmlNode[], context: LoweringContext): string {
  const span = spanOfNodes(context, nodes);
  if (span !== '') {
    return span;
  }
  return nodes.map((node) => glyphOfNode(node) ?? nodeText(node) ?? '').join('');
}

// Whether a subscript run is a simple symbol suffix -- every node a plain glyph (letter, digit, or symbol command) with nothing structural inside. 'max', 'ij', '1' qualify; 'i+1', '(n)' do not, and their construct degrades rather than becoming a mangled identity.
function simpleScriptGlyph(nodes: readonly TemmlNode[]): string | undefined {
  const parts: string[] = [];
  for (const node of nodes) {
    const text = nodeText(node);
    if (node.type === 'mathord') {
      const glyph = glyphOfNode(node);
      if (glyph === undefined) {
        return undefined;
      }
      parts.push(glyph);
      continue;
    }
    if (node.type === 'textord' && text !== undefined && /^[0-9A-Za-z]$/.test(text)) {
      parts.push(text);
      continue;
    }
    return undefined;
  }
  return parts.length === 0 ? undefined : parts.join('');
}

// -- Binders and named functions --

// Reading a scripted big operator. A supsub whose base is a scripted Sigma or Product is a binder that OWNS the rest of its term (the summand/product term) -- the term level consults this before anything else, which is what makes \sum_{i=1}^{n} i^2 lower as one binder rather than a Sigma juxtaposed against its summand. \int is an op too but never a binder: the grammar's binders are exactly sum and prod, so integrals degrade as constructs and stay visible.
type BinderRead =
  | { readonly status: 'binder'; readonly kind: 'sum' | 'prod'; readonly binder: string; readonly lower: MathExpression; readonly upper: MathExpression }
  | { readonly status: 'degraded'; readonly detail: string }
  | { readonly status: 'not-a-binder' };

function readBinder(node: TemmlNode, context: LoweringContext): BinderRead {
  if (node.type !== 'supsub') {
    return { status: 'not-a-binder' };
  }
  const base = isTemmlNode(node.base) ? node.base : undefined;
  if (base?.type !== 'op' || base?.symbol !== true || typeof base?.name !== 'string') {
    return { status: 'not-a-binder' };
  }
  if (base.name !== '\\sum' && base.name !== '\\prod') {
    return { status: 'not-a-binder' };
  }
  const kind = base.name === '\\sum' ? 'sum' : 'prod';
  const detail = spanOfNodes(context, [node]);
  const sub = node.sub === undefined ? undefined : nodesOfScript(node.sub);
  const sup = node.sup === undefined ? undefined : nodesOfScript(node.sup);
  const upper = sup === undefined ? implicitBound(context) : lowerNodeList(sup, context);
  // `_{name = expression}`
  if ((sub?.length ?? 0) >= 3) {
    const first = sub?.[0];
    const relation = sub?.[1];
    const rest = sub?.slice(2) ?? [];
    const firstGlyph = first?.type === 'mathord' ? glyphOfNode(first) : undefined;
    if (firstGlyph !== undefined && relation?.type === 'atom' && nodeText(relation) === '=') {
      return { status: 'binder', kind, binder: firstGlyph, lower: lowerNodeList(rest, context), upper };
    }
  }
  // A bare bound glyph (`\sum_i`): the binder still lowers, the missing range stays visible.
  if ((sub?.length ?? 0) === 1 && sub !== undefined) {
    const singleGlyph = simpleScriptGlyph(sub);
    if (singleGlyph !== undefined) {
      diagnose(context, 'latex/binder-bound-implicit', detail);
      return { status: 'binder', kind, binder: singleGlyph, lower: unparsed(''), upper };
    }
  }
  diagnose(context, 'latex/binder-bound-unreadable', detail);
  return { status: 'degraded', detail };
}

// An absent upper bound: the binder node still carries the slot, filled with an `unparsed` node so the gap is data, plus the diagnostic naming it.
function implicitBound(context: LoweringContext): MathExpression {
  diagnose(context, 'latex/binder-bound-implicit');
  return unparsed('');
}

// A named function op in head position (sin, log, exp): it consumes the rest of its run as its single argument, the same ownership rule a binder plays -- \sin x + 1 is add(sin(x), 1) because the run is split at '+' before the function ever looks.
function namedFunctionOfOp(node: TemmlNode): string | undefined {
  if (node.type !== 'op' || node.symbol === true) {
    return undefined;
  }
  const name = typeof node.name === 'string' ? node.name : undefined;
  return name === undefined ? undefined : NAMED_FUNCTION_OPERATORS[name];
}

// -- The public surface --

export interface LowerLatexOptions {
  // The document symbol table's entries this lowering resolves glyphs against (a formula's `sym` references stay small because definitions live in the table once per document).
  readonly symbolEntries?: readonly MathSymbolEntry[];
  // A sink receiving every diagnostic as it is emitted, alongside the aggregated copy on the result.
  readonly sink?: LatexDiagnosticSink;
}

export interface LatexLoweringResult {
  // The lowered expression -- always defined, worst case one `unparsed` node carrying the verbatim source.
  readonly expression: MathExpression;
  readonly diagnostics: readonly LatexDiagnostic[];
  // Table entries minted for glyphs no supplied entry covered, merge-ready for the document's symbolTable so every emitted `sym` reference resolves.
  readonly mintedSymbols: readonly MathSymbolEntry[];
}

// Lower one LaTeX string to a MathExpression. Total: a string the pinned parser cannot read returns an `unparsed` root with a parse-error diagnostic, never a throw.
export function lowerLatex(latex: string, options?: LowerLatexOptions): LatexLoweringResult {
  return lowerParsed(latex, parseLatex(latex), options);
}

function lowerParsed(latex: string, parsed: LatexParseResult, options?: LowerLatexOptions): LatexLoweringResult {
  if (latex.trim() === '') {
    return { expression: unparsed(''), diagnostics: [], mintedSymbols: [] };
  }
  const resolver = new SymbolResolver(options?.symbolEntries ?? []);
  const context: LoweringContext = { input: latex, resolver, binders: [], diagnostics: [], sink: options?.sink };
  if (parsed.status === 'unparseable') {
    diagnose(context, 'latex/parse-error', parsed.message);
    return { expression: unparsed(latex), diagnostics: context.diagnostics, mintedSymbols: resolver.mintedEntries() };
  }
  const expression = lowerNodeList(parsed.nodes, context);
  return { expression, diagnostics: context.diagnostics, mintedSymbols: resolver.mintedEntries() };
}

export interface LatexFormulaOptions extends LowerLatexOptions {
  // The provenance source recorded on the formula (a pipeline stage such as 'lowered:latex', or a format origin such as 'markdown:math-block'); the edit trail starts empty because lowering is the birth of the pair, not an edit to it.
  readonly source?: string;
}

export interface LatexFormulaResult {
  readonly formula: ContentFormula;
  readonly diagnostics: readonly LatexDiagnostic[];
  readonly mintedSymbols: readonly MathSymbolEntry[];
}

// Lower one LaTeX string into a whole ContentFormula: the verbatim presentation layer, the presentation-MathML tree (so the formula renders through the existing MathML engine instead of degrading to text), the lowered content layer, and provenance. Both layers are stored as-authoritative per the schema -- nothing here derives one from the other at rest.
export function latexToFormula(latex: string, options?: LatexFormulaOptions): LatexFormulaResult {
  const parsed = parseLatex(latex);
  const lowering = lowerParsed(latex, parsed, options);
  const mathml: MathMlNode[] = parsed.status === 'parsed' ? [...parsed.mathml] : [];
  const formula: ContentFormula = {
    mathml,
    presentation: { latex },
    content: lowering.expression,
    provenance: { source: options?.source ?? 'lowered:latex', editTrail: [] },
  };
  return { formula, diagnostics: lowering.diagnostics, mintedSymbols: lowering.mintedSymbols };
}
