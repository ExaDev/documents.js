import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { PdfDiagnostic, PdfDiagnosticSink } from './diagnostics';
import { ascii85Decode, asciiHexDecode, decodeStream, lzwDecode, runLengthDecode } from './filters';
import type { PdfObject } from './objects';
import { pdfArray, pdfBool, pdfDict, pdfName, pdfNull, pdfNum, pdfRef, pdfStream } from './objects';
import { CCITT_FAX_FIXTURES, ccittFixtureBytes } from './test-support/ccitt-fax';
import type { Jbig2Fixture } from './test-support/jbig2';
import { JBIG2_FIXTURES, jbig2FixtureBytes } from './test-support/jbig2';

function collectDiagnostics(): { sink: PdfDiagnosticSink; diagnostics: PdfDiagnostic[] } {
  const diagnostics: PdfDiagnostic[] = [];
  return { sink: (d) => diagnostics.push(d), diagnostics };
}

function textBytes(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

function decodedText(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder().decode(bytes);
}

describe('asciiHexDecode', () => {
  it('decodes hex digits, ignoring whitespace, stopping at ">"', () => {
    expect(Array.from(asciiHexDecode(textBytes('48 65 6c 6c 6f>ignored')))).toEqual(Array.from(textBytes('Hello')));
  });

  it('zero-pads a trailing odd digit', () => {
    expect(Array.from(asciiHexDecode(textBytes('480')))).toEqual([0x48, 0x00]);
  });
});

describe('ascii85Decode', () => {
  it('decodes a known ASCII85-encoded string, per the canonical Adobe example', () => {
    // "Man " -> its ASCII85 encoding is the textbook example from Adobe's own PostScript Language Reference.
    expect(decodedText(ascii85Decode(textBytes('9jqo^~>')))).toBe('Man ');
  });

  it("expands the 'z' shorthand to four zero bytes", () => {
    expect(Array.from(ascii85Decode(textBytes('z~>')))).toEqual([0, 0, 0, 0]);
  });

  it('handles a partial final group', () => {
    // Two source bytes [0x00, 0x01] under-fill a 5-character group; decoding should recover exactly those two bytes.
    const encoded = ascii85DecodeRoundTripFixture();
    expect(Array.from(ascii85Decode(textBytes(encoded)))).toEqual([0x00, 0x01]);
  });
});

// A tiny reference ASCII85 encoder, used only to build a known-good input for the partial-group decode test above -- independent of ascii85Decode itself, the same "independent oracle" pattern test-support/pdf.ts uses for FlateDecode fixtures.
function ascii85DecodeRoundTripFixture(): string {
  const bytes = [0x00, 0x01];
  const padded = [...bytes, 0, 0];
  let value = 0;
  for (const b of padded) {
    value = value * 256 + b;
  }
  const digits: number[] = [];
  for (let i = 0; i < 5; i++) {
    digits.unshift(value % 85);
    value = Math.floor(value / 85);
  }
  const chars = digits.slice(0, bytes.length + 1).map((d) => String.fromCharCode(d + 0x21));
  return `${chars.join('')}~>`;
}

describe('runLengthDecode', () => {
  it('copies a literal run (length byte 0-127 => length+1 following bytes)', () => {
    // length=2 means 3 literal bytes follow.
    expect(Array.from(runLengthDecode(new Uint8Array([2, 0x41, 0x42, 0x43])))).toEqual([0x41, 0x42, 0x43]);
  });

  it('repeats a single byte (length byte 129-255 => 257-length repeats)', () => {
    // length=255 means the following byte repeats 2 times.
    expect(Array.from(runLengthDecode(new Uint8Array([255, 0x58])))).toEqual([0x58, 0x58]);
  });

  it('stops at the EOD marker (length byte 128)', () => {
    expect(Array.from(runLengthDecode(new Uint8Array([1, 0x41, 0x42, 128, 1, 0x99, 0x99])))).toEqual([0x41, 0x42]);
  });
});

// A minimal reference LZW encoder, test-only: an independent second implementation of the same ISO 32000-1 7.4.4 algorithm, used to build known-good bitstreams for lzwDecode to decode -- the same "independent oracle" reasoning as test-support/pdf.ts's own FlateDecode fixtures (built directly against fflate rather than through src/pdf/write.ts).
//
// Deliberately tracks two separate counters, not one: `dictNextCode` (the code number assigned to each newly-recognised pattern, which can and must grow starting from the very first emitted code, since the encoder has one-symbol lookahead) and `widthNextCode` (which governs only the transmitted code WIDTH, and must stay one step behind -- because a decoder can never add a new dictionary entry until it has processed a *second* code to supply the "+1 byte" that completes the pattern, a real encoder's code-width schedule has to match that lag, not its own, earlier, lookahead-driven dictionary growth). Conflating the two into a single counter (the naive textbook-pseudocode reading) desyncs the code width from a standards-conformant decoder the first time growth crosses a threshold -- caught empirically via this very test.
function referenceLzwEncode(bytes: Uint8Array<ArrayBuffer>, earlyChange: boolean): { code: number; width: number }[] {
  const dict = new Map<string, number>();
  for (let i = 0; i < 256; i++) {
    dict.set(String(i), i);
  }
  let dictNextCode = 258;
  let widthNextCode = 258;
  let codeWidth = 9;
  const bias = earlyChange ? 1 : 0;
  const out: { code: number; width: number }[] = [];
  let current = '';
  let hasEmittedOnce = false;
  for (const byte of bytes) {
    const candidate = current === '' ? String(byte) : `${current},${byte}`;
    if (dict.has(candidate)) {
      current = candidate;
      continue;
    }
    out.push({ code: dict.get(current)!, width: codeWidth });
    dict.set(candidate, dictNextCode);
    dictNextCode++;
    if (hasEmittedOnce) {
      widthNextCode++;
      if (widthNextCode + bias === 2 ** 9) {
        codeWidth = 10;
      } else if (widthNextCode + bias === 2 ** 10) {
        codeWidth = 11;
      } else if (widthNextCode + bias === 2 ** 11) {
        codeWidth = 12;
      }
    }
    hasEmittedOnce = true;
    current = String(byte);
  }
  if (current !== '') {
    out.push({ code: dict.get(current)!, width: codeWidth });
  }
  out.push({ code: 257, width: codeWidth });
  return out;
}

function packBits(entries: { code: number; width: number }[]): Uint8Array<ArrayBuffer> {
  let bitBuffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const { code, width } of entries) {
    bitBuffer = (bitBuffer << width) | code;
    bitCount += width;
    while (bitCount >= 8) {
      const shift = bitCount - 8;
      bytes.push((bitBuffer >>> shift) & 0xff);
      bitCount -= 8;
      bitBuffer &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0) {
    bytes.push((bitBuffer << (8 - bitCount)) & 0xff);
  }
  return Uint8Array.from(bytes);
}

describe('lzwDecode', () => {
  it('decodes a run of literal (never-repeated) single-byte codes', () => {
    const { sink } = collectDiagnostics();
    const packed = packBits([{ code: 65, width: 9 }, { code: 66, width: 9 }, { code: 257, width: 9 }]);
    expect(decodedText(lzwDecode(packed, true, sink))).toBe('AB');
  });

  it('decodes a back-reference to a dictionary entry added earlier in the same stream', () => {
    const { sink } = collectDiagnostics();
    // 'A','B' establishes dict[258]="AB"; the following 258 back-references it.
    const packed = packBits([{ code: 65, width: 9 }, { code: 66, width: 9 }, { code: 258, width: 9 }, { code: 257, width: 9 }]);
    expect(decodedText(lzwDecode(packed, true, sink))).toBe('ABAB');
  });

  it('decodes the "code equals next available code" (KwK) case', () => {
    const { sink } = collectDiagnostics();
    // After 'A','B', dict[258]="AB" is assigned but code 259 is not yet -- decoding 259 must reconstruct it as prevEntry + prevEntry[0] ("BB").
    const packed = packBits([{ code: 65, width: 9 }, { code: 66, width: 9 }, { code: 259, width: 9 }, { code: 257, width: 9 }]);
    expect(decodedText(lzwDecode(packed, true, sink))).toBe('ABBB');
  });

  it('resets the dictionary on a clear-table code (256) mid-stream', () => {
    const { sink } = collectDiagnostics();
    const packed = packBits([
      { code: 65, width: 9 },
      { code: 66, width: 9 },
      { code: 256, width: 9 },
      { code: 65, width: 9 },
      { code: 66, width: 9 },
      { code: 257, width: 9 },
    ]);
    expect(decodedText(lzwDecode(packed, true, sink))).toBe('ABAB');
  });

  it('reports a diagnostic and stops on a corrupt (out-of-range) code', () => {
    const { sink, diagnostics } = collectDiagnostics();
    // Code 300 is neither an assigned dictionary entry nor the next-available KwK code.
    const packed = packBits([{ code: 65, width: 9 }, { code: 300, width: 9 }]);
    expect(decodedText(lzwDecode(packed, true, sink))).toBe('A');
    expect(diagnostics[0]?.code).toBe('pdf/lzw-corrupt');
  });

  it('round-trips a long, dictionary-growing input against an independent reference encoder, exercising code-width growth past the 511/1023-entry thresholds', () => {
    const original = Uint8Array.from({ length: 1000 }, (_, i) => i % 250);
    for (const earlyChange of [true, false]) {
      const { sink, diagnostics } = collectDiagnostics();
      const packed = packBits(referenceLzwEncode(original, earlyChange));
      const decoded = lzwDecode(packed, earlyChange, sink);
      expect(Array.from(decoded)).toEqual(Array.from(original));
      expect(diagnostics).toEqual([]);
    }
  });
});

describe('decodeStream', () => {
  it('decodes a single FlateDecode filter with no predictor', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const compressed = zlibSync(textBytes('Hello, stream!'));
    const dict = pdfDict({ Filter: pdfName('FlateDecode') });
    const result = decodeStream(compressed, dict, sink);
    expect(decodedText(result.bytes)).toBe('Hello, stream!');
    expect(result.remainingFilter).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  it('decodes FlateDecode combined with a PNG predictor (Predictor 12)', () => {
    const { sink } = collectDiagnostics();
    // Two rows of 3 samples each, both "None" (filter type 0) -- pre-predictor bytes are the raw samples with a leading 0 per row.
    const predicted = new Uint8Array([0, 1, 2, 3, 0, 4, 5, 6]);
    const compressed = zlibSync(predicted);
    const dict = pdfDict({
      Filter: pdfName('FlateDecode'),
      DecodeParms: pdfDict({ Predictor: pdfNum(12), Colors: pdfNum(1), BitsPerComponent: pdfNum(8), Columns: pdfNum(3) }),
    });
    const result = decodeStream(compressed, dict, sink);
    expect(Array.from(result.bytes)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('decodes an ASCIIHexDecode filter', () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({ Filter: pdfName('ASCIIHexDecode') });
    const result = decodeStream(textBytes('48656c6c6f>'), dict, sink);
    expect(decodedText(result.bytes)).toBe('Hello');
  });

  it('decodes a RunLengthDecode filter', () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({ Filter: pdfName('RunLengthDecode') });
    const result = decodeStream(new Uint8Array([4, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 128]), dict, sink);
    expect(decodedText(result.bytes)).toBe('Hello');
  });

  it('passes DCTDecode bytes through unchanged, flagged as the remaining filter', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const raw = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const dict = pdfDict({ Filter: pdfName('DCTDecode') });
    const result = decodeStream(raw, dict, sink);
    expect(Array.from(result.bytes)).toEqual(Array.from(raw));
    expect(result.remainingFilter).toBe('DCTDecode');
    expect(diagnostics).toEqual([]);
  });

  it('passes JPXDecode bytes through unchanged, flagged as the remaining filter', () => {
    // A JPEG 2000 codestream decodes to samples whose component count and depth come from the codestream rather than the image dictionary, so it is handed on undecoded for src/images-read.ts to deal with -- the same treatment DCTDecode gets, and for the same reason DecodedStream cannot express the result.
    const { sink, diagnostics } = collectDiagnostics();
    const raw = new Uint8Array([0xff, 0x4f, 0xff, 0x51]);
    const dict = pdfDict({ Filter: pdfName('JPXDecode') });
    const result = decodeStream(raw, dict, sink);
    expect(Array.from(result.bytes)).toEqual(Array.from(raw));
    expect(result.remainingFilter).toBe('JPXDecode');
    expect(diagnostics).toEqual([]);
  });

  it('degrades a filter it does not implement with a diagnostic, leaving the bytes undecoded', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const raw = new Uint8Array([1, 2, 3]);
    const dict = pdfDict({ Filter: pdfName('Crypt') });
    const result = decodeStream(raw, dict, sink);
    expect(Array.from(result.bytes)).toEqual([1, 2, 3]);
    expect(result.remainingFilter).toBe('Crypt');
    expect(diagnostics[0]?.code).toBe('pdf/unsupported-filter');
  });

  it('chains multiple filters in /Filter array order, matching per-index /DecodeParms', () => {
    const { sink } = collectDiagnostics();
    const compressed = zlibSync(textBytes('chained'));
    const hexOfCompressed = Array.from(compressed).map((b) => b.toString(16).padStart(2, '0')).join('');
    const dict = pdfDict({
      Filter: pdfArray([pdfName('ASCIIHexDecode'), pdfName('FlateDecode')]),
      DecodeParms: pdfArray([pdfNull(), pdfNull()]),
    });
    const result = decodeStream(textBytes(`${hexOfCompressed}>`), dict, sink);
    expect(decodedText(result.bytes)).toBe('chained');
  });

  it('returns the raw bytes unchanged when there is no /Filter at all', () => {
    const { sink } = collectDiagnostics();
    const raw = textBytes('plain');
    const result = decodeStream(raw, pdfDict({}), sink);
    expect(Array.from(result.bytes)).toEqual(Array.from(raw));
  });
});

describe('decodeStream: CCITTFaxDecode', () => {
  const fixture = CCITT_FAX_FIXTURES.find((f) => f.name === 'box')!;

  function expectedBits(blackIs1: boolean): number[] {
    const bytesPerRow = Math.ceil(fixture.columns / 8);
    const bytes = new Uint8Array(bytesPerRow * fixture.rows);
    for (let y = 0; y < fixture.rows; y++) {
      for (let x = 0; x < fixture.columns; x++) {
        const black = fixture.isBlack(x, y);
        if (black === blackIs1) {
          const index = y * bytesPerRow + (x >> 3);
          bytes[index] = (bytes[index] ?? 0) | (0x80 >> (x & 7));
        }
      }
    }
    return Array.from(bytes);
  }

  it('decodes a Group 4 stream into a packed 1-bit bitmap, taking /Rows from the image /Height', () => {
    const { sink, diagnostics } = collectDiagnostics();
    // No /Rows in /DecodeParms: Table 11 defaults it to 0, so the row count has to come from the image dictionary itself.
    const dict = pdfDict({
      Filter: pdfName('CCITTFaxDecode'),
      DecodeParms: pdfDict({ K: pdfNum(-1), Columns: pdfNum(fixture.columns) }),
      Width: pdfNum(fixture.columns),
      Height: pdfNum(fixture.rows),
    });
    const result = decodeStream(ccittFixtureBytes(fixture.encodings.group4), dict, sink);
    expect(diagnostics).toEqual([]);
    expect(result.remainingFilter).toBeUndefined();
    expect(Array.from(result.bytes)).toEqual(expectedBits(false));
  });

  it('honours /BlackIs1 and the /CCF abbreviation', () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({
      F: pdfName('CCF'),
      DP: pdfDict({ K: pdfNum(-1), Columns: pdfNum(fixture.columns), Rows: pdfNum(fixture.rows), BlackIs1: pdfBool(true) }),
    });
    const result = decodeStream(ccittFixtureBytes(fixture.encodings.group4), dict, sink);
    expect(Array.from(result.bytes)).toEqual(expectedBits(true));
  });

  it('reports a damaged stream through the diagnostic sink rather than throwing', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({
      Filter: pdfName('CCITTFaxDecode'),
      DecodeParms: pdfDict({ K: pdfNum(-1), Columns: pdfNum(8), Rows: pdfNum(4) }),
    });
    const result = decodeStream(new Uint8Array([0x80, 0x02, 0x00, 0x00]), dict, sink);
    expect(result.bytes.length).toBe(4); // one byte per row, the undecodable rows padded white
    expect(diagnostics.map((d) => d.code)).toContain('pdf/ccitt-fax-degraded');
  });
});

describe('decodeStream: JBIG2Decode', () => {
  const generic = JBIG2_FIXTURES.find((f) => f.name === 'box-generic')!;
  const symbols = JBIG2_FIXTURES.find((f) => f.name === 'text-symbols')!;

  // The filter's output is the inverse of JBIG2's own polarity: a black pixel is the 0 bit, so a 1-bit /DeviceGray sample reads it as black without any /Decode array.
  function expectedFilterBytes(fixture: Jbig2Fixture): number[] {
    const bytesPerRow = Math.ceil(fixture.width / 8);
    const bytes = new Uint8Array(bytesPerRow * fixture.height).fill(0xff);
    for (let y = 0; y < fixture.height; y++) {
      for (let x = 0; x < fixture.width; x++) {
        if (fixture.expected[y]?.[x] === '#') {
          const index = y * bytesPerRow + (x >> 3);
          bytes[index] = (bytes[index] ?? 0) & ~(0x80 >> (x & 7));
        }
      }
    }
    return Array.from(bytes);
  }

  it('decodes a generic-region stream into a packed 1-bit bitmap with black in the 0 bit', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({ Filter: pdfName('JBIG2Decode'), Width: pdfNum(generic.width), Height: pdfNum(generic.height), BitsPerComponent: pdfNum(1), ColorSpace: pdfName('DeviceGray') });
    const result = decodeStream(jbig2FixtureBytes(generic.stream), dict, sink);
    expect(diagnostics).toEqual([]);
    expect(result.remainingFilter).toBeUndefined();
    expect(Array.from(result.bytes)).toEqual(expectedFilterBytes(generic));
  });

  it('resolves the /JBIG2Globals DecodeParms stream through the caller-supplied indirect resolver', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const globalsStream = pdfStream(pdfDict({}), jbig2FixtureBytes(symbols.globals!));
    const resolve = (obj: PdfObject | undefined): PdfObject | undefined => (obj?.kind === 'ref' && obj.num === 7 ? globalsStream : obj);
    const dict = pdfDict({
      Filter: pdfName('JBIG2Decode'),
      DecodeParms: pdfDict({ JBIG2Globals: pdfRef(7, 0) }),
      Width: pdfNum(symbols.width),
      Height: pdfNum(symbols.height),
      BitsPerComponent: pdfNum(1),
      ColorSpace: pdfName('DeviceGray'),
    });
    const result = decodeStream(jbig2FixtureBytes(symbols.stream), dict, sink, resolve);
    expect(diagnostics).toEqual([]);
    expect(Array.from(result.bytes)).toEqual(expectedFilterBytes(symbols));
  });

  it('takes the page size from the image dictionary, cropping what the page information segment declared', () => {
    const { sink } = collectDiagnostics();
    const dict = pdfDict({ Filter: pdfName('JBIG2Decode'), Width: pdfNum(8), Height: pdfNum(4) });
    const result = decodeStream(jbig2FixtureBytes(generic.stream), dict, sink);
    expect(result.bytes.length).toBe(4);
  });

  it('degrades an undecodable JBIG2 stream with a diagnostic rather than throwing', () => {
    const { sink, diagnostics } = collectDiagnostics();
    // A text region whose symbol dictionary lives in a /JBIG2Globals stream that was never supplied.
    const dict = pdfDict({ Filter: pdfName('JBIG2Decode'), Width: pdfNum(symbols.width), Height: pdfNum(symbols.height) });
    const raw = jbig2FixtureBytes(symbols.stream);
    const result = decodeStream(raw, dict, sink);
    expect(result.remainingFilter).toBe('JBIG2Decode');
    expect(Array.from(result.bytes)).toEqual(Array.from(raw));
    expect(diagnostics.map((d) => d.code)).toContain('pdf/jbig2-undecodable');
  });

  it('warns when /JBIG2Globals is present but unresolvable, rather than silently ignoring it', () => {
    const { sink, diagnostics } = collectDiagnostics();
    const dict = pdfDict({
      Filter: pdfName('JBIG2Decode'),
      DecodeParms: pdfDict({ JBIG2Globals: pdfRef(9, 0) }),
      Width: pdfNum(generic.width),
      Height: pdfNum(generic.height),
    });
    const result = decodeStream(jbig2FixtureBytes(generic.stream), dict, sink);
    expect(diagnostics.map((d) => d.code)).toContain('pdf/jbig2-degraded');
    // The page's own segments still decode: only a stream that genuinely needed the globals would fail.
    expect(Array.from(result.bytes)).toEqual(expectedFilterBytes(generic));
  });
});
