import { inflateTolerant } from './bytes/flate';
import { isAsciiWhitespace } from './bytes/reader';
import type { PdfDiagnosticSink } from './diagnostics';
import type { PdfDict } from './objects';
import { asArray, asDict, asName, asNumber, dictGet } from './objects';
import { applyPredictor, readPredictorParams } from './predictors';

export interface DecodedStream {
  readonly bytes: Uint8Array<ArrayBuffer>;
  // Set when decoding stopped before exhausting the /Filter chain: either DCTDecode's deliberate JPEG passthrough (the encoded bytes ARE the deliverable -- see src/image/*'s own module docs) or a filter this codec doesn't implement (CCITTFaxDecode/JBIG2Decode/JPXDecode/Crypt). `bytes` is still encoded per this filter name either way.
  readonly remainingFilter?: string;
}

// Runs a stream's raw bytes through its /Filter chain (a single name or an array of names, with /DecodeParms supplying per-filter parameters in the same single-or-array shape). Recoverable per-filter issues (an unresolvable /Predictor, an unimplemented filter) degrade with a diagnostic and stop the chain rather than throwing -- the caller decides whether the partially- or un-decoded result is still useful (e.g. a DCTDecode image's bytes are perfectly usable as-is).
export function decodeStream(raw: Uint8Array<ArrayBuffer>, dict: PdfDict, sink: PdfDiagnosticSink): DecodedStream {
  const filters = filterNames(dict);
  const parms = decodeParmsList(dict, filters.length);
  let bytes = raw;
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i]!;
    const parm = parms[i];
    if (filter === 'FlateDecode' || filter === 'Fl') {
      bytes = applyPredictorIfPresent(inflateTolerant(bytes).bytes, parm, sink);
    } else if (filter === 'LZWDecode' || filter === 'LZW') {
      const earlyChange = (asNumber(parm ? dictGet(parm, 'EarlyChange') : undefined) ?? 1) !== 0;
      bytes = applyPredictorIfPresent(lzwDecode(bytes, earlyChange, sink), parm, sink);
    } else if (filter === 'ASCII85Decode' || filter === 'A85') {
      bytes = ascii85Decode(bytes);
    } else if (filter === 'ASCIIHexDecode' || filter === 'AHx') {
      bytes = asciiHexDecode(bytes);
    } else if (filter === 'RunLengthDecode' || filter === 'RL') {
      bytes = runLengthDecode(bytes);
    } else if (filter === 'DCTDecode' || filter === 'DCT') {
      return { bytes, remainingFilter: 'DCTDecode' };
    } else {
      sink({ code: 'pdf/unsupported-filter', severity: 'warning', message: `unsupported stream filter "${filter}"; leaving remaining bytes undecoded` });
      return { bytes, remainingFilter: filter };
    }
  }
  return { bytes };
}

function applyPredictorIfPresent(data: Uint8Array<ArrayBuffer>, parm: PdfDict | undefined, sink: PdfDiagnosticSink): Uint8Array<ArrayBuffer> {
  return applyPredictor(data, readPredictorParams(parm), sink);
}

function filterNames(dict: PdfDict): string[] {
  const filterObj = dictGet(dict, 'Filter') ?? dictGet(dict, 'F');
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

function decodeParmsList(dict: PdfDict, count: number): (PdfDict | undefined)[] {
  const parmsObj = dictGet(dict, 'DecodeParms') ?? dictGet(dict, 'DP');
  const empty = (): (PdfDict | undefined)[] => Array.from({ length: count }, () => undefined);
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
const LZW_FIRST_NEW_CODE = 258;

function initialLzwDictionary(): Uint8Array<ArrayBuffer>[] {
  return Array.from({ length: 256 }, (_, i) => new Uint8Array([i]));
}

function concatTwo(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

// `earlyChange` mirrors the filter's own /EarlyChange DecodeParms entry (default true): when set, the code width grows one code sooner than the dictionary size alone would demand, matching how essentially every real-world PDF/TIFF encoder actually writes the bitstream.
export function lzwDecode(data: Uint8Array<ArrayBuffer>, earlyChange: boolean, sink: PdfDiagnosticSink): Uint8Array<ArrayBuffer> {
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
      bitBuffer = (bitBuffer << 8) | data[pos]!;
      pos++;
      bitCount += 8;
    }
    const value = (bitBuffer >>> (bitCount - codeWidth)) & ((1 << codeWidth) - 1);
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
      sink({ code: 'pdf/lzw-corrupt', severity: 'warning', message: `LZW stream referenced code ${String(code)} with no valid dictionary entry; stopping decode with what was recovered so far` });
      break;
    }
    for (const byte of entry) {
      out.push(byte);
    }
    if (prevEntry !== undefined) {
      dict[nextCode] = concatTwo(prevEntry, new Uint8Array([entry[0] ?? 0]));
      nextCode++;
      if (nextCode + bias === 2 ** 9) {
        codeWidth = 10;
      } else if (nextCode + bias === 2 ** 10) {
        codeWidth = 11;
      } else if (nextCode + bias === 2 ** 11) {
        codeWidth = 12;
      }
    }
    prevEntry = entry;
  }
  return Uint8Array.from(out);
}

// --- ASCII85Decode (ISO 32000-1 7.4.3): groups of 4 bytes as 5 ASCII characters '!'-'u' (0x21-0x75), 'z' as shorthand for four zero bytes, terminated by "~>". ---

const ASCII85_ZERO_GROUP_MARKER = 0x7a; // 'z'
const ASCII85_END_MARKER = 0x7e; // '~'
const ASCII85_MIN_DIGIT = 0x21; // '!'
const ASCII85_MAX_DIGIT = 0x75; // 'u'
const ASCII85_MAX_DIGIT_VALUE = ASCII85_MAX_DIGIT - ASCII85_MIN_DIGIT; // 84 -- the padding value for a final, partial group

function pushAscii85Group(out: number[], digits: number[], byteCount: number): void {
  let value = 0;
  for (const digit of digits) {
    value = value * 85 + digit;
  }
  const bytes = [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
  for (let i = 0; i < byteCount; i++) {
    out.push(bytes[i]!);
  }
}

export function ascii85Decode(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const out: number[] = [];
  let tuple: number[] = [];
  let i = 0;
  if (data.length >= 2 && data[0] === 0x3c && data[1] === 0x7e) {
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
      continue; // outside the ASCII85 alphabet -- skip rather than treat as fatal
    }
    tuple.push(byte - ASCII85_MIN_DIGIT);
    if (tuple.length === 5) {
      pushAscii85Group(out, tuple, 4);
      tuple = [];
    }
  }
  if (tuple.length > 1) {
    const padded = tuple.slice();
    while (padded.length < 5) {
      padded.push(ASCII85_MAX_DIGIT_VALUE);
    }
    pushAscii85Group(out, padded, tuple.length - 1);
  }
  return Uint8Array.from(out);
}

// --- ASCIIHexDecode (ISO 32000-1 7.4.2): hex digits, whitespace ignored, terminated by '>', an odd trailing digit zero-padded. ---

function hexDigitValue(byte: number): number | undefined {
  if (byte >= 0x30 && byte <= 0x39) {
    return byte - 0x30;
  }
  if (byte >= 0x41 && byte <= 0x46) {
    return byte - 0x41 + 10;
  }
  if (byte >= 0x61 && byte <= 0x66) {
    return byte - 0x61 + 10;
  }
  return undefined;
}

export function asciiHexDecode(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const digits: number[] = [];
  for (const byte of data) {
    if (byte === 0x3e) {
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
    out[i] = (digits[i * 2]! << 4) | digits[i * 2 + 1]!;
  }
  return out;
}

// --- RunLengthDecode (ISO 32000-1 7.4.5): PackBits-style run-length encoding. ---

const RUN_LENGTH_EOD = 128;

export function runLengthDecode(data: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
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
      const count = 257 - length;
      const byte = data[i] ?? 0;
      i++;
      for (let j = 0; j < count; j++) {
        out.push(byte);
      }
    }
  }
  return Uint8Array.from(out);
}
