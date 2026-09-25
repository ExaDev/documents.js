import { inflateTolerant } from "./bytes/flate";
import { isAsciiWhitespace } from "./bytes/reader";
import type { PdfDiagnosticSink } from "./diagnostics";
import { decodeCcittFax } from "./image/ccitt";
import { decodeJbig2Embedded } from "./image/jbig2";
import type { PdfDict, PdfObject } from "./objects";
import { asArray, asBool, asDict, asName, asNumber, dictGet } from "./objects";
import { applyPredictor, readPredictorParams } from "./predictors";

const BITS_PER_BYTE = 8;
const BYTE_MASK = 0xff; // an all-ones byte: used both to bit-invert a byte (XOR) and to keep only its low 8 bits after a wider shift (AND)

export interface DecodedStream {
  readonly bytes: Uint8Array<ArrayBuffer>;
  // Set when decoding stopped before exhausting the /Filter chain: DCTDecode's deliberate JPEG passthrough (the encoded bytes ARE the deliverable — see src/image/*'s own module docs), JPXDecode's own passthrough (a JPEG 2000 codestream carries its own component count and sample depth, which no plain byte array can express — src/images-read.ts decodes it where those are meaningful), a filter this codec doesn't implement (Crypt), or a JBIG2Decode stream using a JBIG2 feature src/image/jbig2.ts does not decode. `bytes` is still encoded per this filter name either way.
  readonly remainingFilter?: string;
  // Set when a JBIG2Decode filter decoded successfully: the stream's own JBIG2-encoded bytes as they entered that filter (any outer transport filter such as a wrapping FlateDecode already peeled), plus the decoded /JBIG2Globals segments when the stream declared them. This package has no JBIG2 encoder (a hand-written one is research-grade symbol-dictionary design), so these bytes are the only lossless spelling of the image a writer can re-emit — the image layer lifts them onto the asset's `original` for verbatim re-embedding, exactly as DCTDecode's own bytes ride through `format: 'jpeg'`.
  readonly jbig2?: {
    readonly encoded: Uint8Array<ArrayBuffer>;
    readonly globals?: Uint8Array<ArrayBuffer>;
  };
}

// Follows one indirect reference. Only /DecodeParms entries that are themselves whole objects need this — in practice just JBIG2Decode's /JBIG2Globals stream, which a producer essentially always writes as a reference since several images share it. Declared as a bare callback rather than taking src/interpret.ts's PdfObjectResolver so this module keeps no dependency on the interpreter.
export type PdfIndirectResolver = (
  obj: PdfObject | undefined,
) => PdfObject | undefined;

// Runs a stream's raw bytes through its /Filter chain (a single name or an array of names, with /DecodeParms supplying per-filter parameters in the same single-or-array shape). Recoverable per-filter issues (an unresolvable /Predictor, an unimplemented filter) degrade with a diagnostic and stop the chain rather than throwing — the caller decides whether the partially- or un-decoded result is still useful (e.g. a DCTDecode image's bytes are perfectly usable as-is).
export function decodeStream(
  raw: Uint8Array<ArrayBuffer>,
  dict: PdfDict,
  sink: PdfDiagnosticSink,
  resolve?: PdfIndirectResolver,
): DecodedStream {
  const filters = filterNames(dict);
  const parms = decodeParmsList(dict, filters.length);
  let bytes = raw;
  let jbig2: DecodedStream["jbig2"] | undefined;
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i]!;
    const parm = parms[i];
    if (filter === "FlateDecode" || filter === "Fl") {
      bytes = applyPredictorIfPresent(inflateTolerant(bytes).bytes, parm, sink);
    } else if (filter === "LZWDecode" || filter === "LZW") {
      const earlyChange =
        (asNumber(parm ? dictGet(parm, "EarlyChange") : undefined) ?? 1) !== 0;
      bytes = applyPredictorIfPresent(
        lzwDecode(bytes, earlyChange, sink),
        parm,
        sink,
      );
    } else if (filter === "ASCII85Decode" || filter === "A85") {
      bytes = ascii85Decode(bytes);
    } else if (filter === "ASCIIHexDecode" || filter === "AHx") {
      bytes = asciiHexDecode(bytes);
    } else if (filter === "RunLengthDecode" || filter === "RL") {
      bytes = runLengthDecode(bytes);
    } else if (filter === "CCITTFaxDecode" || filter === "CCF") {
      bytes = ccittFaxDecode(bytes, parm, dict, sink);
    } else if (filter === "JBIG2Decode") {
      const decoded = jbig2Decode(bytes, parm, dict, sink, resolve);
      if (decoded === undefined) {
        return { bytes, remainingFilter: "JBIG2Decode" };
      }
      jbig2 = { encoded: bytes, globals: decoded.globals };
      bytes = decoded.bytes;
    } else if (filter === "DCTDecode" || filter === "DCT") {
      return { bytes, remainingFilter: "DCTDecode" };
    } else if (filter === "JPXDecode") {
      // Handed on undecoded for the same reason DCTDecode is, though for the opposite half of the problem: a JPEG 2000 codestream decodes to samples whose component count and bit depth come from the codestream itself rather than from the image dictionary (ISO 32000-1 7.4.9), and DecodedStream has nowhere to put those. src/images-read.ts, which does have somewhere to put them, decodes it.
      return { bytes, remainingFilter: "JPXDecode" };
    } else {
      sink({
        code: "pdf/unsupported-filter",
        severity: "warning",
        message: `unsupported stream filter "${filter}"; leaving remaining bytes undecoded`,
      });
      return { bytes, remainingFilter: filter };
    }
  }
  return jbig2 === undefined ? { bytes } : { bytes, jbig2 };
}

function applyPredictorIfPresent(
  data: Uint8Array<ArrayBuffer>,
  parm: PdfDict | undefined,
  sink: PdfDiagnosticSink,
): Uint8Array<ArrayBuffer> {
  return applyPredictor(data, readPredictorParams(parm), sink);
}

// CCITTFaxDecode (ISO 32000-1 7.4.6): the /DecodeParms entries in Table 11 map one-to-one onto src/image/ccitt.ts's own options, which is the whole of this codec's PDF knowledge about fax coding.
//
// /Rows falls back to the stream dictionary's own /Height because Table 11 defaults /Rows to 0 ("decode until the data runs out"), and a real producer very often leaves it there and lets the image dictionary carry the row count — resolving it here means the decoder gets a definite row count and stops on it rather than reading whatever trailing bits an encoder left behind.
//
// /EndOfLine, /EndOfBlock, and /DamagedRowsBeforeError are deliberately not consulted: the decoder handles an EOL wherever one actually appears rather than being told in advance whether to expect one, stops at an end-of-block marker or at the declared row count whichever comes first, and reports damage through the diagnostic sink rather than switching between "throw" and "keep going" on a per-document count.
function ccittFaxDecode(
  data: Uint8Array<ArrayBuffer>,
  parm: PdfDict | undefined,
  dict: PdfDict,
  sink: PdfDiagnosticSink,
): Uint8Array<ArrayBuffer> {
  const parmGet = (key: string): PdfObject | undefined =>
    parm !== undefined ? dictGet(parm, key) : undefined;
  const rows =
    asNumber(parmGet("Rows")) ??
    asNumber(dictGet(dict, "Height") ?? dictGet(dict, "H"));
  return decodeCcittFax(data, {
    k: asNumber(parmGet("K")),
    columns: asNumber(parmGet("Columns")),
    rows,
    blackIs1: asBool(parmGet("BlackIs1")),
    encodedByteAlign: asBool(parmGet("EncodedByteAlign")),
    onWarning: (message) => {
      sink({ code: "pdf/ccitt-fax-degraded", severity: "warning", message });
    },
  }).bytes;
}

// JBIG2Decode (ISO 32000-1 7.4.7). The filter has exactly one /DecodeParms entry, /JBIG2Globals: a stream of segments — typically a symbol dictionary — shared by every page of the document that was embedded, which a page's own segments refer to by segment number.
//
// Two polarity/sizing details, both of them PDF's rather than JBIG2's, and both handled here so src/image/jbig2.ts stays free of PDF knowledge. First, JBIG2 codes a black pixel as a 1 bit (T.88 3.29) while a PDF 1-bit /DeviceGray image reads 0 as black, so the decoded bitmap is inverted on the way out — exactly the convention CCITTFaxDecode reaches through its own /BlackIs1 defaulting to false. Second, the image dictionary's own /Width and /Height are authoritative over the page information segment's, which is also the only way a JBIG2 page of "unknown" (striped) height resolves at all.
//
// Returns undefined when the stream uses a JBIG2 feature this decoder does not implement, or is malformed. That degrades exactly like an unimplemented filter: the caller gets the still-encoded bytes back with remainingFilter set, skips the image, and the rest of the page still reads. On success it returns the decoded samples beside the globals segments it consumed, so decodeStream can capture the verbatim-re-embedding pair (see DecodedStream.jbig2).
function jbig2Decode(
  data: Uint8Array<ArrayBuffer>,
  parm: PdfDict | undefined,
  dict: PdfDict,
  sink: PdfDiagnosticSink,
  resolve: PdfIndirectResolver | undefined,
):
  | {
      bytes: Uint8Array<ArrayBuffer>;
      globals: Uint8Array<ArrayBuffer> | undefined;
    }
  | undefined {
  const globalsObj =
    parm !== undefined ? dictGet(parm, "JBIG2Globals") : undefined;
  const resolvedGlobals =
    resolve !== undefined ? resolve(globalsObj) : globalsObj;
  let globals: Uint8Array<ArrayBuffer> | undefined;
  if (resolvedGlobals?.kind === "stream") {
    globals = decodeStream(
      resolvedGlobals.raw,
      resolvedGlobals.dict,
      sink,
      resolve,
    ).bytes;
  } else if (globalsObj !== undefined) {
    sink({
      code: "pdf/jbig2-degraded",
      severity: "warning",
      message:
        "a JBIG2Decode stream declares /JBIG2Globals but it could not be resolved to a stream; decoding without it, which will fail if the page refers to a shared symbol dictionary",
    });
  }

  try {
    const image = decodeJbig2Embedded(data, {
      globals,
      width: asNumber(dictGet(dict, "Width") ?? dictGet(dict, "W")),
      height: asNumber(dictGet(dict, "Height") ?? dictGet(dict, "H")),
      onWarning: (message) => {
        sink({ code: "pdf/jbig2-degraded", severity: "warning", message });
      },
    });
    return {
      // JBIG2's own polarity (T.88 3.29) has a 1 bit meaning black; PDF's filter output convention is the inverse, so every byte is bit-inverted here (see src/image/jbig2.ts's own header comment on the same distinction).
      bytes: Uint8Array.from(image.bytes, (byte) => byte ^ BYTE_MASK),
      globals,
    };
  } catch (error) {
    sink({
      code: "pdf/jbig2-undecodable",
      severity: "warning",
      message: `JBIG2Decode stream could not be decoded (${error instanceof Error ? error.message : String(error)}); leaving its bytes undecoded`,
    });
    return undefined;
  }
}

function filterNames(dict: PdfDict): string[] {
  const filterObj = dictGet(dict, "Filter") ?? dictGet(dict, "F");
  if (filterObj === undefined) {
    return [];
  }
  const single = asName(filterObj);
  if (single !== undefined) {
    return [single];
  }
  const arr = asArray(filterObj);
  if (arr === undefined) {
    return [];
  }
  const names: string[] = [];
  for (const item of arr) {
    const name = asName(item);
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

function decodeParmsList(
  dict: PdfDict,
  count: number,
): (PdfDict | undefined)[] {
  const parmsObj = dictGet(dict, "DecodeParms") ?? dictGet(dict, "DP");
  const empty = (): (PdfDict | undefined)[] =>
    Array.from({ length: count }, () => undefined);
  if (parmsObj === undefined) {
    return empty();
  }
  const single = asDict(parmsObj);
  if (single !== undefined) {
    const list = empty();
    list[0] = single;
    return list;
  }
  const arr = asArray(parmsObj);
  if (arr === undefined) {
    return empty();
  }
  return Array.from({ length: count }, (_, i) => asDict(arr[i]));
}

// --- LZWDecode (ISO 32000-1 7.4.4): the classic variable-width (9-12 bit) LZW variant, codes 0-255 for single bytes, 256 clears the table, 257 signals end-of-data. ---

const LZW_CLEAR_TABLE = 256;
const LZW_EOD = 257;
const LZW_INITIAL_CODE_WIDTH = 9;
const LZW_CODE_WIDTH_10 = 10;
const LZW_CODE_WIDTH_11 = 11;
const LZW_CODE_WIDTH_12 = 12; // ISO 32000-1 7.4.4's own cap on LZW code width
const LZW_FIRST_NEW_CODE = 258;

function initialLzwDictionary(): Uint8Array<ArrayBuffer>[] {
  return Array.from({ length: 256 }, (_, i) => new Uint8Array([i]));
}

function concatTwo(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// `earlyChange` mirrors the filter's own /EarlyChange DecodeParms entry (default true): when set, the code width grows one code sooner than the dictionary size alone would demand, matching how essentially every real-world PDF/TIFF encoder actually writes the bitstream.
export function lzwDecode(
  data: Uint8Array<ArrayBuffer>,
  earlyChange: boolean,
  sink: PdfDiagnosticSink,
): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let dict = initialLzwDictionary();
  let nextCode = LZW_FIRST_NEW_CODE;
  let codeWidth = LZW_INITIAL_CODE_WIDTH;
  let prevEntry: Uint8Array<ArrayBuffer> | undefined;
  const bias = earlyChange ? 1 : 0;

  let bitBuffer = 0;
  let bitCount = 0;
  let pos = 0;
  const readCode = (): number | undefined => {
    while (bitCount < codeWidth) {
      if (pos >= data.length) {
        return undefined;
      }
      bitBuffer = (bitBuffer << BITS_PER_BYTE) | data[pos]!;
      pos++;
      bitCount += BITS_PER_BYTE;
    }
    const value =
      (bitBuffer >>> (bitCount - codeWidth)) & ((1 << codeWidth) - 1);
    bitCount -= codeWidth;
    return value;
  };

  for (;;) {
    const code = readCode();
    if (code === undefined || code === LZW_EOD) {
      break;
    }
    if (code === LZW_CLEAR_TABLE) {
      dict = initialLzwDictionary();
      nextCode = LZW_FIRST_NEW_CODE;
      codeWidth = LZW_INITIAL_CODE_WIDTH;
      prevEntry = undefined;
      continue;
    }
    let entry: Uint8Array<ArrayBuffer>;
    const existing = dict[code];
    if (existing !== undefined) {
      entry = existing;
    } else if (code === nextCode && prevEntry !== undefined) {
      entry = concatTwo(prevEntry, new Uint8Array([prevEntry[0] ?? 0]));
    } else {
      sink({
        code: "pdf/lzw-corrupt",
        severity: "warning",
        message: `LZW stream referenced code ${String(code)} with no valid dictionary entry; stopping decode with what was recovered so far`,
      });
      break;
    }
    for (const byte of entry) {
      out.push(byte);
    }
    if (prevEntry !== undefined) {
      dict[nextCode] = concatTwo(prevEntry, new Uint8Array([entry[0] ?? 0]));
      nextCode++;
      if (nextCode + bias === 2 ** LZW_INITIAL_CODE_WIDTH) {
        codeWidth = LZW_CODE_WIDTH_10;
      } else if (nextCode + bias === 2 ** LZW_CODE_WIDTH_10) {
        codeWidth = LZW_CODE_WIDTH_11;
      } else if (nextCode + bias === 2 ** LZW_CODE_WIDTH_11) {
        codeWidth = LZW_CODE_WIDTH_12;
      }
    }
    prevEntry = entry;
  }
  return Uint8Array.from(out);
}

// --- ASCII85Decode (ISO 32000-1 7.4.3): groups of 4 bytes as 5 ASCII characters '!'-'u' (0x21-0x75), 'z' as shorthand for four zero bytes, terminated by "~>". ---

// A full ASCII85 group encodes exactly four bytes in five digits.
const ASCII85_GROUP_BYTES = 4;
const ASCII85_ZERO_GROUP_MARKER = 0x7a; // 'z'
const ASCII85_END_MARKER = 0x7e; // '~'
const ASCII85_MIN_DIGIT = 0x21; // '!'
const ASCII85_MAX_DIGIT = 0x75; // 'u'
const ASCII85_MAX_DIGIT_VALUE = ASCII85_MAX_DIGIT - ASCII85_MIN_DIGIT; // 84 — the padding value for a final, partial group
const ASCII85_RADIX = 85; // five base-85 digits (85^5 > 2^32) represent one 32-bit value
const ASCII85_GROUP_DIGITS = 5; // a full group is five ASCII85 digits, encoding ASCII85_GROUP_BYTES bytes
const ASCII85_OPTIONAL_PREFIX_LT = 0x3c; // '<', the first byte of the optional leading "<~" some producers include
const ASCII85_BYTE_3_SHIFT = 24; // bit position of the most significant of the four decoded bytes within the 32-bit group value
const ASCII85_BYTE_2_SHIFT = 16;

function ascii85GroupBytes(
  digits: readonly number[],
  byteCount: number,
): number[] {
  let value = 0;
  for (const digit of digits) {
    value = value * ASCII85_RADIX + digit;
  }
  const bytes = [
    (value >>> ASCII85_BYTE_3_SHIFT) & BYTE_MASK,
    (value >>> ASCII85_BYTE_2_SHIFT) & BYTE_MASK,
    (value >>> BITS_PER_BYTE) & BYTE_MASK,
    value & BYTE_MASK,
  ];
  return bytes.slice(0, byteCount);
}

export function ascii85Decode(
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let tuple: number[] = [];
  let i = 0;
  if (
    data.length >= 2 &&
    data[0] === ASCII85_OPTIONAL_PREFIX_LT &&
    data[1] === ASCII85_END_MARKER
  ) {
    i = 2; // an optional leading "<~" some producers include, even though only the trailing "~>" is part of PDF's own framing
  }
  for (; i < data.length; i++) {
    const byte = data[i]!;
    if (byte === ASCII85_END_MARKER) {
      break;
    }
    if (isAsciiWhitespace(byte)) {
      continue;
    }
    if (byte === ASCII85_ZERO_GROUP_MARKER && tuple.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (byte < ASCII85_MIN_DIGIT || byte > ASCII85_MAX_DIGIT) {
      continue; // outside the ASCII85 alphabet — skip rather than treat as fatal
    }
    tuple.push(byte - ASCII85_MIN_DIGIT);
    if (tuple.length === ASCII85_GROUP_DIGITS) {
      out.push(...ascii85GroupBytes(tuple, ASCII85_GROUP_BYTES));
      tuple = [];
    }
  }
  if (tuple.length > 1) {
    const padded = tuple.slice();
    while (padded.length < ASCII85_GROUP_DIGITS) {
      padded.push(ASCII85_MAX_DIGIT_VALUE);
    }
    out.push(...ascii85GroupBytes(padded, tuple.length - 1));
  }
  return Uint8Array.from(out);
}

// --- ASCIIHexDecode (ISO 32000-1 7.4.2): hex digits, whitespace ignored, terminated by '>', an odd trailing digit zero-padded. ---

const ASCII_DIGIT_ZERO = 0x30; // '0'
const ASCII_DIGIT_NINE = 0x39; // '9'
const ASCII_UPPER_A = 0x41; // 'A'
const ASCII_UPPER_F = 0x46; // 'F'
const ASCII_LOWER_A = 0x61; // 'a'
const ASCII_LOWER_F = 0x66; // 'f'
const HEX_LETTER_DIGIT_OFFSET = 10; // the digit value 'A'/'a' represents; hex digits 'A'-'F'/'a'-'f' continue 10-15 after '0'-'9'
const ASCII_HEX_TERMINATOR = 0x3e; // '>'
const HEX_NIBBLE_BITS = 4; // width of a hex digit in bits, the shift that places the high nibble of a decoded byte

function hexDigitValue(byte: number): number | undefined {
  if (byte >= ASCII_DIGIT_ZERO && byte <= ASCII_DIGIT_NINE) {
    return byte - ASCII_DIGIT_ZERO;
  }
  if (byte >= ASCII_UPPER_A && byte <= ASCII_UPPER_F) {
    return byte - ASCII_UPPER_A + HEX_LETTER_DIGIT_OFFSET;
  }
  if (byte >= ASCII_LOWER_A && byte <= ASCII_LOWER_F) {
    return byte - ASCII_LOWER_A + HEX_LETTER_DIGIT_OFFSET;
  }
  return undefined;
}

export function asciiHexDecode(
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const digits: number[] = [];
  for (const byte of data) {
    if (byte === ASCII_HEX_TERMINATOR) {
      break; // '>' terminator
    }
    const value = hexDigitValue(byte);
    if (value !== undefined) {
      digits.push(value);
    }
  }
  if (digits.length % 2 === 1) {
    digits.push(0);
  }
  const out = new Uint8Array(digits.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = (digits[i * 2]! << HEX_NIBBLE_BITS) | digits[i * 2 + 1]!;
  }
  return out;
}

// --- RunLengthDecode (ISO 32000-1 7.4.5): PackBits-style run-length encoding. ---

const RUN_LENGTH_EOD = 128;
const RUN_LENGTH_REPEAT_COUNT_BASE = 257; // one past the maximum byte value (256) plus one: a length byte in 129-255, read as a repeat marker, yields a repeat count of 2-128 via (this constant) - length

export function runLengthDecode(
  data: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const length = data[i]!;
    i++;
    if (length === RUN_LENGTH_EOD) {
      break;
    }
    if (length < RUN_LENGTH_EOD) {
      const count = length + 1;
      for (let j = 0; j < count && i < data.length; j++, i++) {
        out.push(data[i]!);
      }
    } else {
      const count = RUN_LENGTH_REPEAT_COUNT_BASE - length;
      const byte = data[i] ?? 0;
      i++;
      for (let j = 0; j < count; j++) {
        out.push(byte);
      }
    }
  }
  return Uint8Array.from(out);
}
