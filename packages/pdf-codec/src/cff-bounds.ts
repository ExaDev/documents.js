import { CFF_DICT_OP_CHARSTRINGS, CFF_DICT_OP_PRIVATE, CFF_DICT_OP_ROS, CFF_DICT_OP_SUBRS, parseCffDict, readCffIndex } from './cff';
import type { CffIndex } from './cff';
import type { GlyphInkBounds } from './glyph-bounds';
import { hasBytes, u8, u16, u32 } from './sfnt';

// Per-glyph ink bounding boxes for a CFF-flavoured font, computed by interpreting each glyph's own Type 2 charstring (CFF 1.0 spec, and Adobe's "The Type 2 Charstring Format", TN 5177).
//
// Why this exists at all, when glyf.ts gets the same answer for free. A TrueType glyph stores its own bounding box in the ten bytes at the head of its 'glyf' entry, so measuring one is a read. A CFF glyph stores no bounding box anywhere: the charstring is a program, and the only way to know what area it covers is to run it. The embedded math font (STIX Two Math) is CFF-flavoured -- see math-font.ts -- so without this module every math token would be stuck with the font-wide nominal ascent/descent, which is precisely the uniform, glyph-blind vertical extent per-glyph ink bounds exist to replace.
//
// This is an outline WALKER, not a rasteriser: it tracks the current point through every path-construction operator and accumulates the extent of the path, and draws nothing. Curve extents are computed exactly -- the real extrema of each cubic Bezier, from the roots of its own derivative, not the convex hull of its control points -- so a bound reported here is genuinely tight rather than merely a safe over-estimate. Hint operators are decoded only far enough to know how many bytes a following hintmask consumes; the hints themselves are ignored, since they are rasterisation advice about a shape this module already has exactly.
//
// Scope, and what returns `undefined` rather than a wrong answer:
//   * A CID-keyed CFF (a Top DICT carrying ROS). Its local subroutines live per-FD behind an FDArray/FDSelect pair rather than in one Private DICT, and this package refuses CID-keyed CFF programs elsewhere for its own reasons (see cff-probe.ts). Reported as `undefined` for the whole font.
//   * `endchar` used in its four-argument "seac-like" form, which composes a glyph out of two standard-encoding glyphs. Resolving those two needs the charset and the Standard Encoding table, neither of which this module reads. Reported as `undefined` for that one glyph -- the caller falls back to nominal metrics for it rather than getting a box missing its accent.
//   * The arithmetic, storage, and conditional escaped operators (12 3 `and` through 12 29 `ifelse`, and 12 23 `random`). These appear in no font this package has met; a charstring using one is reported as `undefined` for that glyph rather than silently mis-walked.
// A glyph that legitimately draws nothing (a space, whose charstring is just a width and `endchar`) reports `undefined` too -- it has no ink, so it has no ink box.

export interface CffGlyphBounds {
  readonly numGlyphs: number;
  // `undefined` for a glyph ID outside the font, a glyph that draws nothing, or a charstring this module declines to walk (see the scope list above).
  bounds(glyphId: number): GlyphInkBounds | undefined;
}

const CFF_HEADER_MIN_SIZE = 4;
const CFF_MAJOR_VERSION = 1;
const CFF_HEADER_SIZE_OFFSET = 2;

// Charstring number encoding (TN 5177 section 3.2). Unlike a DICT, a charstring has no 29/30 forms: 28 is a 16-bit integer and 255 is a 16.16 fixed-point number.
const CS_OPERAND_INT16 = 28;
const CS_OPERAND_FIXED = 255;
const CS_OPERAND_SMALL_FIRST = 32;
const CS_OPERAND_SMALL_LAST = 246;
const CS_OPERAND_MEDIUM_FIRST = 247;
const CS_OPERAND_MEDIUM_LAST = 250;
const CS_OPERAND_NEGATIVE_MEDIUM_FIRST = 251;
const CS_OPERAND_NEGATIVE_MEDIUM_LAST = 254;
const CS_OPERAND_SMALL_BIAS = 139;
const CS_OPERAND_MEDIUM_BIAS = 108;
const CS_OPERAND_MEDIUM_FIRST_BYTE_BIAS = 247;
const CS_OPERAND_NEGATIVE_MEDIUM_FIRST_BYTE_BIAS = 251;
const BYTE_RADIX = 256;
const FIXED_POINT_SCALE = 65536;

// Operators (TN 5177 Appendix A).
const OP_HSTEM = 1;
const OP_VSTEM = 3;
const OP_VMOVETO = 4;
const OP_RLINETO = 5;
const OP_HLINETO = 6;
const OP_VLINETO = 7;
const OP_RRCURVETO = 8;
const OP_CALLSUBR = 10;
const OP_RETURN = 11;
const OP_ESCAPE = 12;
const OP_ENDCHAR = 14;
const OP_HSTEMHM = 18;
const OP_HINTMASK = 19;
const OP_CNTRMASK = 20;
const OP_RMOVETO = 21;
const OP_HMOVETO = 22;
const OP_VSTEMHM = 23;
const OP_RCURVELINE = 24;
const OP_RLINECURVE = 25;
const OP_VVCURVETO = 26;
const OP_HHCURVETO = 27;
const OP_CALLGSUBR = 29;
const OP_VHCURVETO = 30;
const OP_HVCURVETO = 31;
// Every operator is 0..31 (with 28 the one operand encoding inside that range); anything above is operand data.
const CHARSTRING_OPERATOR_LIMIT = 31;

const ESC_HFLEX = 34;
const ESC_FLEX = 35;
const ESC_HFLEX1 = 36;
const ESC_FLEX1 = 37;

// Subroutine index bias (TN 5177 section 4.7): a subroutine number is stored relative to the middle of its own INDEX, so the bias depends on how many subroutines that INDEX holds.
const SUBR_BIAS_SMALL_LIMIT = 1240;
const SUBR_BIAS_MEDIUM_LIMIT = 33900;
const SUBR_BIAS_SMALL = 107;
const SUBR_BIAS_MEDIUM = 1131;
const SUBR_BIAS_LARGE = 32768;

const HINT_MASK_BITS_PER_BYTE = 8;
const STEM_ARGS_PER_STEM = 2;
// The interpreter's own operand stack limit (TN 5177 section 3.1 puts it at 48). A charstring pushing past it is malformed rather than merely unusual.
const MAX_OPERAND_STACK = 48;
// The spec's own subroutine nesting limit (section 4.7).
const MAX_SUBR_DEPTH = 10;
// A ceiling on total operators executed for one glyph, so a crafted charstring whose subroutines call each other in a cycle terminates instead of running until the stack overflows. Real charstrings are two orders of magnitude below this.
const MAX_OPERATIONS_PER_GLYPH = 100_000;

// The seac-like form of `endchar` (TN 5177 Appendix C): four arguments (adx, ady, bchar, achar), optionally preceded by a width.
const ENDCHAR_SEAC_ARG_COUNT = 4;

function subrBias(count: number): number {
  if (count < SUBR_BIAS_SMALL_LIMIT) {
    return SUBR_BIAS_SMALL;
  }
  if (count < SUBR_BIAS_MEDIUM_LIMIT) {
    return SUBR_BIAS_MEDIUM;
  }
  return SUBR_BIAS_LARGE;
}

interface BoundsBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  drawn: boolean;
}

interface WalkState {
  x: number;
  y: number;
  readonly stack: number[];
  stems: number;
  widthParsed: boolean;
  operations: number;
  readonly box: BoundsBox;
}

function includePoint(box: BoundsBox, x: number, y: number): void {
  box.minX = Math.min(box.minX, x);
  box.minY = Math.min(box.minY, y);
  box.maxX = Math.max(box.maxX, x);
  box.maxY = Math.max(box.maxY, y);
  box.drawn = true;
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const s = 1 - t;
  return s * s * s * p0 + 3 * s * s * t * p1 + 3 * s * t * t * p2 + t * t * t * p3;
}

// The exact extent of one axis of a cubic Bezier: its endpoints, plus the curve's value at each root of its own derivative that lies strictly inside the segment. B'(t) = 3[(-p0 + 3p1 - 3p2 + p3)t^2 + 2(p0 - 2p1 + p2)t + (p1 - p0)], so the roots come from an ordinary quadratic -- with the degenerate linear case (a == 0) handled separately, which is what a curve whose control points happen to be collinear in this axis produces.
function includeCubicAxis(p0: number, p1: number, p2: number, p3: number, apply: (value: number) => void): void {
  apply(p0);
  apply(p3);
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (a === 0) {
    if (b !== 0) {
      roots.push(-c / b);
    }
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  for (const t of roots) {
    if (t > 0 && t < 1) {
      apply(cubicAt(p0, p1, p2, p3, t));
    }
  }
}

function includeCubic(box: BoundsBox, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  includeCubicAxis(x0, x1, x2, x3, (value) => {
    box.minX = Math.min(box.minX, value);
    box.maxX = Math.max(box.maxX, value);
  });
  includeCubicAxis(y0, y1, y2, y3, (value) => {
    box.minY = Math.min(box.minY, value);
    box.maxY = Math.max(box.maxY, value);
  });
  box.drawn = true;
}

// Moves the current point to the end of a cubic whose control points are given as deltas from it, accumulating the curve's exact extent on the way.
function curveTo(state: WalkState, dx1: number, dy1: number, dx2: number, dy2: number, dx3: number, dy3: number): void {
  const x0 = state.x;
  const y0 = state.y;
  const x1 = x0 + dx1;
  const y1 = y0 + dy1;
  const x2 = x1 + dx2;
  const y2 = y1 + dy2;
  const x3 = x2 + dx3;
  const y3 = y2 + dy3;
  includeCubic(state.box, x0, y0, x1, y1, x2, y2, x3, y3);
  state.x = x3;
  state.y = y3;
}

function lineTo(state: WalkState, dx: number, dy: number): void {
  includePoint(state.box, state.x, state.y); // the segment's own start, which is only already in the box if something drew it there -- a lineto immediately after a moveto is the case that needs it
  state.x += dx;
  state.y += dy;
  includePoint(state.box, state.x, state.y);
}

function moveTo(state: WalkState, dx: number, dy: number): void {
  state.x += dx;
  state.y += dy;
  // A moveto's own destination is deliberately NOT added to the box: an unclosed, undrawn subpath start contributes no ink, and a font whose charstring ends with a stray moveto (or begins with one far from its outline, as several do) would otherwise report a box stretched to reach it. Whatever the following path operator draws includes this point through its own start.
}

// Takes the leading width operand off the stack, where the operator that just ran declares one. A charstring's optional leading width is detected purely by arity: the FIRST stack-clearing operator carries one extra argument when the glyph's width differs from the Private DICT's own defaultWidthX (TN 5177 section 3.1). The width value itself is not read here -- hmtx already supplies every advance width this package uses.
function takeWidth(state: WalkState, evenArgs: boolean, expected: number): void {
  if (state.widthParsed) {
    return;
  }
  state.widthParsed = true;
  const extra = evenArgs ? state.stack.length % STEM_ARGS_PER_STEM !== 0 : state.stack.length > expected;
  if (extra) {
    state.stack.shift();
  }
}

interface CharstringContext {
  readonly charStrings: CffIndex;
  readonly globalSubrs: CffIndex;
  readonly localSubrs: CffIndex | undefined;
  readonly globalBias: number;
  readonly localBias: number;
}

interface CharstringOperand {
  readonly value: number;
  readonly endOffset: number;
}

// Decodes the operand at `offset`, or `undefined` where the byte there introduces no operand at all (an operator, 0..31 apart from 28) or where the operand it does introduce runs off the end of the charstring. The two cases are told apart by the caller from the byte's own value, since only one of them is an error.
function readOperand(code: Uint8Array<ArrayBuffer>, offset: number): CharstringOperand | undefined {
  const b0 = code[offset]!;
  if (b0 === CS_OPERAND_INT16) {
    if (!hasBytes(code, offset + 1, 2)) {
      return undefined;
    }
    const raw = u16(code, offset + 1);
    return { value: raw >= 0x8000 ? raw - 0x1_0000 : raw, endOffset: offset + 3 };
  }
  if (b0 === CS_OPERAND_FIXED) {
    if (!hasBytes(code, offset + 1, 4)) {
      return undefined;
    }
    return { value: (u32(code, offset + 1) | 0) / FIXED_POINT_SCALE, endOffset: offset + 5 };
  }
  if (b0 >= CS_OPERAND_SMALL_FIRST && b0 <= CS_OPERAND_SMALL_LAST) {
    return { value: b0 - CS_OPERAND_SMALL_BIAS, endOffset: offset + 1 };
  }
  if (b0 >= CS_OPERAND_MEDIUM_FIRST && b0 <= CS_OPERAND_MEDIUM_LAST) {
    if (!hasBytes(code, offset + 1, 1)) {
      return undefined;
    }
    return { value: (b0 - CS_OPERAND_MEDIUM_FIRST_BYTE_BIAS) * BYTE_RADIX + u8(code, offset + 1) + CS_OPERAND_MEDIUM_BIAS, endOffset: offset + 2 };
  }
  if (b0 >= CS_OPERAND_NEGATIVE_MEDIUM_FIRST && b0 <= CS_OPERAND_NEGATIVE_MEDIUM_LAST) {
    if (!hasBytes(code, offset + 1, 1)) {
      return undefined;
    }
    return { value: -(b0 - CS_OPERAND_NEGATIVE_MEDIUM_FIRST_BYTE_BIAS) * BYTE_RADIX - u8(code, offset + 1) - CS_OPERAND_MEDIUM_BIAS, endOffset: offset + 2 };
  }
  return undefined;
}

// Runs one charstring (a glyph's own, or a subroutine's), returning false where the walk must be abandoned: a malformed or truncated charstring, a nesting/operation limit, or an operator this module deliberately does not interpret.
function execute(code: Uint8Array<ArrayBuffer>, state: WalkState, context: CharstringContext, depth: number): boolean {
  if (depth > MAX_SUBR_DEPTH) {
    return false;
  }
  const stack = state.stack;
  let i = 0;
  while (i < code.length) {
    state.operations += 1;
    if (state.operations > MAX_OPERATIONS_PER_GLYPH) {
      return false;
    }
    const b0 = code[i]!;

    const operand = readOperand(code, i);
    if (operand !== undefined) {
      if (stack.length >= MAX_OPERAND_STACK) {
        return false;
      }
      stack.push(operand.value);
      i = operand.endOffset;
      continue;
    }
    if (b0 > CHARSTRING_OPERATOR_LIMIT) {
      return false; // an operand byte whose own value ran off the end of the charstring: readOperand declined it, and it is not an operator either
    }
    i += 1;

    switch (b0) {
      case OP_HSTEM:
      case OP_VSTEM:
      case OP_HSTEMHM:
      case OP_VSTEMHM: {
        takeWidth(state, true, 0);
        state.stems += Math.floor(stack.length / STEM_ARGS_PER_STEM);
        stack.length = 0;
        break;
      }
      case OP_HINTMASK:
      case OP_CNTRMASK: {
        // A hintmask may be the charstring's first stack-clearing operator, in which case any operands still on the stack are an implicit vstem list (and may carry the leading width ahead of them).
        takeWidth(state, true, 0);
        state.stems += Math.floor(stack.length / STEM_ARGS_PER_STEM);
        stack.length = 0;
        const maskBytes = Math.ceil(state.stems / HINT_MASK_BITS_PER_BYTE);
        if (!hasBytes(code, i, maskBytes)) {
          return false;
        }
        i += maskBytes;
        break;
      }
      case OP_RMOVETO: {
        takeWidth(state, false, 2);
        if (stack.length < 2) {
          return false;
        }
        moveTo(state, stack[stack.length - 2]!, stack[stack.length - 1]!);
        stack.length = 0;
        break;
      }
      case OP_HMOVETO:
      case OP_VMOVETO: {
        takeWidth(state, false, 1);
        if (stack.length < 1) {
          return false;
        }
        const delta = stack[stack.length - 1]!;
        moveTo(state, b0 === OP_HMOVETO ? delta : 0, b0 === OP_HMOVETO ? 0 : delta);
        stack.length = 0;
        break;
      }
      case OP_RLINETO: {
        for (let k = 0; k + 1 < stack.length; k += 2) {
          lineTo(state, stack[k]!, stack[k + 1]!);
        }
        stack.length = 0;
        break;
      }
      case OP_HLINETO:
      case OP_VLINETO: {
        let horizontal = b0 === OP_HLINETO;
        for (const delta of stack) {
          lineTo(state, horizontal ? delta : 0, horizontal ? 0 : delta);
          horizontal = !horizontal;
        }
        stack.length = 0;
        break;
      }
      case OP_RRCURVETO: {
        for (let k = 0; k + 5 < stack.length; k += 6) {
          curveTo(state, stack[k]!, stack[k + 1]!, stack[k + 2]!, stack[k + 3]!, stack[k + 4]!, stack[k + 5]!);
        }
        stack.length = 0;
        break;
      }
      case OP_RCURVELINE: {
        let k = 0;
        for (; k + 5 < stack.length - 2; k += 6) {
          curveTo(state, stack[k]!, stack[k + 1]!, stack[k + 2]!, stack[k + 3]!, stack[k + 4]!, stack[k + 5]!);
        }
        if (k + 1 < stack.length) {
          lineTo(state, stack[k]!, stack[k + 1]!);
        }
        stack.length = 0;
        break;
      }
      case OP_RLINECURVE: {
        let k = 0;
        for (; k + 1 < stack.length - 6; k += 2) {
          lineTo(state, stack[k]!, stack[k + 1]!);
        }
        if (k + 5 < stack.length) {
          curveTo(state, stack[k]!, stack[k + 1]!, stack[k + 2]!, stack[k + 3]!, stack[k + 4]!, stack[k + 5]!);
        }
        stack.length = 0;
        break;
      }
      case OP_VVCURVETO:
      case OP_HHCURVETO: {
        // Both take an optional leading cross-axis delta applied to the FIRST curve's first control point only, marked by an odd argument count.
        let k = 0;
        let firstCross = 0;
        if (stack.length % 4 === 1) {
          firstCross = stack[0]!;
          k = 1;
        }
        for (; k + 3 < stack.length; k += 4) {
          const cross = k <= 1 ? firstCross : 0;
          if (b0 === OP_VVCURVETO) {
            curveTo(state, cross, stack[k]!, stack[k + 1]!, stack[k + 2]!, 0, stack[k + 3]!);
          } else {
            curveTo(state, stack[k]!, cross, stack[k + 1]!, stack[k + 2]!, stack[k + 3]!, 0);
          }
        }
        stack.length = 0;
        break;
      }
      case OP_VHCURVETO:
      case OP_HVCURVETO: {
        // Alternating groups of four, each curve starting on the axis the previous one ended off; a trailing fifth argument on the LAST group gives that curve's final delta on the other axis.
        let horizontal = b0 === OP_HVCURVETO;
        let k = 0;
        while (stack.length - k >= 4) {
          const last = stack.length - k === 5;
          const extra = last ? stack[k + 4]! : 0;
          if (horizontal) {
            curveTo(state, stack[k]!, 0, stack[k + 1]!, stack[k + 2]!, extra, stack[k + 3]!);
          } else {
            curveTo(state, 0, stack[k]!, stack[k + 1]!, stack[k + 2]!, stack[k + 3]!, extra);
          }
          k += 4;
          horizontal = !horizontal;
        }
        stack.length = 0;
        break;
      }
      case OP_CALLSUBR:
      case OP_CALLGSUBR: {
        const index = stack.pop();
        if (index === undefined) {
          return false;
        }
        const subrs = b0 === OP_CALLSUBR ? context.localSubrs : context.globalSubrs;
        const bias = b0 === OP_CALLSUBR ? context.localBias : context.globalBias;
        const code2 = subrs?.entry(index + bias);
        if (code2 === undefined) {
          return false;
        }
        if (!execute(code2, state, context, depth + 1)) {
          return false;
        }
        break;
      }
      case OP_RETURN: {
        return true;
      }
      case OP_ENDCHAR: {
        // endchar's own arity rule is its own, not takeWidth's: it takes either nothing or four seac-like arguments, so a leading width shows up as exactly one or five operands. Anything else on the stack is a malformed charstring rather than a width.
        if (!state.widthParsed) {
          state.widthParsed = true;
          if (stack.length === 1 || stack.length === ENDCHAR_SEAC_ARG_COUNT + 1) {
            stack.shift();
          }
        }
        // Four remaining arguments make this the seac-like accented-character form, which needs the charset and Standard Encoding to resolve into two other glyphs -- see this module's own scope note.
        return stack.length < ENDCHAR_SEAC_ARG_COUNT;
      }
      case OP_ESCAPE: {
        if (i >= code.length) {
          return false;
        }
        const b1 = code[i]!;
        i += 1;
        if (!executeEscaped(b1, state)) {
          return false;
        }
        break;
      }
      default: {
        return false; // 13, 15, 16, 17: reserved, and present in no valid charstring
      }
    }
  }
  return true;
}

// The flex family (TN 5177 section 4.2): two cubics drawn as one operator, in four encodings that each omit whichever deltas the construction fixes. Every other escaped operator -- the arithmetic, storage, and conditional set -- returns false rather than being approximated.
function executeEscaped(operator: number, state: WalkState): boolean {
  const stack = state.stack;
  const startY = state.y;
  if (operator === ESC_FLEX) {
    if (stack.length < 13) {
      return false;
    }
    curveTo(state, stack[0]!, stack[1]!, stack[2]!, stack[3]!, stack[4]!, stack[5]!);
    curveTo(state, stack[6]!, stack[7]!, stack[8]!, stack[9]!, stack[10]!, stack[11]!); // the 13th argument is fd, the flex depth -- a rasterisation hint with no effect on the curve
    stack.length = 0;
    return true;
  }
  if (operator === ESC_HFLEX) {
    if (stack.length < 7) {
      return false;
    }
    // dx1 dx2 dy2 dx3 dx4 dx5 dx6: the first curve rises by dy2 at its second control point and the second falls by the same amount, so both the join and the final point sit on the original y.
    curveTo(state, stack[0]!, 0, stack[1]!, stack[2]!, stack[3]!, 0);
    curveTo(state, stack[4]!, 0, stack[5]!, -stack[2]!, stack[6]!, 0);
    stack.length = 0;
    return true;
  }
  if (operator === ESC_HFLEX1) {
    if (stack.length < 9) {
      return false;
    }
    // dx1 dy1 dx2 dy2 dx3 dx4 dx5 dy5 dx6: the final point returns to the original y.
    curveTo(state, stack[0]!, stack[1]!, stack[2]!, stack[3]!, stack[4]!, 0);
    const dy5 = stack[7]!;
    curveTo(state, stack[5]!, 0, stack[6]!, dy5, stack[8]!, startY - (state.y + dy5));
    stack.length = 0;
    return true;
  }
  if (operator === ESC_FLEX1) {
    if (stack.length < 11) {
      return false;
    }
    // dx1 dy1 dx2 dy2 dx3 dy3 dx4 dy4 dx5 dy5 d6: the last delta applies to whichever axis the five preceding deltas moved further along, and the other axis returns to where the flex started.
    const startX = state.x;
    let dx = 0;
    let dy = 0;
    for (let k = 0; k < 10; k += 2) {
      dx += stack[k]!;
      dy += stack[k + 1]!;
    }
    curveTo(state, stack[0]!, stack[1]!, stack[2]!, stack[3]!, stack[4]!, stack[5]!);
    const controlX = state.x + stack[6]! + stack[8]!;
    const controlY = state.y + stack[7]! + stack[9]!;
    if (Math.abs(dx) > Math.abs(dy)) {
      curveTo(state, stack[6]!, stack[7]!, stack[8]!, stack[9]!, stack[10]!, startY - controlY);
    } else {
      curveTo(state, stack[6]!, stack[7]!, stack[8]!, stack[9]!, startX - controlX, stack[10]!);
    }
    stack.length = 0;
    return true;
  }
  return false;
}

function readPrivateSubrs(bytes: Uint8Array<ArrayBuffer>, privateOperands: readonly number[] | undefined): CffIndex | undefined {
  if (privateOperands === undefined || privateOperands.length < 2) {
    return undefined;
  }
  const size = privateOperands[0]!;
  const offset = privateOperands[1]!;
  if (!Number.isInteger(size) || !Number.isInteger(offset) || !hasBytes(bytes, offset, size)) {
    return undefined;
  }
  const privateDict = parseCffDict(bytes.subarray(offset, offset + size));
  const subrsOffset = privateDict?.get(CFF_DICT_OP_SUBRS)?.[0];
  if (subrsOffset === undefined || !Number.isInteger(subrsOffset)) {
    return undefined;
  }
  // A Private DICT's Subrs offset is relative to the Private DICT's own start, not to the start of the font (spec Table 23).
  return readCffIndex(bytes, offset + subrsOffset);
}

// Reads a bare CFF font program into a per-glyph ink-bounds lookup, or `undefined` for a program this module will not walk at all: an unreadable header/Name INDEX/Top DICT, a CID-keyed font, or a missing or unreadable CharStrings INDEX. Each glyph's charstring is walked at most once; the result is memoised, since a document setting the same character repeatedly would otherwise re-run the same program per occurrence.
export function parseCffGlyphBounds(bytes: Uint8Array<ArrayBuffer>): CffGlyphBounds | undefined {
  if (!hasBytes(bytes, 0, CFF_HEADER_MIN_SIZE) || u8(bytes, 0) !== CFF_MAJOR_VERSION) {
    return undefined;
  }
  const headerSize = u8(bytes, CFF_HEADER_SIZE_OFFSET);
  if (headerSize < CFF_HEADER_MIN_SIZE) {
    return undefined;
  }
  const nameIndex = readCffIndex(bytes, headerSize);
  if (nameIndex === undefined) {
    return undefined;
  }
  const topDictIndex = readCffIndex(bytes, nameIndex.endOffset);
  const topDictBytes = topDictIndex?.entry(0);
  if (topDictIndex === undefined || topDictBytes === undefined) {
    return undefined;
  }
  const topDict = parseCffDict(topDictBytes);
  if (topDict === undefined || topDict.has(CFF_DICT_OP_ROS)) {
    return undefined; // CID-keyed: local subroutines are per-FD, which this module does not resolve
  }
  const stringIndex = readCffIndex(bytes, topDictIndex.endOffset);
  if (stringIndex === undefined) {
    return undefined;
  }
  const globalSubrs = readCffIndex(bytes, stringIndex.endOffset);
  if (globalSubrs === undefined) {
    return undefined;
  }
  const charStringsOffset = topDict.get(CFF_DICT_OP_CHARSTRINGS)?.[0];
  if (charStringsOffset === undefined || !Number.isInteger(charStringsOffset)) {
    return undefined;
  }
  const charStrings = readCffIndex(bytes, charStringsOffset);
  if (charStrings === undefined) {
    return undefined;
  }
  const localSubrs = readPrivateSubrs(bytes, topDict.get(CFF_DICT_OP_PRIVATE));

  const context: CharstringContext = {
    charStrings,
    globalSubrs,
    localSubrs,
    globalBias: subrBias(globalSubrs.count),
    localBias: localSubrs === undefined ? 0 : subrBias(localSubrs.count),
  };

  const memo = new Map<number, GlyphInkBounds | undefined>();
  return {
    numGlyphs: charStrings.count,
    bounds(glyphId: number): GlyphInkBounds | undefined {
      if (memo.has(glyphId)) {
        return memo.get(glyphId);
      }
      const computed = computeBounds(glyphId, context);
      memo.set(glyphId, computed);
      return computed;
    },
  };
}

function computeBounds(glyphId: number, context: CharstringContext): GlyphInkBounds | undefined {
  const code = context.charStrings.entry(glyphId);
  if (code === undefined) {
    return undefined;
  }
  const state: WalkState = {
    x: 0,
    y: 0,
    stack: [],
    stems: 0,
    widthParsed: false,
    operations: 0,
    box: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, drawn: false },
  };
  if (!execute(code, state, context, 0) || !state.box.drawn) {
    return undefined;
  }
  return { xMin: state.box.minX, yMin: state.box.minY, xMax: state.box.maxX, yMax: state.box.maxY };
}
