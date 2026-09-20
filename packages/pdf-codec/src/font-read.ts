import { widthOfCode } from "./afm-widths";
import type { BuiltinEncoding } from "./builtin-encoding";
import { readFontProgramEncoding } from "./builtin-encoding";
import { parseToUnicodeCMap } from "./cmap";
import type { ToUnicodeCMap } from "./cmap";
import type { PdfDiagnosticSink } from "./diagnostics";
import { decodeStream } from "./filters";
import {
  glyphNameToUnicode,
  namedEncodingGlyphName,
  symbolGlyphName,
  winAnsiGlyphName,
  zapfDingbatsGlyphName,
} from "./encoding";
import { resolveStandardFont } from "./fonts";
import { styleFromBaseFontName } from "./font-style";
import type { FontMetricsPort, PdfObjectResolver } from "./interpret";
import type { PdfDict, PdfObject } from "./objects";
import { asArray, asName, asNumber, dictGet, isName } from "./objects";

// Resolves a /Font resource dict into everything the read pipeline needs: a glyph-width table (for interpret.ts's FontMetricsPort, so text positions advance correctly) and Unicode decoding (for turning an ExtractedTextRun's raw show-string bytes into real text, once interpretation is done). Two font shapes are handled -- simple (1-byte codes: /Type1, /TrueType, /MMType1) and composite Type0/Identity-H (2-byte codes, the dominant shape Word/PowerPoint/Chrome actually emit) -- everything else (predefined non-Identity CMaps, Type3) degrades to a best-effort width/decode with a diagnostic rather than throwing.

// A glyph's vertical metrics, all in 1000ths of text space to match PDF's own /Widths and /W2 convention (ISO 32000-1 9.7.4.3). `displacementY` is w1y, the amount the text position moves per glyph, normally negative because a vertical line runs down the page. `positionX`/`positionY` are the position vector v, which maps the glyph's horizontal-writing origin onto its vertical-writing one, so the glyph paints v away from where the text position sits.
export interface VerticalGlyphMetrics {
  readonly displacementY: number;
  readonly positionX: number;
  readonly positionY: number;
}

export interface PdfFont {
  readonly composite: boolean; // 2-byte codes if true, 1-byte if false
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  widthOf(code: number): number; // 1000ths of em, matching PDF's own /Widths convention
  decodeToUnicode(codes: Uint8Array<ArrayBuffer>): string;
  // Present only on a composite font whose /Encoding CMap selects vertical writing mode. Writing mode is a property of the CMap, and a simple font has no CMap at all, so a simple font is always horizontal by construction rather than by default.
  readonly verticalMetricsOf?: (code: number) => VerticalGlyphMetrics;
}

export interface FontReadContext {
  readonly resolver: PdfObjectResolver;
  readonly sink: PdfDiagnosticSink;
}

// ISO 32000-1 Table 123 (font descriptor /Flags): bit position n has value 2^(n-1). Bit 3 = Symbolic, bit 7 = Italic, bit 19 = ForceBold.
const SYMBOLIC_FLAG_BIT = 1 << 2;
const ITALIC_FLAG_BIT = 1 << 6;
const FORCE_BOLD_FLAG_BIT = 1 << 18;
const REPLACEMENT_CHARACTER = "�";

function styleFlagsFromDescriptor(descriptor: PdfDict | undefined): {
  forceBold?: boolean;
  italicFlag?: boolean;
  italicAngle?: number;
  symbolic?: boolean;
} {
  const flags =
    descriptor !== undefined
      ? asNumber(dictGet(descriptor, "Flags"))
      : undefined;
  return {
    forceBold:
      flags !== undefined ? (flags & FORCE_BOLD_FLAG_BIT) !== 0 : undefined,
    italicFlag:
      flags !== undefined ? (flags & ITALIC_FLAG_BIT) !== 0 : undefined,
    italicAngle:
      descriptor !== undefined
        ? asNumber(dictGet(descriptor, "ItalicAngle"))
        : undefined,
    symbolic:
      flags !== undefined ? (flags & SYMBOLIC_FLAG_BIT) !== 0 : undefined,
  };
}

// A simple font's own built-in encoding is knowable to a reader without parsing its embedded font program only for the two standard-14 symbol faces, whose code -> glyph mapping the PDF spec fixes (ISO 32000-1 Annex D.5/D.6): Symbol and ZapfDingbats. /BaseFont is matched after stripping a subset tag the same way styleFromBaseFontName does, since a subsetted symbol font (e.g. "ABCDEF+Symbol") is still that same standard face.
function builtinSymbolGlyphNameLookup(
  baseFamily: string,
): ((code: number) => string | undefined) | undefined {
  if (baseFamily === "Symbol") {
    return symbolGlyphName;
  }
  if (baseFamily === "ZapfDingbats") {
    return zapfDingbatsGlyphName;
  }
  return undefined;
}

// The embedded font program a /FontDescriptor carries, whichever of the three keys it is under: /FontFile (Type 1), /FontFile2 (TrueType), /FontFile3 (CFF, or a whole sfnt under /Subtype /OpenType). The bytes themselves say which shape they are, so the key they arrived under is not consulted -- a producer that files a TrueType program under /FontFile3 (a real and not especially rare malformation) is still read correctly.
function readFontProgram(
  descriptor: PdfDict | undefined,
  context: FontReadContext,
): BuiltinEncoding | undefined {
  if (descriptor === undefined) {
    return undefined;
  }
  for (const key of ["FontFile2", "FontFile3", "FontFile"]) {
    const stream = context.resolver.resolve(dictGet(descriptor, key));
    if (stream?.kind !== "stream") {
      continue;
    }
    const decoded = decodeStream(stream.raw, stream.dict, context.sink);
    const encoding = readFontProgramEncoding(decoded.bytes);
    if (encoding !== undefined) {
      return encoding;
    }
  }
  return undefined;
}

// The embedded program, opened only if some code actually falls through to it and then remembered. A font whose /ToUnicode covers every code it shows never pays for this at all, which is where the cost is largest: an embedded face is routinely hundreds of kilobytes, and opening one means inflating the stream and parsing its tables.
function lazyFontProgram(
  descriptor: PdfDict | undefined,
  context: FontReadContext,
): () => BuiltinEncoding | undefined {
  let read: { readonly encoding: BuiltinEncoding | undefined } | undefined;
  return () => {
    read ??= { encoding: readFontProgram(descriptor, context) };
    return read.encoding;
  };
}

// A simple font's /Encoding /Differences array: a code number followed by a run of glyph names, each assigned to consecutive codes starting there, until the next number resets the position (ISO 32000-1 9.6.6.2).
function readDifferencesMap(
  differences: readonly PdfObject[] | undefined,
): Map<number, string> {
  const map = new Map<number, string>();
  if (differences === undefined) {
    return map;
  }
  let currentCode = 0;
  for (const el of differences) {
    if (el.kind === "number") {
      currentCode = el.value;
    } else if (el.kind === "name") {
      map.set(currentCode, el.name);
      currentCode++;
    }
  }
  return map;
}

function readToUnicodeCMap(
  fontDict: PdfDict,
  context: FontReadContext,
): ToUnicodeCMap | undefined {
  const stream = context.resolver.resolve(dictGet(fontDict, "ToUnicode"));
  if (stream?.kind !== "stream") {
    return undefined;
  }
  const decoded = decodeStream(stream.raw, stream.dict, context.sink);
  return parseToUnicodeCMap(decoded.bytes, context.sink);
}

function buildSimpleFont(fontDict: PdfDict, context: FontReadContext): PdfFont {
  const baseFont = asName(dictGet(fontDict, "BaseFont")) ?? "Helvetica";
  const descriptor = context.resolver.resolveDict(
    dictGet(fontDict, "FontDescriptor"),
  );
  const styleFlags = styleFlagsFromDescriptor(descriptor);
  const { baseFamily, bold, italic } = styleFromBaseFontName(
    baseFont,
    styleFlags,
  );
  const symbolic = styleFlags.symbolic ?? false;
  const builtinGlyphName = builtinSymbolGlyphNameLookup(baseFamily);

  const widthsArr = asArray(dictGet(fontDict, "Widths"));
  const firstChar = asNumber(dictGet(fontDict, "FirstChar")) ?? 0;
  const missingWidth =
    (descriptor !== undefined
      ? asNumber(dictGet(descriptor, "MissingWidth"))
      : undefined) ?? 0;
  let widthOf: (code: number) => number;
  if (widthsArr !== undefined) {
    widthOf = (code) => asNumber(widthsArr[code - firstChar]) ?? missingWidth;
  } else {
    // No /Widths at all is only valid for the standard 14, which a reader is expected to already know the metrics of (ISO 32000-1 9.6.2.2) -- fall back to the same AFM table the write path uses.
    const standardMatch = resolveStandardFont(baseFamily, bold, italic);
    widthOf = (code) => widthOfCode(standardMatch.standardName, code);
    if (!standardMatch.matched) {
      context.sink({
        code: "pdf/font-widths-missing",
        severity: "warning",
        message: `font "${baseFont}" has no /Widths array and does not match a standard-14 family; falling back to Helvetica metrics`,
      });
    }
  }

  const toUnicode = readToUnicodeCMap(fontDict, context);
  const encodingObj = dictGet(fontDict, "Encoding");
  const encodingDict = context.resolver.resolveDict(encodingObj);
  const baseEncodingName = asName(
    encodingDict !== undefined
      ? dictGet(encodingDict, "BaseEncoding")
      : encodingObj,
  );
  const namedBaseGlyphName =
    baseEncodingName !== undefined
      ? namedEncodingGlyphName(baseEncodingName)
      : undefined;
  if (baseEncodingName !== undefined && namedBaseGlyphName === undefined) {
    context.sink({
      code: "char/encoding-approximated",
      severity: "info",
      message: `base encoding "${baseEncodingName}" has no dedicated table here and is approximated as WinAnsiEncoding`,
    });
  }
  const differencesMap = readDifferencesMap(
    encodingDict !== undefined
      ? asArray(dictGet(encodingDict, "Differences"))
      : undefined,
  );
  const programEncoding = lazyFontProgram(descriptor, context);

  // What a code neither /ToUnicode nor /Differences resolves falls back to, in order. A font whose /BaseFont is literally one of the two standard-14 symbol faces, and any font flagged Symbolic, is encoded by its own font program rather than by any of the standard tables (ISO 32000-1 9.6.6.2 -- WinAnsi/MacRoman/StandardEncoding are never valid for Symbol or ZapfDingbats, and 9.6.6.4 has a symbolic TrueType font's /Encoding ignored outright), so the embedded program is consulted first and the two fixed standard-14 symbol tables next. An ordinary text font is the other way round: an explicitly named base encoding is the font dictionary stating what its codes mean, and only a font that states nothing falls through to its own program, then to WinAnsi -- ISO 32000-1's own default for a Type1/TrueType built-in encoding. Where every source is silent the code stays unmapped rather than being guessed at, since a plausible-looking wrong Latin letter is worse than a visible replacement character.
  const symbolEncoded = symbolic || builtinGlyphName !== undefined;
  const byGlyphName =
    (source: (code: number) => string | undefined) =>
    (code: number): number | undefined => {
      const name = source(code);
      return name === undefined ? undefined : glyphNameToUnicode(name);
    };
  const fromProgram = (code: number): number | undefined =>
    programEncoding()?.codeToUnicode(code);
  const namedBase =
    namedBaseGlyphName === undefined
      ? undefined
      : byGlyphName(namedBaseGlyphName);
  const resolvers = [
    byGlyphName((code: number) => differencesMap.get(code)),
    ...(symbolEncoded
      ? [
          fromProgram,
          builtinGlyphName === undefined
            ? undefined
            : byGlyphName(builtinGlyphName),
          namedBase,
        ]
      : [namedBase, fromProgram, byGlyphName(winAnsiGlyphName)]),
  ].filter((resolver) => resolver !== undefined);

  const unicodeForCode = (code: number): number | undefined => {
    for (const resolve of resolvers) {
      const unicode = resolve(code);
      if (unicode !== undefined) {
        return unicode;
      }
    }
    return undefined;
  };

  const decodeToUnicode = (codes: Uint8Array<ArrayBuffer>): string => {
    let out = "";
    let unmapped = 0;
    for (const code of codes) {
      const viaToUnicode = toUnicode?.lookup(code);
      if (viaToUnicode !== undefined) {
        out += viaToUnicode;
        continue;
      }
      const unicode = unicodeForCode(code);
      if (unicode !== undefined) {
        out += String.fromCodePoint(unicode);
        continue;
      }
      unmapped++;
      out += REPLACEMENT_CHARACTER;
    }
    if (unmapped > 0) {
      context.sink({
        code: "text/unmapped-encoding",
        severity: unmapped > codes.length / 2 ? "warning" : "info",
        message: `${String(unmapped)} of ${String(codes.length)} character code(s) in font "${baseFont}" could not be mapped to Unicode`,
      });
    }
    return out;
  };

  return {
    composite: false,
    family: baseFamily,
    bold,
    italic,
    widthOf,
    decodeToUnicode,
  };
}

// CID widths (ISO 32000-1 9.7.4.3): each run is either "c [w1 w2 ... wn]" (individual widths for consecutive CIDs starting at c) or "cFirst cLast w" (one width applied to the whole range).
function readCidWidths(
  w: readonly PdfObject[] | undefined,
): Map<number, number> {
  const map = new Map<number, number>();
  if (w === undefined) {
    return map;
  }
  let i = 0;
  while (i < w.length) {
    const first = asNumber(w[i]);
    if (first === undefined) {
      i++;
      continue;
    }
    const next = w[i + 1];
    if (next?.kind === "array") {
      next.items.forEach((item, offset) => {
        const width = asNumber(item);
        if (width !== undefined) {
          map.set(first + offset, width);
        }
      });
      i += 2;
    } else {
      const last = asNumber(next);
      const width = asNumber(w[i + 2]);
      if (last !== undefined && width !== undefined) {
        for (let cid = first; cid <= last; cid++) {
          map.set(cid, width);
        }
      }
      i += 3;
    }
  }
  return map;
}

const DEFAULT_CID_WIDTH = 1000; // ISO 32000-1 9.7.4.3's own default for /DW when absent

// ISO 32000-1 9.7.4.3's own default for /DW2 when absent: [880 -1000], the position vector's y followed by the vertical displacement. The position vector's x is not in /DW2 at all and defaults to half the glyph's own horizontal width, which centres an upright glyph over the column it sits in.
const DEFAULT_VERTICAL_POSITION_Y = 880;
const DEFAULT_VERTICAL_DISPLACEMENT_Y = -1000;
const DW2_ENTRY_COUNT = 2;
// One /W2 entry in the c [w1y vx vy ...] form describes a glyph with three numbers.
const W2_TRIPLET_LENGTH = 3;
// ISO 32000-1 9.7.5.1: writing mode 1 is vertical, 0 horizontal.
const VERTICAL_WRITING_MODE = 1;

// Per-CID vertical metrics from /W2. positionX is optional because only /W2 ever states one: a glyph falling back to /DW2 takes half its own horizontal width instead, which /DW2 cannot express since it carries no per-glyph width.
interface CidVerticalEntry {
  readonly displacementY: number;
  readonly positionX: number | undefined;
  readonly positionY: number;
}

// /W2 (ISO 32000-1 Table 117) in both of its forms: `c [w1y vx vy ...]`, one triplet per consecutive CID from c, and `cFirst cLast w1y vx vy`, one triplet shared by every CID in the range. Mirrors readCidWidths above, which reads /W's own two analogous forms.
function readCidVerticalMetrics(
  w2: readonly PdfObject[] | undefined,
): Map<number, CidVerticalEntry> {
  const map = new Map<number, CidVerticalEntry>();
  if (w2 === undefined) {
    return map;
  }
  let i = 0;
  while (i < w2.length) {
    const first = asNumber(w2[i]);
    if (first === undefined) {
      i++;
      continue;
    }
    const next = w2[i + 1];
    if (next?.kind === "array") {
      // Counting whole triplets up front rather than testing a running offset against the array's end: the count IS the number of CIDs described, so it indexes them directly, and a trailing partial triplet the producer left behind is excluded by the division rather than by a bounds test that would have to read past the end to discover it.
      const described = Math.floor(next.items.length / W2_TRIPLET_LENGTH);
      for (let index = 0; index < described; index++) {
        const at = index * W2_TRIPLET_LENGTH;
        const entry = verticalEntryFrom(
          asNumber(next.items[at]),
          asNumber(next.items[at + 1]),
          asNumber(next.items[at + 2]),
        );
        if (entry !== undefined) {
          map.set(first + index, entry);
        }
      }
      i += 2;
      continue;
    }
    const last = asNumber(next);
    const entry = verticalEntryFrom(
      asNumber(w2[i + 2]),
      asNumber(w2[i + 3]),
      asNumber(w2[i + 4]),
    );
    if (last !== undefined && entry !== undefined) {
      for (let cid = first; cid <= last; cid++) {
        map.set(cid, entry);
      }
    }
    i += 5;
  }
  return map;
}

function verticalEntryFrom(
  displacementY: number | undefined,
  positionX: number | undefined,
  positionY: number | undefined,
): CidVerticalEntry | undefined {
  if (
    displacementY === undefined ||
    positionX === undefined ||
    positionY === undefined
  ) {
    return undefined;
  }
  return { displacementY, positionX, positionY };
}

// ISO 32000-1 9.7.5.1: the predefined CMaps come in horizontal/vertical pairs whose names differ only by an "H" or "V" suffix, and Adobe-Japan1's own pair is the bare "H" and "V". Matching the suffix rather than enumerating the fixed list is what lets a CMap this package has never heard of still declare its own writing mode correctly; the list is closed in the standard but long, and every member of it follows the rule.
function predefinedCMapIsVertical(name: string): boolean {
  return name === "V" || name.endsWith("-V");
}

// The writing mode a Type0 font's own /Encoding selects: a predefined CMap says so in its name, and an embedded CMap stream says so in its own /WMode entry. Absent, unreadable, or explicitly 0, the font is horizontal.
function readsVertically(fontDict: PdfDict, context: FontReadContext): boolean {
  const encoding = context.resolver.resolve(dictGet(fontDict, "Encoding"));
  if (encoding?.kind === "name") {
    return predefinedCMapIsVertical(encoding.name);
  }
  if (encoding?.kind === "stream") {
    return asNumber(dictGet(encoding.dict, "WMode")) === VERTICAL_WRITING_MODE;
  }
  return false;
}

function buildCompositeFont(
  fontDict: PdfDict,
  context: FontReadContext,
): PdfFont {
  const baseFont = asName(dictGet(fontDict, "BaseFont")) ?? "Helvetica";
  const descendants = asArray(dictGet(fontDict, "DescendantFonts"));
  const descendantDict =
    descendants !== undefined
      ? context.resolver.resolveDict(descendants[0])
      : undefined;
  const descriptor =
    descendantDict !== undefined
      ? context.resolver.resolveDict(dictGet(descendantDict, "FontDescriptor"))
      : undefined;
  const { baseFamily, bold, italic } = styleFromBaseFontName(
    baseFont,
    styleFlagsFromDescriptor(descriptor),
  );

  const dw =
    descendantDict !== undefined
      ? (asNumber(dictGet(descendantDict, "DW")) ?? DEFAULT_CID_WIDTH)
      : DEFAULT_CID_WIDTH;
  const widthMap = readCidWidths(
    descendantDict !== undefined
      ? asArray(dictGet(descendantDict, "W"))
      : undefined,
  );
  const widthOf = (cid: number): number => widthMap.get(cid) ?? dw;

  const dw2 =
    descendantDict !== undefined
      ? asArray(dictGet(descendantDict, "DW2"))
      : undefined;
  const defaultPositionY =
    (dw2?.length === DW2_ENTRY_COUNT ? asNumber(dw2[0]) : undefined) ??
    DEFAULT_VERTICAL_POSITION_Y;
  const defaultDisplacementY =
    (dw2?.length === DW2_ENTRY_COUNT ? asNumber(dw2[1]) : undefined) ??
    DEFAULT_VERTICAL_DISPLACEMENT_Y;
  const verticalMap = readCidVerticalMetrics(
    descendantDict !== undefined
      ? asArray(dictGet(descendantDict, "W2"))
      : undefined,
  );
  const verticalMetricsOf = (cid: number): VerticalGlyphMetrics => {
    const entry = verticalMap.get(cid);
    return {
      displacementY: entry?.displacementY ?? defaultDisplacementY,
      // Half the glyph's own horizontal width is what /DW2 cannot state and the standard supplies instead, centring an upright glyph over its column.
      positionX: entry?.positionX ?? widthOf(cid) / 2,
      positionY: entry?.positionY ?? defaultPositionY,
    };
  };

  const toUnicode = readToUnicodeCMap(fontDict, context);
  // With Identity-H and the default /CIDToGIDMap, a CID is the embedded program's own glyph ID, so the program itself can say what a glyph is when the font dictionary carries no /ToUnicode CMap (or an incomplete one) -- through the glyph's own name, or by reading the program's Unicode mapping backwards. Any other /Encoding or a /CIDToGIDMap stream breaks that identity, and the program is not consulted at all rather than being read against the wrong glyph.
  const cidToGidMap =
    descendantDict !== undefined
      ? dictGet(descendantDict, "CIDToGIDMap")
      : undefined;
  const encodingName = dictGet(fontDict, "Encoding");
  const cidIsGlyphId =
    (isName(encodingName, "Identity-H") ||
      isName(encodingName, "Identity-V")) &&
    (cidToGidMap === undefined || isName(cidToGidMap, "Identity"));
  const programEncoding = cidIsGlyphId
    ? lazyFontProgram(descriptor, context)
    : undefined;

  const decodeToUnicode = (codes: Uint8Array<ArrayBuffer>): string => {
    let out = "";
    let glyphCount = 0;
    let unmapped = 0;
    for (let i = 0; i + 1 < codes.length; i += 2) {
      glyphCount++;
      const cid = ((codes[i] ?? 0) << 8) | (codes[i + 1] ?? 0);
      const mapped = toUnicode?.lookup(cid);
      if (mapped !== undefined) {
        out += mapped;
        continue;
      }
      const fromProgram = programEncoding?.()?.glyphIdToUnicode(cid);
      if (fromProgram !== undefined) {
        out += String.fromCodePoint(fromProgram);
        continue;
      }
      unmapped++;
      out += REPLACEMENT_CHARACTER;
    }
    if (unmapped > 0) {
      context.sink({
        code: "text/unmapped-encoding",
        severity: unmapped > glyphCount / 2 ? "warning" : "info",
        message: `${String(unmapped)} of ${String(glyphCount)} character code(s) in font "${baseFont}" could not be mapped to Unicode (no /ToUnicode CMap, or an incomplete one)`,
      });
    }
    return out;
  };

  return {
    composite: true,
    family: baseFamily,
    bold,
    italic,
    widthOf,
    decodeToUnicode,
    ...(readsVertically(fontDict, context) ? { verticalMetricsOf } : {}),
  };
}

export interface FontResolverService {
  readonly metrics: FontMetricsPort;
  readonly resolve: (
    fontResourceName: string,
    resources: PdfDict,
  ) => PdfFont | undefined;
}

// One resolver per document read: the cache is keyed by the font dictionary's own object identity (stable across repeated lookups via PdfObjectResolver's own caching), so a font referenced by many pages under many different resource names is only ever built once.
export function createFontResolver(
  context: FontReadContext,
): FontResolverService {
  const cache = new Map<PdfDict, PdfFont | undefined>();
  const resolve = (
    fontResourceName: string,
    resources: PdfDict,
  ): PdfFont | undefined => {
    const fontsDict = context.resolver.resolveDict(dictGet(resources, "Font"));
    const fontDict =
      fontsDict !== undefined
        ? context.resolver.resolveDict(dictGet(fontsDict, fontResourceName))
        : undefined;
    if (fontDict === undefined) {
      return undefined;
    }
    if (cache.has(fontDict)) {
      return cache.get(fontDict);
    }
    const subtype = asName(dictGet(fontDict, "Subtype"));
    const resolved =
      subtype === "Type0"
        ? buildCompositeFont(fontDict, context)
        : buildSimpleFont(fontDict, context);
    cache.set(fontDict, resolved);
    return resolved;
  };
  const metrics: FontMetricsPort = {
    glyphAdvance(fontResourceName, resources, codes, byteOffset) {
      const font = resolve(fontResourceName, resources);
      if (font === undefined) {
        return undefined;
      }
      const byteLengthConsumed = font.composite ? 2 : 1;
      const code = font.composite
        ? ((codes[byteOffset] ?? 0) << 8) | (codes[byteOffset + 1] ?? 0)
        : (codes[byteOffset] ?? 0);
      const vertical = font.verticalMetricsOf?.(code);
      return {
        widthPer1000: font.widthOf(code),
        byteLengthConsumed,
        ...(vertical === undefined
          ? {}
          : {
              vertical: {
                displacementPer1000: vertical.displacementY,
                positionXPer1000: vertical.positionX,
                positionYPer1000: vertical.positionY,
              },
            }),
      };
    },
    isVertical(fontResourceName, resources) {
      return (
        resolve(fontResourceName, resources)?.verticalMetricsOf !== undefined
      );
    },
  };
  return { metrics, resolve };
}
