// decodeText: the bytes to text boundary for the plain-text formats in this family (csv, markdown, and anything else whose bytes are just characters), deciding which character encoding a byte sequence actually holds rather than assuming UTF-8 and refusing everything else. Excel's own "CSV (Comma delimited)" export writes the Windows ANSI code page, and Notepad's "Unicode" save and PowerShell 5.1's redirection operator write UTF-16 with a byte order mark, so a decoder that accepts only UTF-8 turns away two of the most common ways an ordinary person produces a text file.
//
// Detection is deliberately bounded and ordered, never a general statistical classifier: a caller-supplied encoding wins, then a byte order mark, then the NUL interleave a mark-less UTF-16 file in a Latin script produces, then well-formed UTF-8, then windows-1252 as a last resort behind a check that the bytes read as Western text. windows-1252 maps nearly every byte to some character, so it can never be tested by trying it and seeing whether it fails; the plausibility check stands in for that, and its result is reported as a guess (confidence "low", plus a warning) rather than presented as fact. The caller can always override the whole decision with an explicit encoding.
//
// The text versus binary judgement is made on the bytes alone, before any encoding is guessed, precisely because windows-1252 would otherwise turn a PNG into a page of mojibake instead of refusing it. That ordering is what lets markdown's own bytes-level format detection stay a real check: markdown has no magic number, so "are these bytes text" is the only structural thing there is to ask about them.
//
// Every encoding here is decoded by this module rather than delegated to TextDecoder, with UTF-8 the one exception. TextDecoder's legacy single-byte and UTF-16 support comes from the host's ICU build, which a Node binary compiled with small-icu or with ICU disabled does not carry, and the Encoding Standard has no UTF-32 at all (https://encoding.spec.whatwg.org/#names-and-labels, https://web.archive.org/web/2026/https://encoding.spec.whatwg.org/#names-and-labels), so delegating would make the same bytes decode differently, or not at all, depending on where the code runs. The windows-1252 table has to exist here in any case, because the plausibility check is defined in terms of which byte positions that code page leaves without a character of their own. UTF-8 stays with TextDecoder because its fatal mode is exactly the validity check wanted, and UTF-8 is the one encoding every runtime supports without ICU.

/**
 * The character encodings {@link decodeText} can produce text from.
 *
 * Deliberately bounded: each is either self-identifying through a byte order mark, structurally checkable through its own validity rules, or guessable behind a stated plausibility test. Legacy CJK and Cyrillic code pages are outside the set on purpose, since nothing tells them apart from one another without the statistical model this module does not carry; bytes that look like one are refused rather than guessed at. That boundary also limits what {@link DecodeTextOptions.encoding} can name, which is a narrower restriction than detection itself needs (ExaDev/documents.js#1361).
 */
export type TextEncodingLabel =
  "utf-8" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be" | "windows-1252";

/**
 * How {@link decodeText} arrived at the encoding it used.
 *
 * `declared` is the caller's own `encoding` option, `bom` a byte order mark, `utf8` a successful decode under UTF-8's own validity rules with nothing declaring it, and `detected` a guess from one of the plausibility tests.
 */
export type DecodedTextSource = "declared" | "bom" | "utf8" | "detected";

/**
 * How far the reported encoding can be relied on.
 *
 * `certain`: the bytes settle it, or the caller declared it. A byte order mark identifies its encoding unambiguously, and bytes entirely below 0x80 decode to the same text under every encoding in the supported set. `high`: the bytes satisfy UTF-8's multi-byte validity rules, which text in a single-byte code page essentially never does by accident. `low`: a guess from a plausibility test. Show the encoding to whoever supplied the bytes and let them override it.
 */
export type DecodedTextConfidence = "certain" | "high" | "low";

/** What {@link decodeText} produced, and how far its own account of the encoding can be trusted. */
export interface DecodedText {
  /** The decoded text, with any byte order mark removed rather than left as a leading U+FEFF. */
  readonly text: string;
  /** The encoding the bytes were decoded under. */
  readonly encoding: TextEncodingLabel;
  /** What settled that encoding. */
  readonly source: DecodedTextSource;
  /** How far {@link DecodedText.encoding} can be relied on. */
  readonly confidence: DecodedTextConfidence;
  /** One entry per reason the caller should look at the result before trusting it, and empty whenever the confidence is `certain` or `high`. */
  readonly warnings: readonly string[];
}

/** Options for {@link decodeText} and {@link tryDecodeText}. */
export interface DecodeTextOptions {
  /** The encoding to decode under, skipping detection entirely. A byte order mark for this same encoding is still removed, so the option can be given for bytes that carry one. */
  readonly encoding?: TextEncodingLabel;
}

/** Why {@link UndecodableTextError} was thrown: `binary` for bytes no text encoding could hold, `malformed` for bytes that contradict the encoding a mark or the caller named, and `unrecognised` for text-shaped bytes matching none of the supported encodings. */
export type UndecodableTextReason = "binary" | "malformed" | "unrecognised";

/** Thrown when bytes cannot be turned into text: they are not text at all, they contradict a declared or marked encoding, or they match none of the supported encodings. */
export class UndecodableTextError extends Error {
  /** Which of the three failures this was, for a caller that treats them differently. */
  readonly reason: UndecodableTextReason;

  constructor(reason: UndecodableTextReason, message: string) {
    super(message);
    this.name = "UndecodableTextError";
    this.reason = reason;
  }
}

const NUL_BYTE = 0x00;

/** The first byte that is not a C0 control character. */
const FIRST_NON_CONTROL_BYTE = 0x20;

/** The first byte outside ASCII, which is also where every encoding in the supported set stops agreeing with every other. */
const FIRST_HIGH_BYTE = 0x80;

/** The C1 control range, which is both where windows-1252 differs from ISO-8859-1 and the range whose presence in a decoded result says the guess was wrong. Its start doubles as the first byte the windows-1252 table below covers. */
const C1_CONTROL_START = 0x80;
const C1_CONTROL_END = 0x9f;

/** C0 control bytes that appear in real text: tab, line feed, form feed, carriage return. Every other byte below {@link FIRST_NON_CONTROL_BYTE} belongs to binary content. */
const TEXTUAL_CONTROL_BYTES: ReadonlySet<number> = new Set([
  0x09, 0x0a, 0x0c, 0x0d,
]);

/** One C0 control byte outside {@link TEXTUAL_CONTROL_BYTES} is permitted per this many bytes before the content is taken for binary. Plain text carries none at all, so the allowance exists only to tolerate a stray one, an end-of-file Ctrl-Z left by a DOS-era editor being the case that actually occurs; compressed and image data puts roughly an eighth of its bytes in the C0 range, more than an order of magnitude above this. Counted as integer arithmetic against the byte length rather than a floating-point ratio so the boundary is exact. */
const BYTES_PER_PERMITTED_CONTROL_BYTE = 64;

/** The longest run of consecutive bytes at or above {@link FIRST_HIGH_BYTE} the windows-1252 guess accepts. Latin-script text sets an accented letter inside otherwise-ASCII words, so even the most accent-dense Western orthography never strings many together; text in a non-Latin single-byte code page, and bytes that are not text at all, put whole words above that boundary and run far longer. A caller holding bytes that genuinely do (a line of nothing but bullets, say) names the encoding explicitly rather than relying on the guess. */
const MAX_HIGH_BYTE_RUN = 4;

/** windows-1252's own mapping for the bytes from {@link C1_CONTROL_START} to {@link C1_CONTROL_END}, the one range where it differs from ISO-8859-1: bytes below are ASCII and bytes above are ISO-8859-1 exactly, so neither needs a table. Held as a string rather than an array so a lookup is a `charCodeAt` on a fixed-length string, with no index the type system has to be told is in range. Five positions (0x81, 0x8D, 0x8F, 0x90, 0x9D) have no character in Microsoft's own code page; the Encoding Standard maps them to the matching C1 control characters so that its decoder is total, and this table does the same, so decoding here and decoding through a TextDecoder that does support the label agree byte for byte. */
const WINDOWS_1252_HIGH_RANGE =
  "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/** The bytes windows-1252 leaves without a character of their own, derived from {@link WINDOWS_1252_HIGH_RANGE} as exactly those positions whose mapping lands back in the C1 control range instead of on a real character. A C1 control appears in no text document, so one of these bytes says the content is not windows-1252 text whatever else it may be. */
const WINDOWS_1252_UNDEFINED_BYTES: ReadonlySet<number> = new Set(
  Array.from(WINDOWS_1252_HIGH_RANGE).flatMap((character, index) => {
    const codePoint = character.charCodeAt(0);
    return codePoint >= C1_CONTROL_START && codePoint <= C1_CONTROL_END
      ? [C1_CONTROL_START + index]
      : [];
  }),
);

/** UTF-16's surrogate range, whose halves pair up to carry a code point above the basic plane and which is never a code point in its own right. */
const HIGH_SURROGATE_START = 0xd800;
const HIGH_SURROGATE_END = 0xdbff;
const LOW_SURROGATE_START = 0xdc00;
const LOW_SURROGATE_END = 0xdfff;

/** The highest code point Unicode defines, and the first one that needs a surrogate pair to reach in UTF-16. */
const MAX_CODE_POINT = 0x10ffff;
const SUPPLEMENTARY_PLANE_START = 0x10000;

/** How a supplementary code point splits across a surrogate pair: the ten low bits go to the low half and the rest to the high half, both biased by the start of their own range. */
const SURROGATE_BITS = 10;
const LOW_SURROGATE_MASK = 0x3ff;

/**
 * Code units converted by one `String.fromCharCode.apply` call. JavaScriptCore rejects a call with more than 65536 arguments, a limit MDN documents as hard-coded (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/apply), and other engines bound the same thing by stack size, so this is half that stated figure, leaving the engine room for whatever else it puts on its argument stack. The same quantum src/bytes/base64.ts's own chunked encode uses, for the same reason: appending one character at a time to a string is what made converting a few megabytes take seconds under instrumentation.
 *
 * Exported so tests can place inputs on and around a chunk boundary without repeating the figure.
 */
export const TEXT_DECODE_CHUNK_CODE_UNITS = 65_536 / 2;

function fromCodeUnits(units: readonly number[]): string {
  return Array.from(
    { length: Math.ceil(units.length / TEXT_DECODE_CHUNK_CODE_UNITS) },
    (_unused, chunk) => {
      const start = chunk * TEXT_DECODE_CHUNK_CODE_UNITS;
      return String.fromCharCode.apply(
        null,
        units.slice(start, start + TEXT_DECODE_CHUNK_CODE_UNITS),
      );
    },
  ).join("");
}

/** Every byte order mark, longest first: UTF-32LE's begins with UTF-16LE's, so the four-byte marks have to be tested before the two-byte ones. Unicode resolves that overlap the same way, the alternative reading being a UTF-16LE file whose first character is U+0000, which is not a file that occurs. */
const BOM_SIGNATURES: readonly {
  readonly encoding: TextEncodingLabel;
  readonly bytes: readonly number[];
}[] = [
  { encoding: "utf-32be", bytes: [0x00, 0x00, 0xfe, 0xff] },
  { encoding: "utf-32le", bytes: [0xff, 0xfe, 0x00, 0x00] },
  { encoding: "utf-8", bytes: [0xef, 0xbb, 0xbf] },
  { encoding: "utf-16be", bytes: [0xfe, 0xff] },
  { encoding: "utf-16le", bytes: [0xff, 0xfe] },
];

function findBom(
  bytes: Uint8Array,
): (typeof BOM_SIGNATURES)[number] | undefined {
  return BOM_SIGNATURES.find((signature) =>
    signature.bytes.every((value, index) => bytes[index] === value),
  );
}

/** The bytes past a byte order mark for `encoding`, or the bytes unchanged when they carry no such mark. A mark for a different encoding is left alone: under a declared encoding it is content, not a mark. */
function stripBom(bytes: Uint8Array, encoding: TextEncodingLabel): Uint8Array {
  const bom = findBom(bytes);
  return bom?.encoding === encoding ? bytes.subarray(bom.bytes.length) : bytes;
}

function tryDecodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    // ignoreBOM leaves a leading U+FEFF as a character rather than dropping it, so that stripBom above is the only thing that ever removes a mark and the two can never both act on the same bytes.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    return undefined;
  }
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.byteLength % 2 !== 0) {
    throw new UndecodableTextError(
      "malformed",
      "UTF-16 text must hold a whole number of 16-bit code units",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units: number[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 2) {
    units.push(view.getUint16(offset, littleEndian));
  }
  // A surrogate half without its partner is the strongest evidence available that these bytes are not UTF-16 at all, so it is refused rather than carried into the result as an ill-formed string.
  let awaitingLowSurrogate = false;
  for (const unit of units) {
    const isLow = unit >= LOW_SURROGATE_START && unit <= LOW_SURROGATE_END;
    if (awaitingLowSurrogate !== isLow) {
      throw new UndecodableTextError(
        "malformed",
        "UTF-16 text must pair every surrogate half with its partner",
      );
    }
    awaitingLowSurrogate =
      unit >= HIGH_SURROGATE_START && unit <= HIGH_SURROGATE_END;
  }
  if (awaitingLowSurrogate) {
    throw new UndecodableTextError(
      "malformed",
      "UTF-16 text must pair every surrogate half with its partner",
    );
  }
  return fromCodeUnits(units);
}

function decodeUtf32(bytes: Uint8Array, littleEndian: boolean): string {
  if (bytes.byteLength % 4 !== 0) {
    throw new UndecodableTextError(
      "malformed",
      "UTF-32 text must hold a whole number of 32-bit code units",
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units: number[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    const codePoint = view.getUint32(offset, littleEndian);
    if (
      codePoint > MAX_CODE_POINT ||
      (codePoint >= HIGH_SURROGATE_START && codePoint <= LOW_SURROGATE_END)
    ) {
      throw new UndecodableTextError(
        "malformed",
        "UTF-32 text must hold only Unicode scalar values",
      );
    }
    if (codePoint < SUPPLEMENTARY_PLANE_START) {
      units.push(codePoint);
      continue;
    }
    const supplementary = codePoint - SUPPLEMENTARY_PLANE_START;
    units.push(HIGH_SURROGATE_START + (supplementary >> SURROGATE_BITS));
    units.push(LOW_SURROGATE_START + (supplementary & LOW_SURROGATE_MASK));
  }
  return fromCodeUnits(units);
}

function decodeWindows1252(bytes: Uint8Array): string {
  const units: number[] = [];
  for (const byte of bytes) {
    units.push(
      byte < C1_CONTROL_START || byte > C1_CONTROL_END
        ? byte
        : WINDOWS_1252_HIGH_RANGE.charCodeAt(byte - C1_CONTROL_START),
    );
  }
  return fromCodeUnits(units);
}

function decodeUtf8(bytes: Uint8Array): string {
  const text = tryDecodeUtf8(bytes);
  if (text === undefined) {
    throw new UndecodableTextError(
      "malformed",
      "UTF-8 text must hold only well-formed byte sequences",
    );
  }
  return text;
}

/** One decoder per supported encoding, as a record keyed by the encoding union itself so that adding an encoding to {@link TextEncodingLabel} without a decoder for it is a compile error rather than a run-time gap. */
const DECODERS: Readonly<
  Record<TextEncodingLabel, (bytes: Uint8Array) => string>
> = {
  "utf-8": decodeUtf8,
  "utf-16le": (bytes) => decodeUtf16(bytes, true),
  "utf-16be": (bytes) => decodeUtf16(bytes, false),
  "utf-32le": (bytes) => decodeUtf32(bytes, true),
  "utf-32be": (bytes) => decodeUtf32(bytes, false),
  "windows-1252": decodeWindows1252,
};

/**
 * Whether bytes can hold text at all, judged without reference to which encoding they might be in.
 *
 * A NUL byte belongs to no text document format, and outside NUL the only C0 control bytes text carries are tab, line feed, form feed and carriage return, so a density of any others says binary. {@link decodeText} asks this before it guesses at windows-1252, which maps nearly every byte to some character and would otherwise read a PNG as a page of mojibake rather than refusing it.
 *
 * UTF-16 is the one text encoding this returns `false` for, since it interleaves NUL bytes by design; {@link decodeText} settles UTF-16 from a byte order mark or that same interleave before it reaches this check.
 * @param bytes - The bytes to judge.
 * @returns Whether the bytes carry no NUL and few enough other C0 control bytes to be text.
 */
export function isProbablyText(bytes: Uint8Array): boolean {
  let controlBytes = 0;
  for (const byte of bytes) {
    if (byte === NUL_BYTE) {
      return false;
    }
    if (byte < FIRST_NON_CONTROL_BYTE && !TEXTUAL_CONTROL_BYTES.has(byte)) {
      controlBytes += 1;
    }
  }
  return controlBytes * BYTES_PER_PERMITTED_CONTROL_BYTE <= bytes.length;
}

/** Whether the bytes could be windows-1252 text, as opposed to some other single-byte code page or no text at all. windows-1252 has a character for all but five of its byte values, so trying it and seeing whether it fails proves nothing; these two structural tests are what stands in for that. */
function looksLikeWindows1252Text(bytes: Uint8Array): boolean {
  let highByteRun = 0;
  for (const byte of bytes) {
    if (WINDOWS_1252_UNDEFINED_BYTES.has(byte)) {
      return false;
    }
    if (byte < FIRST_HIGH_BYTE) {
      highByteRun = 0;
      continue;
    }
    highByteRun += 1;
    if (highByteRun > MAX_HIGH_BYTE_RUN) {
      return false;
    }
  }
  return true;
}

/**
 * UTF-16 without a byte order mark, recognised from the NUL a code unit below U+0100 puts on one fixed side of every unit pair.
 *
 * The recognised case is UTF-16 holding mostly Latin-script text, which is the only case a NUL interleave makes visible at all: UTF-16 holding CJK text has no NUL high bytes to see and is indistinguishable from other byte sequences without the statistical model this module does not carry. A majority on exactly one side is the signal, so bytes with NULs on both sides, padding rather than text, match neither.
 */
function detectBomlessUtf16(bytes: Uint8Array): TextEncodingLabel | undefined {
  if (bytes.length % 2 !== 0) {
    return undefined;
  }
  let evenIndexNuls = 0;
  let oddIndexNuls = 0;
  // Walked byte by byte with the parity carried alongside, rather than by index against a bound, so that which side of the unit boundary a byte sits on is read off the walk itself.
  let atEvenIndex = true;
  for (const byte of bytes) {
    if (byte === NUL_BYTE) {
      if (atEvenIndex) {
        evenIndexNuls += 1;
      } else {
        oddIndexNuls += 1;
      }
    }
    atEvenIndex = !atEvenIndex;
  }
  const units = bytes.length / 2;
  if (oddIndexNuls > evenIndexNuls && oddIndexNuls * 2 > units) {
    return "utf-16le";
  }
  if (evenIndexNuls > oddIndexNuls && evenIndexNuls * 2 > units) {
    return "utf-16be";
  }
  return undefined;
}

function guessWarning(encoding: TextEncodingLabel, evidence: string): string {
  return `encoding was guessed as ${encoding}: ${evidence}. Pass an explicit encoding if that is wrong.`;
}

/**
 * Decodes bytes to text, working out which character encoding they hold.
 *
 * The encoding is settled in a fixed order: the `encoding` option if the caller gave one, then a byte order mark, then the NUL interleave UTF-16 leaves when it holds Latin-script text and carries no mark, then UTF-8 if the bytes satisfy its own validity rules, then windows-1252 if the bytes read as Western text. Anything a byte order mark or the caller names is decoded under that encoding alone and fails if the bytes contradict it. Everything reached by detection reports how it was reached, so a caller can show the encoding, and a guess additionally carries a warning and a `low` confidence rather than being presented as fact.
 *
 * Bytes that are not text (a NUL byte, or a density of other C0 control bytes) are refused before any guess is made, so detection never widens what counts as text. A byte order mark is removed from the result rather than left as a leading U+FEFF.
 * @param bytes - The bytes to decode.
 * @param options - An explicit `encoding` to decode under, skipping detection.
 * @throws UndecodableTextError When the bytes are not text, contradict a declared or marked encoding, or match none of the supported encodings.
 * @returns The text, the encoding it was decoded under, and how far that account of the encoding can be relied on.
 */
export function decodeText(
  bytes: Uint8Array,
  options: DecodeTextOptions = {},
): DecodedText {
  const declared = options.encoding;
  if (declared !== undefined) {
    return {
      text: DECODERS[declared](stripBom(bytes, declared)),
      encoding: declared,
      source: "declared",
      confidence: "certain",
      warnings: [],
    };
  }

  const bom = findBom(bytes);
  if (bom !== undefined) {
    return {
      text: DECODERS[bom.encoding](bytes.subarray(bom.bytes.length)),
      encoding: bom.encoding,
      source: "bom",
      confidence: "certain",
      warnings: [],
    };
  }

  const interleaved = detectBomlessUtf16(bytes);
  if (interleaved !== undefined) {
    return {
      text: DECODERS[interleaved](bytes),
      encoding: interleaved,
      source: "detected",
      confidence: "low",
      warnings: [
        guessWarning(
          interleaved,
          "the bytes carry no byte order mark, but interleave NUL bytes in the pattern UTF-16 gives Latin-script text",
        ),
      ],
    };
  }

  if (!isProbablyText(bytes)) {
    throw new UndecodableTextError(
      "binary",
      "bytes are not text: they carry a NUL byte, or too many other C0 control bytes for any text encoding",
    );
  }

  const utf8 = tryDecodeUtf8(bytes);
  if (utf8 !== undefined) {
    return {
      text: utf8,
      encoding: "utf-8",
      source: "utf8",
      // ASCII decodes to the same text under every encoding in the supported set, so calling it UTF-8 cannot be wrong; above ASCII, UTF-8's multi-byte rules are strong evidence rather than proof. A UTF-8 decode yields exactly one code unit per byte only for ASCII, since every multi-byte sequence collapses two, three or four bytes into one or two code units, so the lengths matching is itself the proof that there were none.
      confidence: utf8.length === bytes.length ? "certain" : "high",
      warnings: [],
    };
  }

  if (looksLikeWindows1252Text(bytes)) {
    return {
      text: decodeWindows1252(bytes),
      encoding: "windows-1252",
      source: "detected",
      confidence: "low",
      warnings: [
        guessWarning(
          "windows-1252",
          "the bytes carry no byte order mark, are not well-formed UTF-8, and read as Western text",
        ),
      ],
    };
  }

  throw new UndecodableTextError(
    "unrecognised",
    "bytes are text but match none of the supported encodings: not UTF-8, and not plausible as windows-1252",
  );
}

/**
 * {@link decodeText}, returning `undefined` where it would throw.
 *
 * For a caller asking whether bytes are decodable at all, a schema refinement being the case this exists for, where an exception would be control flow rather than an error.
 * @param bytes - The bytes to decode.
 * @param options - An explicit `encoding` to decode under, skipping detection.
 * @returns What {@link decodeText} would return, or `undefined` where it would throw.
 */
export function tryDecodeText(
  bytes: Uint8Array,
  options: DecodeTextOptions = {},
): DecodedText | undefined {
  try {
    return decodeText(bytes, options);
  } catch {
    return undefined;
  }
}
