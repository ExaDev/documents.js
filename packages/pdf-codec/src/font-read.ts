import { widthOfCode } from "./afm-widths";
import { parseToUnicodeCMap } from "./cmap";
import type { ToUnicodeCMap } from "./cmap";
import type { PdfDiagnosticSink } from "./diagnostics";
import { decodeStream } from "./filters";
import {
  glyphNameToUnicode,
  symbolGlyphName,
  winAnsiGlyphName,
  zapfDingbatsGlyphName,
} from "./encoding";
import { resolveStandardFont } from "./fonts";
import { styleFromBaseFontName } from "./font-style";
import type { FontMetricsPort, PdfObjectResolver } from "./interpret";
import type { PdfDict, PdfObject } from "./objects";
import { asArray, asName, asNumber, dictGet } from "./objects";

// Resolves a /Font resource dict into everything the read pipeline needs: a glyph-width table (for interpret.ts's FontMetricsPort, so text positions advance correctly) and Unicode decoding (for turning an ExtractedTextRun's raw show-string bytes into real text, once interpretation is done). Two font shapes are handled -- simple (1-byte codes: /Type1, /TrueType, /MMType1) and composite Type0/Identity-H (2-byte codes, the dominant shape Word/PowerPoint/Chrome actually emit) -- everything else (predefined non-Identity CMaps, Type3) degrades to a best-effort width/decode with a diagnostic rather than throwing.

export interface PdfFont {
  readonly composite: boolean; // 2-byte codes if true, 1-byte if false
  readonly family: string;
  readonly bold: boolean;
  readonly italic: boolean;
  widthOf(code: number): number; // 1000ths of em, matching PDF's own /Widths convention
  decodeToUnicode(codes: Uint8Array<ArrayBuffer>): string;
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

function glyphNameToUnicodeWithUniFallback(name: string): number | undefined {
  const direct = glyphNameToUnicode(name);
  if (direct !== undefined) {
    return direct;
  }
  const uniMatch = /^uni([0-9A-Fa-f]{4,6})$/.exec(name);
  return uniMatch?.[1] !== undefined
    ? Number.parseInt(uniMatch[1], 16)
    : undefined;
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
  if (
    baseEncodingName !== undefined &&
    baseEncodingName !== "WinAnsiEncoding"
  ) {
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

  // The name source for a code neither /ToUnicode nor /Differences resolves. A font whose /BaseFont is literally one of the two standard-14 symbol faces always falls back to that face's own fixed built-in encoding (ISO 32000-1 9.6.6.2 -- WinAnsi/MacRoman/StandardEncoding are never valid for Symbol or ZapfDingbats, whether or not /FontDescriptor sets the Symbolic flag). Any other font that IS flagged Symbolic has some other, unknown built-in encoding this codec cannot resolve without parsing its embedded font program (see font-read.ts's own header comment) -- guessing WinAnsi there would silently substitute a plausible-looking but wrong Latin letter, so it stays unmapped instead, same as buildCompositeFont already does for a missing /ToUnicode. Only a non-symbolic (or Flags-less) font falls back to WinAnsi, matching ISO 32000-1's own default for a Type1/TrueType font's built-in encoding.
  const fallbackGlyphName: (code: number) => string | undefined =
    builtinGlyphName ?? (symbolic ? () => undefined : winAnsiGlyphName);

  const decodeToUnicode = (codes: Uint8Array<ArrayBuffer>): string => {
    let out = "";
    let unmapped = 0;
    for (const code of codes) {
      const viaToUnicode = toUnicode?.lookup(code);
      if (viaToUnicode !== undefined) {
        out += viaToUnicode;
        continue;
      }
      const name = differencesMap.get(code) ?? fallbackGlyphName(code);
      const unicode =
        name !== undefined
          ? glyphNameToUnicodeWithUniFallback(name)
          : undefined;
      if (unicode !== undefined) {
        out += String.fromCharCode(unicode);
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

  const toUnicode = readToUnicodeCMap(fontDict, context);
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
      return { widthPer1000: font.widthOf(code), byteLengthConsumed };
    },
  };
  return { metrics, resolve };
}
