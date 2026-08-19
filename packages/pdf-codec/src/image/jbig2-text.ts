import type { ArithContexts, MqDecoder } from './jbig2-arith';
import { createArithContexts, createIntegerContexts, createSymbolIdContexts, decodeInteger, decodeSymbolId } from './jbig2-arith';
import type { Jbig2Bitmap, Jbig2CombinationOperator } from './jbig2-bitmap';
import { combineBitmap, createBitmap } from './jbig2-bitmap';
import type { Jbig2AtPixel } from './jbig2-generic';
import { Jbig2ParseError, Jbig2UnsupportedError } from './jbig2-errors';
import { GENERIC_CONTEXT_BITS, REFINEMENT_CONTEXT_BITS, decodeGenericRegion, decodeRefinementRegion } from './jbig2-generic';

// The symbol dictionary decoding procedure (ITU-T T.88 6.5) and the text region decoding procedure (6.4): how a scanned page of text is actually coded in practice. Rather than coding every pixel of the page through a generic region, an encoder collects the distinct connected components ("symbols") into a dictionary, codes each one once, and then codes the page as a sequence of (symbol, position) instances.
//
// Only the arithmetic variants are implemented here (SDHUFF = 0, SBHUFF = 0). The Huffman variants are a wholly separate coding path -- standard tables B.1-B.15 plus optional custom table segments -- and no mainstream JBIG2 encoder that targets PDF emits them; a stream that uses one raises Jbig2UnsupportedError rather than being silently mis-decoded.

// Which corner of a symbol instance's bitmap the decoded (S, T) coordinate pair actually locates. The two edges are all the decoding procedure needs from T.88's REFCORNER, so the four named values resolve to exactly that pair rather than being carried around as a raw code.
export interface Jbig2ReferenceCorner {
  // The S coordinate names the instance's right edge rather than its left.
  readonly right: boolean;
  // The T coordinate names its bottom edge rather than its top.
  readonly bottom: boolean;
}

// T.88 Table 34's own ordering: 0 = BOTTOMLEFT, 1 = TOPLEFT, 2 = BOTTOMRIGHT, 3 = TOPRIGHT.
const REFERENCE_CORNERS: readonly Jbig2ReferenceCorner[] = [
  { right: false, bottom: true },
  { right: false, bottom: false },
  { right: true, bottom: true },
  { right: true, bottom: false },
];

export function referenceCornerFromCode(code: number): Jbig2ReferenceCorner | undefined {
  return REFERENCE_CORNERS[code];
}

// T.88 6.5.8.2.3 and 7.4.3.1.7: the number of bits an IAID-coded symbol index occupies. Written as a loop rather than Math.ceil(Math.log2(n)) so no floating-point rounding sits between a symbol count and a bit count, and floored at 1 because a one-symbol dictionary still transmits a (single, always-zero) symbol ID.
export function symbolCodeLength(symbolCount: number): number {
  let bits = 1;
  while (1 << bits < symbolCount) {
    bits++;
  }
  return bits;
}

// The full set of adaptive arithmetic contexts a symbol dictionary or text region decode carries. T.88 gives each integer field its own independent context array (IADH, IADW, ...), which is what keeps a height difference's statistics from polluting a horizontal position's.
export interface TextArithContexts {
  readonly iadh: ArithContexts;
  readonly iadw: ArithContexts;
  readonly iaex: ArithContexts;
  readonly iaai: ArithContexts;
  readonly iadt: ArithContexts;
  readonly iafs: ArithContexts;
  readonly iads: ArithContexts;
  readonly iait: ArithContexts;
  readonly iari: ArithContexts;
  readonly iardw: ArithContexts;
  readonly iardh: ArithContexts;
  readonly iardx: ArithContexts;
  readonly iardy: ArithContexts;
  readonly iaid: ArithContexts;
  readonly generic: ArithContexts;
  readonly refinement: ArithContexts;
}

export function createTextArithContexts(genericTemplate: number, refinementTemplate: number, symbolIdBits: number): TextArithContexts {
  return {
    iadh: createIntegerContexts(),
    iadw: createIntegerContexts(),
    iaex: createIntegerContexts(),
    iaai: createIntegerContexts(),
    iadt: createIntegerContexts(),
    iafs: createIntegerContexts(),
    iads: createIntegerContexts(),
    iait: createIntegerContexts(),
    iari: createIntegerContexts(),
    iardw: createIntegerContexts(),
    iardh: createIntegerContexts(),
    iardx: createIntegerContexts(),
    iardy: createIntegerContexts(),
    iaid: createSymbolIdContexts(symbolIdBits),
    generic: createArithContexts(GENERIC_CONTEXT_BITS[genericTemplate] ?? 16),
    refinement: createArithContexts(REFINEMENT_CONTEXT_BITS[refinementTemplate] ?? 13),
  };
}

// --- The text region decoding procedure (T.88 6.4.5). ---

export interface TextRegionParams {
  readonly width: number;
  readonly height: number;
  readonly instanceCount: number;
  readonly stripSize: number;
  readonly symbols: readonly Jbig2Bitmap[];
  readonly defaultPixel: number;
  readonly combinationOperator: Jbig2CombinationOperator;
  readonly transposed: boolean;
  readonly referenceCorner: Jbig2ReferenceCorner;
  readonly dsOffset: number;
  readonly refine: boolean;
  readonly refinementTemplate: number;
  readonly refinementAt: readonly Jbig2AtPixel[];
}

// Where a symbol instance's own top-left pixel lands, given the decoded (s, t) pair, the corner that pair actually names, and whether the region is transposed. T.88 6.4.5 step 3(c)(x) states this as eight separate cases; the two coordinates are simply swapped between the transposed and non-transposed halves, and within each half the "right"/"bottom" corners shift back by the instance's own extent.
//
// Transposed placement pairs the two coordinates the other way round -- (T, S) rather than (S, T) -- but which edge each names is still read off the same corner, so `right` continues to govern the horizontal shift and `bottom` the vertical one.
function instanceTopLeft(s: number, t: number, width: number, height: number, corner: Jbig2ReferenceCorner, transposed: boolean): { readonly x: number; readonly y: number } {
  const across = transposed ? t : s;
  const down = transposed ? s : t;
  return { x: corner.right ? across - width + 1 : across, y: corner.bottom ? down - height + 1 : down };
}

// An integer field that a well-formed stream never codes as OOB: only IADS (the end of a text strip) and IADW (the end of a symbol dictionary height class) legitimately do, and both are handled explicitly at their own call sites. Anything else reaching OOB means the bitstream stopped making sense, which fails loudly rather than substituting a zero that would silently displace everything after it.
function requireInteger(value: number | undefined, field: string): number {
  if (value === undefined) {
    throw new Jbig2ParseError(`JBIG2 ${field} decoded as out-of-band, which is not a value this field can take`);
  }
  return value;
}

export function decodeTextRegion(params: TextRegionParams, mq: MqDecoder, contexts: TextArithContexts, symbolIdBits: number): Jbig2Bitmap {
  const region = createBitmap(params.width, params.height, params.defaultPixel);
  // T.88 6.4.5 step 2: the first strip's own T coordinate is transmitted negated.
  let stripT = -requireInteger(decodeInteger(mq, contexts.iadt), 'IADT') * params.stripSize;
  let firstS = 0;
  let instances = 0;

  while (instances < params.instanceCount) {
    stripT += requireInteger(decodeInteger(mq, contexts.iadt), 'IADT') * params.stripSize;
    firstS += requireInteger(decodeInteger(mq, contexts.iafs), 'IAFS');
    let currentS = firstS;

    for (;;) {
      const currentT = params.stripSize === 1 ? 0 : requireInteger(decodeInteger(mq, contexts.iait), 'IAIT');
      const t = stripT + currentT;
      const id = decodeSymbolId(mq, contexts.iaid, symbolIdBits);
      let symbol = params.symbols[id];
      if (symbol === undefined) {
        throw new Jbig2ParseError(`text region referenced symbol ${String(id)}, outside the ${String(params.symbols.length)}-symbol set its segment declares`);
      }
      if (params.refine && requireInteger(decodeInteger(mq, contexts.iari), 'IARI') !== 0) {
        symbol = refineInstance(symbol, params, mq, contexts);
      }

      // T.88 6.4.5 steps 3(c)(viii) and 3(c)(xi): CURS advances by the instance's own extent either side of the placement, depending on which corner the (S, T) pair names. S runs along the strip -- horizontally when not transposed, vertically when it is -- so the corner edge that decides which side the advance falls on flips with it.
      const advance = (params.transposed ? symbol.height : symbol.width) - 1;
      const advanceBefore = params.transposed ? params.referenceCorner.bottom : params.referenceCorner.right;
      if (advanceBefore) {
        currentS += advance;
      }
      const position = instanceTopLeft(currentS, t, symbol.width, symbol.height, params.referenceCorner, params.transposed);
      combineBitmap(region, symbol, position.x, position.y, params.combinationOperator);
      if (!advanceBefore) {
        currentS += advance;
      }

      instances++;
      if (instances > params.instanceCount) {
        throw new Jbig2ParseError(`text region coded more symbol instances than the ${String(params.instanceCount)} its own SBNUMINSTANCES declares`);
      }
      const nextDelta = decodeInteger(mq, contexts.iads);
      if (nextDelta === undefined) {
        break; // OOB: the end of this strip, per T.88 6.4.5 step 3(c)(ii).
      }
      currentS += nextDelta + params.dsOffset;
    }
  }
  return region;
}

// T.88 6.4.11: a symbol instance that differs slightly from its dictionary entry is coded as a refinement of it. The reference offset is halved-and-shifted exactly as 6.4.11 step (xi) states, so an instance one pixel wider than its symbol stays centred rather than drifting left.
function refineInstance(symbol: Jbig2Bitmap, params: TextRegionParams, mq: MqDecoder, contexts: TextArithContexts): Jbig2Bitmap {
  const deltaWidth = decodeInteger(mq, contexts.iardw) ?? 0;
  const deltaHeight = decodeInteger(mq, contexts.iardh) ?? 0;
  const deltaX = decodeInteger(mq, contexts.iardx) ?? 0;
  const deltaY = decodeInteger(mq, contexts.iardy) ?? 0;
  return decodeRefinementRegion(
    symbol.width + deltaWidth,
    symbol.height + deltaHeight,
    {
      template: params.refinementTemplate,
      tpgron: false,
      at: params.refinementAt,
      reference: symbol,
      dx: Math.floor(deltaWidth / 2) + deltaX,
      dy: Math.floor(deltaHeight / 2) + deltaY,
    },
    mq,
    contexts.refinement,
  );
}

// --- The symbol dictionary decoding procedure (T.88 6.5.5). ---

export interface SymbolDictionaryParams {
  readonly template: number;
  readonly at: readonly Jbig2AtPixel[];
  readonly refinementAggregate: boolean;
  readonly refinementTemplate: number;
  readonly refinementAt: readonly Jbig2AtPixel[];
  readonly newSymbolCount: number;
  readonly exportedSymbolCount: number;
  readonly inputSymbols: readonly Jbig2Bitmap[];
}

export function decodeSymbolDictionary(params: SymbolDictionaryParams, mq: MqDecoder, contexts: TextArithContexts, symbolIdBits: number): readonly Jbig2Bitmap[] {
  const newSymbols: Jbig2Bitmap[] = [];
  let heightClassHeight = 0;

  while (newSymbols.length < params.newSymbolCount) {
    const heightDelta = decodeInteger(mq, contexts.iadh);
    if (heightDelta === undefined) {
      throw new Jbig2ParseError('symbol dictionary ended before all of its declared new symbols were decoded');
    }
    heightClassHeight += heightDelta;
    let symbolWidth = 0;

    for (;;) {
      const widthDelta = decodeInteger(mq, contexts.iadw);
      if (widthDelta === undefined) {
        break; // OOB: the end of this height class, per T.88 6.5.5 step 4(c)(i).
      }
      symbolWidth += widthDelta;
      if (newSymbols.length >= params.newSymbolCount) {
        throw new Jbig2ParseError('symbol dictionary coded more symbols than its own SDNUMNEWSYMS declares');
      }
      newSymbols.push(decodeDictionarySymbol(symbolWidth, heightClassHeight, params, newSymbols, mq, contexts, symbolIdBits));
    }
  }

  return exportSymbols([...params.inputSymbols, ...newSymbols], params.exportedSymbolCount, mq, contexts);
}

function decodeDictionarySymbol(width: number, height: number, params: SymbolDictionaryParams, newSymbols: readonly Jbig2Bitmap[], mq: MqDecoder, contexts: TextArithContexts, symbolIdBits: number): Jbig2Bitmap {
  if (!params.refinementAggregate) {
    return decodeGenericRegion(width, height, { template: params.template, tpgdon: false, at: params.at }, mq, contexts.generic);
  }
  // T.88 6.5.8.2: a refinement/aggregate symbol is coded either as a single refinement of an existing symbol, or as a whole miniature text region composing several. Only the single-refinement form is implemented.
  const aggregateInstances = decodeInteger(mq, contexts.iaai) ?? 0;
  if (aggregateInstances !== 1) {
    throw new Jbig2UnsupportedError(`symbol dictionary uses aggregate coding with ${String(aggregateInstances)} instances per symbol; only the single-refinement form of T.88 6.5.8.2.2 is implemented`);
  }
  const available = [...params.inputSymbols, ...newSymbols];
  const id = decodeSymbolId(mq, contexts.iaid, symbolIdBits);
  const deltaX = decodeInteger(mq, contexts.iardx) ?? 0;
  const deltaY = decodeInteger(mq, contexts.iardy) ?? 0;
  const reference = available[id];
  if (reference === undefined) {
    throw new Jbig2ParseError(`symbol dictionary refined against symbol ${String(id)}, which it has not decoded yet`);
  }
  return decodeRefinementRegion(width, height, { template: params.refinementTemplate, tpgron: false, at: params.refinementAt, reference, dx: deltaX, dy: deltaY }, mq, contexts.refinement);
}

// T.88 6.5.10: which of the input-plus-new symbols this dictionary hands on to the segments that refer to it, transmitted as alternating run lengths of not-exported and exported symbols, starting with a (possibly zero-length) not-exported run. A zero-length run is legal and flips the flag without advancing, so the loop is bounded by twice the symbol count plus one -- the most alternations a well-formed export sequence can need.
function exportSymbols(allSymbols: readonly Jbig2Bitmap[], exportedCount: number, mq: MqDecoder, contexts: TextArithContexts): readonly Jbig2Bitmap[] {
  const exported: Jbig2Bitmap[] = [];
  const maxRuns = allSymbols.length * 2 + 1;
  let index = 0;
  let currentFlag = false;
  for (let run = 0; index < allSymbols.length; run++) {
    if (run >= maxRuns) {
      throw new Jbig2ParseError('symbol dictionary export flags never accounted for every symbol');
    }
    const runLength = requireInteger(decodeInteger(mq, contexts.iaex), 'IAEX');
    if (runLength < 0 || index + runLength > allSymbols.length) {
      throw new Jbig2ParseError(`symbol dictionary export run of ${String(runLength)} overruns its own ${String(allSymbols.length)}-symbol set`);
    }
    if (currentFlag) {
      for (let i = 0; i < runLength; i++) {
        const symbol = allSymbols[index + i];
        if (symbol !== undefined) {
          exported.push(symbol);
        }
      }
    }
    index += runLength;
    currentFlag = !currentFlag;
  }
  if (exported.length !== exportedCount) {
    throw new Jbig2ParseError(`symbol dictionary exported ${String(exported.length)} symbols but its own SDNUMEXSYMS declares ${String(exportedCount)}`);
  }
  return exported;
}
