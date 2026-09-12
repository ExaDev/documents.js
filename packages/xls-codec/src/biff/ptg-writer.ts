import { columnLettersToIndex } from "document-schema.js";

import { errorCodeOf } from "./errors";
import { FTAB_FIXED_ARITY, FTAB_IFTAB_BY_NAME } from "./ptg-functions";
import { writeShortXLUnicodeString } from "./string-writer";
import { BiffWriteError } from "./write-errors";

// The write-side counterpart of biff/ptg.ts: same-sheet formula TEXT compiled back into a Formula record's own rgce token stream ([MS-XLS] 2.5.198). Scoped to exactly the subset of Excel's formula grammar that round-trips through this package's own reader: literal operands, same-sheet cell/range references, every arithmetic/comparison/unary/percent operator, explicit parentheses, and a function call resolved by name against ptg-functions.ts's own Ftab table -- see this package's README for the writer's own scope table.
//
// Deliberately unsupported, each because writing bytes for it would either produce a formula this package's own reader cannot read back, or would need infrastructure this writer does not yet have: a 3D (cross-sheet or external-workbook) reference -- resolving one to an ixti needs a SupBook/ExternSheet pair, which globals-writer.ts only ever writes today for the two built-in print-settings names, not for an arbitrary formula; an array-constant literal (`{1,2;3,4}`) or a CSE array formula -- both need a PtgExtraArray/Array-record trailer this writer does not build; a defined name -- document-schema.js's spreadsheet model has nowhere a user-defined name lives, so there is nothing to resolve one against; and a function name outside ptg-functions.ts's own Ftab vocabulary (Excel 2007+ added many worksheet functions BIFF8's own Ftab enumeration never named, resolved instead through a PtgNameX/add-in mechanism this writer does not implement). Every one of these throws BiffWriteError naming the construct rather than emitting a plausible-looking but unreadable token stream.

const PTG_ADD = 0x03;
const PTG_SUB = 0x04;
const PTG_MUL = 0x05;
const PTG_DIV = 0x06;
const PTG_POWER = 0x07;
const PTG_CONCAT = 0x08;
const PTG_LT = 0x09;
const PTG_LE = 0x0a;
const PTG_EQ = 0x0b;
const PTG_GE = 0x0c;
const PTG_GT = 0x0d;
const PTG_NE = 0x0e;
const PTG_UPLUS = 0x12;
const PTG_UMINUS = 0x13;
const PTG_PERCENT = 0x14;
const PTG_PAREN = 0x15;
const PTG_MISSARG = 0x16;
const PTG_STR = 0x17;
const PTG_ERR = 0x1c;
const PTG_BOOL = 0x1d;
const PTG_INT = 0x1e;
const PTG_NUM = 0x1f;
/** The "value" class of the reference/function token family -- see biff/ptg.ts's own top comment for why REF/VALUE/ARRAY share one on-disk field layout and this writer, like every other real minimal BIFF8 writer, does not need to distinguish them for an ordinary (non-array) formula. */
const PTG_REF_VALUE = 0x44;
const PTG_AREA_VALUE = 0x45;
const PTG_FUNC_VALUE = 0x41;
const PTG_FUNCVAR_VALUE = 0x42;

const COLUMN_RELATIVE_BIT = 0x4000;
const ROW_RELATIVE_BIT = 0x8000;

/** BIFF8's own 16-bit row index and 8-bit column index ceilings ([MS-XLS] 2.4.221's Rw structure and 2.4.53's Col256U structure) -- the identical grid workbook/sheet-writer.ts's own checkedCellPosition enforces for a cell record's own row/column. */
const MAX_ROW_INDEX = 0xffff;
const MAX_COLUMN_INDEX = 0xff;

/** PtgInt's own ceiling ([MS-XLS] 2.5.198.28): an unsigned 16-bit integer. A plain non-negative integer literal above this, or one carrying a decimal point or exponent in its own source text, is written as PtgNum instead, so the reader's own String(cursor.u16())/String(cursor.f64()) reconstructs the identical text. */
const PTG_INT_MAX = 0xffff;

class RgceBuilder {
  private readonly parts: (readonly number[])[] = [];

  push(...bytes: readonly number[]): this {
    this.parts.push(bytes);
    return this;
  }

  u16(value: number): this {
    const bits = value & 0xffff;
    return this.push(bits & 0xff, (bits >>> 8) & 0xff);
  }

  f64(value: number): this {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setFloat64(0, value, true);
    return this.push(...new Uint8Array(buffer));
  }

  concat(bytes: Uint8Array<ArrayBuffer>): this {
    this.parts.push(Array.from(bytes));
    return this;
  }

  build(): Uint8Array<ArrayBuffer> {
    const flat = this.parts.flat();
    return new Uint8Array(flat);
  }
}

// --- Tokenizer ---

type TokenType =
  | "number"
  | "string"
  | "error"
  | "word"
  | "dollar"
  | "colon"
  | "comma"
  | "lparen"
  | "rparen"
  | "op"
  | "eof";

interface Token {
  readonly type: TokenType;
  readonly text: string;
}

const NUMBER_RE = /^[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/;
const WORD_RE = /^[A-Za-z][A-Za-z0-9_.]*/;
const ERROR_RE = /^#[A-Za-z0-9/?!_]+/;
// Longest match first, so "<=" is not lexed as "<" followed by a dangling "=".
const OPERATORS: readonly string[] = [
  "<=",
  ">=",
  "<>",
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "<",
  ">",
  "=",
  "%",
];

// The one trailing sentinel every tokenize() call appends, shared rather than a fresh literal per call so FormulaParser.peek() can fall back to this exact value (see its own comment) without introducing a second, untested "eof"/"" literal of its own -- every assertion this module's own tests make about eof handling exercises this identical object via the real (non-fallback) path below.
const EOF_TOKEN: Token = { type: "eof", text: "" };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      index += 1;
      continue;
    }
    if (char === "$") {
      tokens.push({ type: "dollar", text: "$" });
      index += 1;
      continue;
    }
    if (char === ":") {
      tokens.push({ type: "colon", text: ":" });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma", text: "," });
      index += 1;
      continue;
    }
    if (char === "(") {
      tokens.push({ type: "lparen", text: "(" });
      index += 1;
      continue;
    }
    if (char === ")") {
      tokens.push({ type: "rparen", text: ")" });
      index += 1;
      continue;
    }
    if (char === '"') {
      let value = "";
      let cursor = index + 1;
      for (;;) {
        if (cursor >= text.length) {
          throw new BiffWriteError(
            `formula text ${JSON.stringify(text)} carries an unterminated string literal starting at offset ${index}`,
          );
        }
        const current = text.charAt(cursor);
        if (current === '"') {
          if (text.charAt(cursor + 1) === '"') {
            value += '"';
            cursor += 2;
            continue;
          }
          cursor += 1;
          break;
        }
        value += current;
        cursor += 1;
      }
      tokens.push({ type: "string", text: value });
      index = cursor;
      continue;
    }
    if (char === "#") {
      const match = ERROR_RE.exec(text.slice(index));
      if (match?.[0] === undefined) {
        throw new BiffWriteError(
          `formula text ${JSON.stringify(text)} carries an unrecognised error literal starting at offset ${index}`,
        );
      }
      tokens.push({ type: "error", text: match[0] });
      index += match[0].length;
      continue;
    }
    const numberMatch = NUMBER_RE.exec(text.slice(index));
    if (numberMatch?.[0] !== undefined) {
      tokens.push({ type: "number", text: numberMatch[0] });
      index += numberMatch[0].length;
      continue;
    }
    const wordMatch = WORD_RE.exec(text.slice(index));
    if (wordMatch?.[0] !== undefined) {
      tokens.push({ type: "word", text: wordMatch[0] });
      index += wordMatch[0].length;
      continue;
    }
    const op = OPERATORS.find((candidate) => text.startsWith(candidate, index));
    if (op !== undefined) {
      tokens.push({ type: "op", text: op });
      index += op.length;
      continue;
    }
    throw new BiffWriteError(
      `formula text ${JSON.stringify(text)} carries an unrecognised character ${JSON.stringify(char)} at offset ${index}`,
    );
  }
  tokens.push(EOF_TOKEN);
  return tokens;
}

// --- Parser: recursive descent over Excel's own documented operator precedence (https://support.microsoft.com/en-us/office/calculation-operators-and-precedence-in-excel), narrowed to the operators biff/ptg.ts's own reader reconstructs -- reference operators (: (space) ,) are handled structurally (a range's ':', a function call's ','), never as a generic binary operator. ---

interface CellPoint {
  readonly row: number;
  readonly column: number;
  readonly columnAbsolute: boolean;
  readonly rowAbsolute: boolean;
}

type FormulaNode =
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "str"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "err"; readonly code: number }
  | { readonly kind: "missarg" }
  | { readonly kind: "ref"; readonly point: CellPoint }
  | {
      readonly kind: "area";
      readonly start: CellPoint;
      readonly end: CellPoint;
    }
  | {
      readonly kind: "binary";
      readonly opcode: number;
      readonly left: FormulaNode;
      readonly right: FormulaNode;
    }
  | {
      readonly kind: "unary";
      readonly opcode: number;
      readonly operand: FormulaNode;
    }
  | { readonly kind: "percent"; readonly operand: FormulaNode }
  | { readonly kind: "paren"; readonly inner: FormulaNode }
  | {
      readonly kind: "call";
      readonly iftab: number;
      readonly variable: boolean;
      readonly args: readonly FormulaNode[];
    };

class FormulaParser {
  private readonly tokens: readonly Token[];
  private position = 0;
  private readonly sourceText: string;

  constructor(tokens: readonly Token[], sourceText: string) {
    this.tokens = tokens;
    this.sourceText = sourceText;
  }

  // tokenize() always appends EOF_TOKEN as the array's own last element, and every advance() call site is gated behind a check that the CURRENT token (from this same peek()) is a specific non-eof type -- so position + offset never steps past that trailing token, and the one call site passing offset 1 (parsePrimary's word-lookahead) only does so once the current token is already confirmed not to be eof. The `?? EOF_TOKEN` fallback is therefore never actually exercised by any formula this writer's own tokenizer can produce, but it costs no untested code of its own to state: it names the identical shared constant tokenize() itself would have placed there, already covered by this module's own tests of eof handling.
  private peek(offset = 0): Token {
    return this.tokens[this.position + offset] ?? EOF_TOKEN;
  }

  private advance(): Token {
    const token = this.peek();
    this.position += 1;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new BiffWriteError(
        `formula text ${JSON.stringify(this.sourceText)} expected a ${type} but found ${JSON.stringify(token.text)}`,
      );
    }
    return this.advance();
  }

  parseFormula(): FormulaNode {
    const node = this.parseComparison();
    this.expect("eof");
    return node;
  }

  private parseComparison(): FormulaNode {
    let node = this.parseConcat();
    for (;;) {
      const token = this.peek();
      const opcode = this.comparisonOpcode(token);
      if (opcode === undefined) {
        return node;
      }
      this.advance();
      const right = this.parseConcat();
      node = { kind: "binary", opcode, left: node, right };
    }
  }

  private comparisonOpcode(token: Token): number | undefined {
    if (token.type !== "op") return undefined;
    switch (token.text) {
      case "<":
        return PTG_LT;
      case "<=":
        return PTG_LE;
      case "=":
        return PTG_EQ;
      case ">=":
        return PTG_GE;
      case ">":
        return PTG_GT;
      case "<>":
        return PTG_NE;
      default:
        return undefined;
    }
  }

  private parseConcat(): FormulaNode {
    let node = this.parseAdditive();
    while (this.peek().type === "op" && this.peek().text === "&") {
      this.advance();
      const right = this.parseAdditive();
      node = { kind: "binary", opcode: PTG_CONCAT, left: node, right };
    }
    return node;
  }

  private parseAdditive(): FormulaNode {
    let node = this.parseMultiplicative();
    for (;;) {
      const token = this.peek();
      if (token.type !== "op" || (token.text !== "+" && token.text !== "-")) {
        return node;
      }
      this.advance();
      const right = this.parseMultiplicative();
      node = {
        kind: "binary",
        opcode: token.text === "+" ? PTG_ADD : PTG_SUB,
        left: node,
        right,
      };
    }
  }

  private parseMultiplicative(): FormulaNode {
    let node = this.parsePower();
    for (;;) {
      const token = this.peek();
      if (token.type !== "op" || (token.text !== "*" && token.text !== "/")) {
        return node;
      }
      this.advance();
      const right = this.parsePower();
      node = {
        kind: "binary",
        opcode: token.text === "*" ? PTG_MUL : PTG_DIV,
        left: node,
        right,
      };
    }
  }

  private parsePower(): FormulaNode {
    let node = this.parsePercent();
    while (this.peek().type === "op" && this.peek().text === "^") {
      this.advance();
      const right = this.parsePercent();
      node = { kind: "binary", opcode: PTG_POWER, left: node, right };
    }
    return node;
  }

  private parsePercent(): FormulaNode {
    let node = this.parseUnary();
    while (this.peek().type === "op" && this.peek().text === "%") {
      this.advance();
      node = { kind: "percent", operand: node };
    }
    return node;
  }

  private parseUnary(): FormulaNode {
    const token = this.peek();
    if (token.type === "op" && (token.text === "+" || token.text === "-")) {
      this.advance();
      const operand = this.parseUnary();
      return {
        kind: "unary",
        opcode: token.text === "+" ? PTG_UPLUS : PTG_UMINUS,
        operand,
      };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode {
    const token = this.peek();
    if (token.type === "number") {
      this.advance();
      return this.numberNode(token.text);
    }
    if (token.type === "string") {
      this.advance();
      return { kind: "str", value: token.text };
    }
    if (token.type === "error") {
      this.advance();
      const code = errorCodeOf(token.text);
      if (code === undefined) {
        throw new BiffWriteError(
          `formula text ${JSON.stringify(this.sourceText)} carries error literal ${token.text}, which is not one of the eight error values [MS-XLS] 2.5.10 defines`,
        );
      }
      return { kind: "err", code };
    }
    if (token.type === "lparen") {
      this.advance();
      const inner = this.parseComparison();
      this.expect("rparen");
      return { kind: "paren", inner };
    }
    if (token.type === "dollar") {
      return this.parseRefOrArea();
    }
    if (token.type === "word") {
      if (this.peek(1).type === "lparen") {
        return this.parseCall();
      }
      if (token.text === "TRUE" || token.text === "FALSE") {
        this.advance();
        return { kind: "bool", value: token.text === "TRUE" };
      }
      return this.parseRefOrArea();
    }
    throw new BiffWriteError(
      `formula text ${JSON.stringify(this.sourceText)} carries an unexpected token ${JSON.stringify(token.text)}`,
    );
  }

  private numberNode(text: string): FormulaNode {
    const value = Number.parseFloat(text);
    // NUMBER_RE never captures a sign or a leading digit outside 0-9, so `text` matching this plain-digit form always parseFloats to a non-negative whole number regardless of magnitude -- Number.isInteger(value) and value >= 0 would therefore always be true whenever this regex already is, and checking them again would only ever restate that fact, never narrow it further.
    if (/^[0-9]+$/.test(text) && value <= PTG_INT_MAX) {
      return { kind: "int", value };
    }
    return { kind: "num", value };
  }

  private parseCall(): FormulaNode {
    const nameToken = this.expect("word");
    this.expect("lparen");
    const args: FormulaNode[] = [];
    if (this.peek().type !== "rparen") {
      args.push(this.parseArgument());
      while (this.peek().type === "comma") {
        this.advance();
        args.push(this.parseArgument());
      }
    }
    this.expect("rparen");
    const iftab = FTAB_IFTAB_BY_NAME.get(nameToken.text);
    if (iftab === undefined) {
      throw new BiffWriteError(
        `formula text ${JSON.stringify(this.sourceText)} calls ${nameToken.text}(), which is not one of the built-in functions [MS-XLS] 2.5.198.17's own Ftab enumerates`,
      );
    }
    const fixedArity = FTAB_FIXED_ARITY.get(iftab);
    if (fixedArity !== undefined && fixedArity !== args.length) {
      throw new BiffWriteError(
        `formula text ${JSON.stringify(this.sourceText)} calls ${nameToken.text}() with ${args.length} argument(s), but [MS-XLS]'s own Ftab grammar fixes its arity at ${fixedArity}`,
      );
    }
    return {
      kind: "call",
      iftab,
      variable: fixedArity === undefined,
      args,
    };
  }

  private parseArgument(): FormulaNode {
    const token = this.peek();
    if (token.type === "comma" || token.type === "rparen") {
      return { kind: "missarg" };
    }
    return this.parseComparison();
  }

  private parseRefOrArea(): FormulaNode {
    const start = this.parseCellPoint();
    if (this.peek().type === "colon") {
      this.advance();
      const end = this.parseCellPoint();
      return { kind: "area", start, end };
    }
    return { kind: "ref", point: start };
  }

  /** One cell reference's own point, per its own leading `$` (column-absolute) and, for a column-only word, a trailing `$` (row-absolute) -- see this module's own top comment for why a plain (non-`$`-prefixed) reference always lexes as one combined letters-then-digits word token, while a `$`-separated one splits across a dollar/word/dollar/number sequence instead. */
  private parseCellPoint(): CellPoint {
    let columnAbsolute = false;
    if (this.peek().type === "dollar") {
      this.advance();
      columnAbsolute = true;
    }
    const word = this.expect("word");
    const combined = /^([A-Za-z]{1,3})([0-9]+)$/.exec(word.text);
    let columnLetters: string;
    let rowDigits: string;
    let rowAbsolute = false;
    if (combined?.[1] !== undefined && combined[2] !== undefined) {
      columnLetters = combined[1];
      rowDigits = combined[2];
    } else {
      if (!/^[A-Za-z]{1,3}$/.test(word.text)) {
        throw new BiffWriteError(
          `formula text ${JSON.stringify(this.sourceText)} carries ${JSON.stringify(word.text)}, which is not a valid cell reference`,
        );
      }
      columnLetters = word.text;
      if (this.peek().type === "dollar") {
        this.advance();
        rowAbsolute = true;
      }
      const rowToken = this.expect("number");
      if (!/^[0-9]+$/.test(rowToken.text)) {
        throw new BiffWriteError(
          `formula text ${JSON.stringify(this.sourceText)} carries ${JSON.stringify(word.text + rowToken.text)}, which is not a valid cell reference`,
        );
      }
      rowDigits = rowToken.text;
    }
    const column = columnLettersToIndex(columnLetters);
    const row = Number.parseInt(rowDigits, 10) - 1;
    if (
      column === undefined ||
      column > MAX_COLUMN_INDEX ||
      row < 0 ||
      row > MAX_ROW_INDEX
    ) {
      throw new BiffWriteError(
        `formula text ${JSON.stringify(this.sourceText)} references ${columnLetters}${rowDigits}, which is outside BIFF8's own grid (rows 1-${MAX_ROW_INDEX + 1}, columns A-IV)`,
      );
    }
    return { row, column, columnAbsolute, rowAbsolute };
  }
}

// --- Compiler: FormulaNode -> rgce bytes, postfix (reverse Polish) exactly as biff/ptg.ts's own reader expects to walk it. ---

function columnField(point: CellPoint): number {
  return (
    point.column |
    (point.columnAbsolute ? 0 : COLUMN_RELATIVE_BIT) |
    (point.rowAbsolute ? 0 : ROW_RELATIVE_BIT)
  );
}

type ParentNode = FormulaNode & {
  readonly kind: "binary" | "unary" | "percent" | "paren" | "call";
};

/** A worklist entry: "visit" pushes a node's own children (deepest first, so they pop and compile before it), or -- for a leaf with no children -- compiles it immediately; "emit" compiles a parent node's own opcode(s) once every child a prior "visit" of it pushed has already been popped and compiled. */
type CompileStep =
  | { readonly phase: "visit"; readonly node: FormulaNode }
  | { readonly phase: "emit"; readonly node: ParentNode };

function compileLeaf(
  builder: RgceBuilder,
  node: Exclude<FormulaNode, ParentNode>,
): void {
  switch (node.kind) {
    case "int":
      builder.push(PTG_INT).u16(node.value);
      return;
    case "num":
      builder.push(PTG_NUM).f64(node.value);
      return;
    case "str":
      builder.push(PTG_STR).concat(writeShortXLUnicodeString(node.value));
      return;
    case "bool":
      builder.push(PTG_BOOL, node.value ? 1 : 0);
      return;
    case "err":
      builder.push(PTG_ERR, node.code);
      return;
    case "missarg":
      builder.push(PTG_MISSARG);
      return;
    case "ref":
      builder
        .push(PTG_REF_VALUE)
        .u16(node.point.row)
        .u16(columnField(node.point));
      return;
    case "area":
      builder
        .push(PTG_AREA_VALUE)
        .u16(node.start.row)
        .u16(node.end.row)
        .u16(columnField(node.start))
        .u16(columnField(node.end));
      return;
  }
}

function compileParent(builder: RgceBuilder, node: ParentNode): void {
  switch (node.kind) {
    case "binary":
      builder.push(node.opcode);
      return;
    case "unary":
      builder.push(node.opcode);
      return;
    case "percent":
      builder.push(PTG_PERCENT);
      return;
    case "paren":
      builder.push(PTG_PAREN);
      return;
    case "call":
      if (node.variable) {
        if (node.args.length > 0xff) {
          throw new BiffWriteError(
            `a function call with ${node.args.length} arguments cannot be written: PtgFuncVar's own cparams field ([MS-XLS] 2.5.198.25) is a single byte, so it cannot exceed 255`,
          );
        }
        builder.push(PTG_FUNCVAR_VALUE, node.args.length).u16(node.iftab);
      } else {
        builder.push(PTG_FUNC_VALUE).u16(node.iftab);
      }
      return;
  }
}

function isParentNode(node: FormulaNode): node is ParentNode {
  return (
    node.kind === "binary" ||
    node.kind === "unary" ||
    node.kind === "percent" ||
    node.kind === "paren" ||
    node.kind === "call"
  );
}

/**
 * Compiles a FormulaNode tree to rgce bytes, postfix (reverse Polish) exactly as biff/ptg.ts's own reader expects to walk it -- an explicit worklist rather than a native recursive descent, so a formula built from many thousands of chained operators (a long but legitimate generated SUM(...)+SUM(...)+... chain, say) compiles by iterating this loop rather than by nesting one JavaScript call frame per operator, which would risk a stack overflow at a tree depth far shallower than MAX_RGCE_LENGTH's own byte ceiling below ever requires throwing for.
 */
function compileNode(builder: RgceBuilder, root: FormulaNode): void {
  const steps: CompileStep[] = [{ phase: "visit", node: root }];
  for (;;) {
    const step = steps.pop();
    if (step === undefined) {
      // The worklist is empty: every node visited pushed exactly the steps needed to compile it, and every one of those has now itself been popped and processed, so compilation is complete.
      return;
    }
    if (step.phase === "emit") {
      compileParent(builder, step.node);
      continue;
    }
    const { node } = step;
    if (!isParentNode(node)) {
      compileLeaf(builder, node);
      continue;
    }
    steps.push({ phase: "emit", node });
    switch (node.kind) {
      case "binary":
        steps.push({ phase: "visit", node: node.right });
        steps.push({ phase: "visit", node: node.left });
        break;
      case "unary":
      case "percent":
        steps.push({ phase: "visit", node: node.operand });
        break;
      case "paren":
        steps.push({ phase: "visit", node: node.inner });
        break;
      case "call":
        for (const arg of [...node.args].reverse()) {
          steps.push({ phase: "visit", node: arg });
        }
        break;
    }
  }
}

/** [MS-XLS] 2.5.198.3's own cce ceiling: a two-byte length field, so rgce itself can never exceed this regardless of the 8224-byte whole-record limit biff/record-writer.ts already enforces. */
const MAX_RGCE_LENGTH = 0xffff;

/**
 * Compiles same-sheet formula text into a Formula record's own rgce token stream -- the write-side counterpart of biff/ptg.ts's parseFormulaText, scoped to the subset this module's own top comment describes. Throws BiffWriteError, naming the construct, for anything outside that scope rather than emitting a token stream this package's own reader could not read back.
 */
export function compileFormulaText(text: string): Uint8Array<ArrayBuffer> {
  const tokens = tokenize(text);
  const parser = new FormulaParser(tokens, text);
  const node = parser.parseFormula();
  const builder = new RgceBuilder();
  compileNode(builder, node);
  const rgce = builder.build();
  if (rgce.length > MAX_RGCE_LENGTH) {
    throw new BiffWriteError(
      `formula text ${JSON.stringify(text)} compiles to ${rgce.length} bytes of rgce, above the ${MAX_RGCE_LENGTH}-byte ceiling its own cce field can hold`,
    );
  }
  return rgce;
}
