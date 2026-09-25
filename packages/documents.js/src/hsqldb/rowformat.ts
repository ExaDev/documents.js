import type { ContentCellValue } from "document-schema.js";

// Per-SQL-type binary field decoding for HSQLDB 1.8.x's own CACHED-table row-store format (org.hsqldb.rowio.RowInputBinary/RowInputBase, org.hsqldb.rowio.RowOutputBinary/RowOutputBase) — the exact binary layout src/hsqldb/cache.ts (Tier 2) needs to walk a table's rows once it has located them via the B-tree in database/*.data. There is no ratified specification for this format; ground truth here is the actual HSQLDB 1.8.0.10 engine source (decompiled from the real hsqldb.jar bundled with LibreOffice 26.2, Specification-Version 1.8.0.10 — the exact engine version LibreOffice's embedded HSQLDB driver ships, confirmed via that jar's own META-INF/MANIFEST.MF) cross-checked field-by-field against a real database this same jar produced and re-read via plain JDBC. See src/hsqldb/cache.ts's own module comment for the row/tree-walking half and the full verification account.
//
// A column's binary field is always [1-byte present-flag: 0x00 = NULL, otherwise present][type-specific payload if present] — checkNull()/writeNull()/writeFieldType() in the decompiled source. Every multi-byte numeric field is big-endian (java.io.DataOutput's own convention, which org.hsqldb.lib.HsqlByteArrayOutputStream/HsqlByteArrayInputStream implement directly).

export class HsqldbRowFormatError extends Error {
  constructor(message: string) {
    super(`HSQLDB binary row format error: ${message}`);
    this.name = "HsqldbRowFormatError";
  }
}

// org.hsqldb.Types' own java.sql.Types-based type codes, including HSQLDB's own VARCHAR_IGNORECASE=100 extension — verified against the decompiled org.hsqldb.Types class (its typeAliases/typeNames static initializers) bundled in the same hsqldb.jar. Named here (rather than left as literals in SQL_TYPE_NAME_TO_CODE below) so readHsqldbColumnValue's own switch, further down this file, can dispatch on the identical constant rather than a second, separately-transcribed copy of each code.
const SQL_CHAR = 1;
const SQL_NUMERIC = 2;
const SQL_DECIMAL = 3;
const SQL_INTEGER = 4;
const SQL_SMALLINT = 5;
const SQL_FLOAT = 6;
const SQL_REAL = 7;
const SQL_DOUBLE = 8;
const SQL_VARCHAR = 12;
const SQL_BOOLEAN_BIT = 16;
const SQL_DATE = 91;
const SQL_TIME = 92;
const SQL_TIMESTAMP = 93;
const SQL_VARCHAR_IGNORECASE = 100;
const SQL_BIGINT = -5;
const SQL_TINYINT = -6;
const SQL_LONGVARCHAR = -1;

// A column's declared SQL type name (from CREATE CACHED TABLE's own DDL text, already available via src/hsqldb/script.ts's HsqldbColumn.type) resolves to one of the codes above to select the right binary decoder — the row bytes themselves carry no per-field type tag of their own (RowOutputBase.writeData dispatches purely from the table's own declared column types, and RowInputBase.readData must be handed the identical types back to read the same bytes).
const SQL_TYPE_NAME_TO_CODE: Readonly<Record<string, number>> = {
  INTEGER: SQL_INTEGER,
  INT: SQL_INTEGER,
  IDENTITY: SQL_INTEGER,
  DOUBLE: SQL_DOUBLE,
  FLOAT: SQL_FLOAT,
  REAL: SQL_REAL,
  VARCHAR: SQL_VARCHAR,
  CHAR: SQL_CHAR,
  CHARACTER: SQL_CHAR,
  LONGVARCHAR: SQL_LONGVARCHAR,
  VARCHAR_IGNORECASE: SQL_VARCHAR_IGNORECASE,
  DATE: SQL_DATE,
  TIME: SQL_TIME,
  TIMESTAMP: SQL_TIMESTAMP,
  DATETIME: SQL_TIMESTAMP,
  DECIMAL: SQL_DECIMAL,
  NUMERIC: SQL_NUMERIC,
  BIT: SQL_BOOLEAN_BIT,
  BOOLEAN: SQL_BOOLEAN_BIT,
  TINYINT: SQL_TINYINT,
  SMALLINT: SQL_SMALLINT,
  BIGINT: SQL_BIGINT,
};

// Column types RowInputBase.readData genuinely supports but ContentCellValue has no matching kind for at all (no binary/blob/object kind anywhere in document-schema.js's cell-value union) — named here so resolveHsqldbTypeCode fails with a specific, honest diagnosis rather than the generic "unrecognised type" message a plain lookup miss would give.
const UNSUPPORTED_SQL_TYPE_NAMES: ReadonlySet<string> = new Set([
  "BINARY",
  "VARBINARY",
  "LONGVARBINARY",
  "OTHER",
  "OBJECT",
]);

const LEADING_WORD_RE = /^([A-Za-z_][A-Za-z0-9_]*)/;

// Resolves a CREATE CACHED TABLE column's own declared type clause (e.g. "INTEGER NOT NULL PRIMARY KEY", "VARCHAR(50)", "DECIMAL(10,2)") to the SQL type code its binary row data was encoded with — mirrors src/hsqldb/script.ts's own typeBucket() in only looking at the leading type-name word, since HSQLDB's own binary encoding never varies by a type's precision/scale/length argument (only by which SQL_TYPE_NAME_TO_CODE bucket it falls into).
export function resolveHsqldbTypeCode(declaredType: string): number {
  const word = LEADING_WORD_RE.exec(declaredType.trim())?.[1]?.toUpperCase();
  if (word === undefined) {
    throw new HsqldbRowFormatError(
      `cannot resolve a SQL type name from column type clause "${declaredType}"`,
    );
  }
  if (UNSUPPORTED_SQL_TYPE_NAMES.has(word)) {
    throw new HsqldbRowFormatError(
      `column type "${word}" has no document-schema.js ContentCellValue equivalent (binary/object column types are not representable) — from declared type "${declaredType}"`,
    );
  }
  const code = SQL_TYPE_NAME_TO_CODE[word];
  if (code === undefined) {
    throw new HsqldbRowFormatError(
      `unrecognised HSQLDB column type "${word}" — from declared type "${declaredType}"`,
    );
  }
  return code;
}

// A forward-only, big-endian cursor over a CACHED table's own row-store bytes. HSQLDB 1.8's binary row format is exclusively big-endian and DataView-native, unlike src/bytes/ByteReader's own ASCII/PDF-tokenizing scope — that reader deliberately has no fixed-width integer readers at all (see its own module comment), since the PDF lexer it serves never needs one.
export class HsqldbDataCursor {
  private readonly bytes: Uint8Array<ArrayBuffer>;
  private readonly view: DataView;
  position: number;

  constructor(bytes: Uint8Array<ArrayBuffer>, offset = 0) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.position = offset;
  }

  readUint8(): number {
    const value = this.view.getUint8(this.position);
    this.position += 1;
    return value;
  }

  readInt16(): number {
    const value = this.view.getInt16(this.position, false);
    this.position += 2;
    return value;
  }

  readInt32(): number {
    const value = this.view.getInt32(this.position, false);
    this.position += 4;
    return value;
  }

  readBigInt64(): bigint {
    const value = this.view.getBigInt64(this.position, false);
    this.position += 8;
    return value;
  }

  readFloat64(): number {
    const value = this.view.getFloat64(this.position, false);
    this.position += 8;
    return value;
  }

  readBytes(length: number): Uint8Array<ArrayBuffer> {
    const slice = this.bytes.subarray(this.position, this.position + length);
    this.position += length;
    return slice;
  }
}

// A byte's top bit (value 128): below it, a lead byte is plain single-byte ASCII; at or above it, a lead byte starts a multi-byte sequence; masked onto a continuation byte, it is exactly the required 10xxxxxx continuation tag; and, on the top byte of a two's-complement magnitude, it is the sign bit signedBigIntFromBytes below tests.
const HIGH_BIT = 0x80;
const UTF8_CONTINUATION_MASK = 0xc0; // isolates a continuation byte's own top two bits, which must read 10 (i.e. equal HIGH_BIT once masked)
const UTF8_TWO_BYTE_LEAD_NIBBLE_LOW = 0xc; // a 110xxxxx lead byte's high nibble is 0xC or 0xD
const UTF8_TWO_BYTE_LEAD_NIBBLE_HIGH = 0xd;
const UTF8_TWO_BYTE_DATA_MASK = 0x1f; // the 5 data bits a 110xxxxx lead byte carries
const UTF8_THREE_BYTE_LEAD_NIBBLE = 0xe; // a 1110xxxx lead byte's high nibble
const UTF8_THREE_BYTE_DATA_MASK = 0xf; // the 4 data bits a 1110xxxx lead byte carries
const UTF8_CONTINUATION_DATA_MASK = 0x3f; // the 6 data bits every 10xxxxxx continuation byte carries
const UTF8_CONTINUATION_BITS = 6; // width, in bits, of one continuation byte's own data field
const UTF8_THREE_BYTE_SEQUENCE_LENGTH = 3;
const HEX_RADIX = 16;
const NIBBLE_BITS = 4; // width, in bits, of a lead byte's high nibble, isolated by a right-shift

// Java's own "modified UTF-8" encoding (java.io.DataOutput.writeUTF's per-character scheme, reused verbatim by HSQLDB's own org.hsqldb.lib.StringConverter.writeUTF/readUTF for every CHAR/VARCHAR row field) — deliberately NOT plain UTF-8: the NUL character always encodes as the 2-byte sequence 0xC0 0x80 rather than a bare 0x00 byte, and a supplementary-plane character (outside the Basic Multilingual Plane) encodes as two independent 3-byte sequences over its own UTF-16 surrogate pair rather than one real 4-byte UTF-8 sequence. TextDecoder('utf-8') would silently misdecode either case, so this is a dedicated decoder rather than a shortcut — each decoded UTF-16 code unit is appended via String.fromCharCode, so a genuine surrogate pair (two consecutive 3-byte sequences) still recombines into the correct JS string exactly as it would in Java, with no special-casing needed here.
export function readModifiedUtf8(bytes: Uint8Array<ArrayBuffer>): string {
  let result = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    if (b0 === undefined) {
      throw new HsqldbRowFormatError("truncated modified-UTF-8 byte sequence");
    }
    if (b0 > 0 && b0 < HIGH_BIT) {
      result += String.fromCharCode(b0);
      i += 1;
      continue;
    }
    const leadNibble = b0 >> NIBBLE_BITS;
    if (
      leadNibble === UTF8_TWO_BYTE_LEAD_NIBBLE_LOW ||
      leadNibble === UTF8_TWO_BYTE_LEAD_NIBBLE_HIGH
    ) {
      const b1 = bytes[i + 1];
      if (b1 === undefined || (b1 & UTF8_CONTINUATION_MASK) !== HIGH_BIT) {
        throw new HsqldbRowFormatError(
          "malformed modified-UTF-8 2-byte sequence",
        );
      }
      result += String.fromCharCode(
        ((b0 & UTF8_TWO_BYTE_DATA_MASK) << UTF8_CONTINUATION_BITS) |
          (b1 & UTF8_CONTINUATION_DATA_MASK),
      );
      i += 2;
      continue;
    }
    if (leadNibble === UTF8_THREE_BYTE_LEAD_NIBBLE) {
      const b1 = bytes[i + 1];
      const b2 = bytes[i + 2];
      if (
        b1 === undefined ||
        b2 === undefined ||
        (b1 & UTF8_CONTINUATION_MASK) !== HIGH_BIT ||
        (b2 & UTF8_CONTINUATION_MASK) !== HIGH_BIT
      ) {
        throw new HsqldbRowFormatError(
          "malformed modified-UTF-8 3-byte sequence",
        );
      }
      result += String.fromCharCode(
        ((b0 & UTF8_THREE_BYTE_DATA_MASK) << (UTF8_CONTINUATION_BITS * 2)) |
          ((b1 & UTF8_CONTINUATION_DATA_MASK) << UTF8_CONTINUATION_BITS) |
          (b2 & UTF8_CONTINUATION_DATA_MASK),
      );
      i += UTF8_THREE_BYTE_SEQUENCE_LENGTH;
      continue;
    }
    throw new HsqldbRowFormatError(
      `malformed modified-UTF-8 lead byte 0x${b0.toString(HEX_RADIX)}`,
    );
  }
  return result;
}

const ZERO_BIGINT = 0n;
const ONE_BIGINT = 1n;
const BITS_PER_BYTE = 8;
const BITS_PER_BYTE_BIGINT = 8n;

// The write side of this is java.math.BigInteger.toByteArray(): a minimal big-endian two's-complement encoding (Java always emits at least one byte, adding a leading 0x00 pad byte only when needed to keep an otherwise high-bit-set positive value unambiguous). Decoding is the standard two's-complement inverse: accumulate the magnitude as if unsigned, then subtract 2^(8*byteLength) when the top bit says the value is negative.
function signedBigIntFromBytes(bytes: Uint8Array<ArrayBuffer>): bigint {
  if (bytes.length === 0) {
    return ZERO_BIGINT;
  }
  let magnitude = ZERO_BIGINT;
  for (const byte of bytes) {
    magnitude = (magnitude << BITS_PER_BYTE_BIGINT) | BigInt(byte);
  }
  const firstByte = bytes[0];
  const isNegative = firstByte !== undefined && (firstByte & HIGH_BIT) !== 0;
  return isNegative
    ? magnitude - (ONE_BIGINT << BigInt(BITS_PER_BYTE * bytes.length))
    : magnitude;
}

// unscaled * 10^-scale, built as a decimal STRING via BigInt digit manipulation (never a floating multiplication/division, which would risk rounding for a large unscaled magnitude) — matching how src/hsqldb/script.ts's own Tier 1 NUMBER_LITERAL_RE-based DECIMAL/NUMERIC literal parsing already keeps a numeric SQL literal's own source text intact rather than reconstructing it from a parsed float. This is the exact digit string document-schema.js's own DecimalStringSchema (ContentCellValueSchema's exactValue sidecar) expects, before any trailing-zero normalisation.
function exactDecimalDigits(unscaled: bigint, scale: number): string {
  const isNegative = unscaled < ZERO_BIGINT;
  const magnitudeDigits = (isNegative ? -unscaled : unscaled).toString();
  const sign = isNegative ? "-" : "";
  if (scale <= 0) {
    return `${sign}${magnitudeDigits}${"0".repeat(-scale)}`;
  }
  const padded = magnitudeDigits.padStart(scale + 1, "0");
  const wholePart = padded.slice(0, padded.length - scale);
  const fractionPart = padded.slice(padded.length - scale);
  return `${sign}${wholePart}.${fractionPart}`;
}

// Strips trailing zeros from a decimal digit string's own fractional part (and the decimal point itself, once the fraction is fully consumed) — a fixed-scale DECIMAL/NUMERIC value like "125.50" carries no more precision than "125.5" (trailing fractional zeros are never significant digits, unlike an integer's own trailing zeros, which this function leaves untouched since it only ever trims after a '.'). Without this normalisation, an ordinary DECIMAL(10,2) column whose value happens to be a whole number or end in a zero digit (a common, unremarkable case — see the real EMPLOYEES/ORDERS fixtures this module's own tests already cover) would spuriously gain an exactValue sidecar even though Number() already represents it exactly, just under a different, shorter string spelling.
function trimTrailingFractionZeros(digits: string): string {
  if (!digits.includes(".")) {
    return digits;
  }
  const trimmed = digits.replace(/0+$/, "");
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

// A 'number'-kind ContentCellValue for an exact unscaled-integer-plus-scale value, attaching document-schema.js's own exactValue sidecar (ContentCellValueSchema's own doc comment: "a producer should only set it when String(Number(exactValue)) would not round-trip back to exactValue exactly") only when the double approximation genuinely loses information — absent for the overwhelming majority of real BIGINT/DECIMAL/NUMERIC cells (anything Number() already represents exactly), present with the real, full-precision decimal string for a BIGINT beyond Number.MAX_SAFE_INTEGER or a DECIMAL/NUMERIC value with more significant digits than a double can carry.
function numericCellValue(unscaled: bigint, scale: number): ContentCellValue {
  const exact = trimTrailingFractionZeros(exactDecimalDigits(unscaled, scale));
  const value = Number(exact);
  return String(value) === exact
    ? { kind: "number", value }
    : { kind: "number", value, exactValue: exact };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// HSQLDB 1.8's own DATE/TIME/TIMESTAMP row encoding is a bare epoch-millisecond long (java.sql.Date/Time.getTime(), or a java.sql.Timestamp's getTime() for TIMESTAMP) with no embedded timezone or offset at all: org.hsqldb.HsqlDateTime resolves every date/time value through a java.util.Calendar carrying no explicit TimeZone, i.e. the WRITING JVM's own default timezone, so the on-disk long is only unambiguous when reinterpreted in that same timezone. Which timezone that was is genuinely not recorded anywhere in the file, so it can only ever come from the caller — hence timeZone below, and hence the reading process's own local timezone as the default, correct whenever a .odb is read on the same machine/region that created it (the overwhelmingly common case) and wrong, silently, for one moved elsewhere. Verified empirically against a real HSQLDB-written fixture spanning both GMT and BST dates — see src/hsqldb/cache.ts's own verification account and the README's Gotchas entry.
export interface HsqldbDecodeOptions {
  // The IANA time-zone name (e.g. 'Europe/London', 'America/New_York') the .odb's own DATE/TIME/TIMESTAMP values were WRITTEN in. Omitted — the default — means the reading process's own local timezone. Affects the CACHED-table binary row store (Tier 2) and the binary/compressed whole-script format (Tier 4) only: Tier 1's TEXT script carries date/time values as already-formatted literal text, and Tier 3's Firebird backup carries a genuine timezone-free day count, so neither has an epoch instant to reinterpret in the first place.
  readonly timeZone?: string;
}

interface CalendarFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

const ZONED_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

// The 'u-ca-iso8601' calendar extension pins the year field to the proleptic ISO year (matching Date.getFullYear's own numbering, including year 0 and negatives) rather than a locale's default era-relative one, so the two branches of calendarFieldsAt below agree by construction rather than by coincidence. Throws RangeError, naming the offending value, for a time-zone name the platform does not recognise — deliberately left to propagate, since it is already the clearest possible diagnosis of a caller's own bad option.
function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = ZONED_FORMATTERS.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat("en-US-u-ca-iso8601", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  ZONED_FORMATTERS.set(timeZone, formatter);
  return formatter;
}

function requiredPart(
  parts: ReadonlyMap<string, string>,
  type: string,
  timeZone: string,
): number {
  const raw = parts.get(type);
  if (raw === undefined) {
    throw new HsqldbRowFormatError(
      `Intl.DateTimeFormat produced no "${type}" part for time zone "${timeZone}"`,
    );
  }
  return Number(raw);
}

// Resolves an epoch instant's own calendar fields in the requested zone — via JS Date's local getters when the caller wants the reading process's own timezone (the historical, verified default path), and via a cached Intl.DateTimeFormat otherwise. Cached per zone NAME only, never for the implicit local zone, so a process that changes its own TZ mid-run (as this package's own test suite deliberately does) never reads a stale formatter.
function calendarFieldsAt(
  epochMillis: bigint,
  timeZone: string | undefined,
): CalendarFields {
  const date = new Date(Number(epochMillis));
  if (timeZone === undefined) {
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hours: date.getHours(),
      minutes: date.getMinutes(),
      seconds: date.getSeconds(),
    };
  }
  const parts = new Map(
    zonedFormatter(timeZone)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: requiredPart(parts, "year", timeZone),
    month: requiredPart(parts, "month", timeZone),
    day: requiredPart(parts, "day", timeZone),
    hours: requiredPart(parts, "hour", timeZone),
    minutes: requiredPart(parts, "minute", timeZone),
    seconds: requiredPart(parts, "second", timeZone),
  };
}

const MILLIS_PER_SECOND_BIGINT = 1000n;

// The instant's own sub-second remainder, which is timezone-independent (every IANA zone offset is a whole number of minutes) and so is taken straight off the epoch value rather than through calendarFieldsAt.
function millisOfSecond(epochMillis: bigint): number {
  return Number(
    ((epochMillis % MILLIS_PER_SECOND_BIGINT) + MILLIS_PER_SECOND_BIGINT) %
      MILLIS_PER_SECOND_BIGINT,
  );
}

function formatDate(epochMillis: bigint, timeZone: string | undefined): string {
  const { year, month, day } = calendarFieldsAt(epochMillis, timeZone);
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

const MILLIS_DIGIT_WIDTH = 3;

function formatTime(epochMillis: bigint, timeZone: string | undefined): string {
  const { hours, minutes, seconds } = calendarFieldsAt(epochMillis, timeZone);
  const base = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  const millis = millisOfSecond(epochMillis);
  return millis === 0
    ? base
    : `${base}.${String(millis).padStart(MILLIS_DIGIT_WIDTH, "0")}`;
}

const NANOS_DIGIT_WIDTH = 9;

// TIMESTAMP's own on-disk pair is [epoch-millis long][nanos int] (org.hsqldb.rowio.RowOutputBinary.writeTimestamp: writeLong(timestamp.getTime()); writeInt(timestamp.getNanos())) — java.sql.Timestamp.getNanos() carries the value's FULL nanosecond-resolution fractional-second component independently of getTime()'s own millisecond-rounded one, so the fractional suffix below is built from nanos directly rather than from the millis value's own sub-second part (only the whole-second date/time-of-day fields come from the instant).
function formatTimestamp(
  epochMillis: bigint,
  nanos: number,
  timeZone: string | undefined,
): string {
  const { year, month, day, hours, minutes, seconds } = calendarFieldsAt(
    epochMillis,
    timeZone,
  );
  const base = `${year}-${pad2(month)}-${pad2(day)} ${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  return nanos === 0
    ? base
    : `${base}.${String(nanos).padStart(NANOS_DIGIT_WIDTH, "0")}`;
}

// Reads one column's own binary field: the shared 1-byte present-flag, then (if present) the type-specific payload — mirrors org.hsqldb.rowio.RowInputBase.readData()'s per-column dispatch exactly, one SQL type code at a time. BIGINT converts through a bigint and is only cast to a JS number at the very end via Number(): a BIGINT value beyond Number.MAX_SAFE_INTEGER loses precision doing this, the same class of limitation every 'number'-kind ContentCellValue in this package already has (DECIMAL/NUMERIC included) — see the README's Gotchas entry. TIMESTAMP maps onto ContentCellValue's 'date' kind, matching src/hsqldb/script.ts's own Tier 1 TIMESTAMP-literal handling: ContentCellValue has no timestamp kind of its own.
export function readHsqldbColumnValue(
  cursor: HsqldbDataCursor,
  typeCode: number,
  options?: HsqldbDecodeOptions,
): ContentCellValue {
  const presentFlag = cursor.readUint8();
  if (presentFlag === 0) {
    return { kind: "empty" };
  }
  switch (typeCode) {
    case SQL_CHAR:
    case SQL_VARCHAR:
    case SQL_LONGVARCHAR:
    case SQL_VARCHAR_IGNORECASE: {
      const byteLength = cursor.readInt32();
      return {
        kind: "string",
        value: readModifiedUtf8(cursor.readBytes(byteLength)),
      };
    }
    case SQL_SMALLINT:
    case SQL_TINYINT: // also read as a 2-byte short, not 1 byte — RowInputBase.readData routes both to readSmallint()
      return { kind: "number", value: cursor.readInt16() };
    case SQL_INTEGER:
      return { kind: "number", value: cursor.readInt32() };
    case SQL_BIGINT:
      return numericCellValue(cursor.readBigInt64(), 0);
    case SQL_FLOAT:
    case SQL_REAL:
    case SQL_DOUBLE: // all three read as an 8-byte IEEE754 double, per RowInputBinary.readReal
      return { kind: "number", value: cursor.readFloat64() };
    case SQL_NUMERIC:
    case SQL_DECIMAL: {
      const byteLength = cursor.readInt32();
      const magnitudeBytes = cursor.readBytes(byteLength);
      const scale = cursor.readInt32();
      return numericCellValue(signedBigIntFromBytes(magnitudeBytes), scale);
    }
    case SQL_BOOLEAN_BIT:
      return { kind: "boolean", value: cursor.readUint8() !== 0 };
    case SQL_DATE:
      return {
        kind: "date",
        value: formatDate(cursor.readBigInt64(), options?.timeZone),
      };
    case SQL_TIME:
      return {
        kind: "time",
        value: formatTime(cursor.readBigInt64(), options?.timeZone),
      };
    case SQL_TIMESTAMP: {
      const millis = cursor.readBigInt64();
      const nanos = cursor.readInt32();
      return {
        kind: "date",
        value: formatTimestamp(millis, nanos, options?.timeZone),
      };
    }
    default:
      throw new HsqldbRowFormatError(
        `unsupported SQL type code ${typeCode} while decoding a row value`,
      );
  }
}
