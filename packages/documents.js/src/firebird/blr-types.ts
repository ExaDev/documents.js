// Firebird's BLR type opcodes (the raw integer a gbak backup's own att_field_type attribute carries, taken directly from field->fld_type -- see restore.epp's get_field: `case att_field_type: field->fld_type = (USHORT) get_int32(tdgbl); break;`) and the table that maps each opcode onto its underlying PHYSICAL storage representation (dtype). Both sourced directly from Firebird's own open-source engine, not guessed: opcode values from src/include/firebird/impl/blr.h (via src/jrd/align.h's own comments, which restate each value next to its dtype mapping), and the mapping table itself is align.h's own `gds_cvt_blr_dtype` array, transcribed verbatim -- see this package's README Gotchas entry on .odb Tier 3 for the exact commit/URL this was pulled from. Only the opcodes a Firebird-embedded LibreOffice .odb can plausibly emit for an ordinary user table are named here (the ones this reader's own real fixture was built to exercise, plus their neighbours in the same table); an opcode with no FirebirdPhysicalType mapping throws rather than silently guessing.

export const BLR_SHORT = 7;
export const BLR_LONG = 8;
export const BLR_QUAD = 9;
export const BLR_FLOAT = 10;
export const BLR_D_FLOAT = 11;
export const BLR_SQL_DATE = 12;
export const BLR_SQL_TIME = 13;
export const BLR_TEXT = 14;
export const BLR_TEXT2 = 15;
export const BLR_INT64 = 16;
export const BLR_BOOL = 23;
export const BLR_DEC64 = 24;
export const BLR_DEC128 = 25;
export const BLR_INT128 = 26;
export const BLR_DOUBLE = 27;
export const BLR_SQL_TIME_TZ = 28;
export const BLR_TIMESTAMP_TZ = 29;
export const BLR_EX_TIME_TZ = 30;
export const BLR_EX_TIMESTAMP_TZ = 31;
export const BLR_TIMESTAMP = 35;
export const BLR_VARYING = 37;
export const BLR_VARYING2 = 38;
export const BLR_CSTRING = 40;
export const BLR_CSTRING2 = 41;
export const BLR_BLOB = 261;

export type FirebirdPhysicalType =
  | "short"
  | "long"
  | "int64"
  | "real"
  | "double"
  | "sql_date"
  | "sql_time"
  | "timestamp"
  | "text"
  | "varying"
  | "cstring"
  | "boolean"
  | "blob"
  | "quad"
  // Genuinely supported by src/firebird/reader.ts's XdrReader (readInt64) but not yet interpreted into a ContentCellValue by src/firebird/data.ts -- an int128-precision NUMERIC/DECIMAL (FB4+ only; this reader's own real fixture targets a Firebird 3.0-era embedded engine, which has no int128/dec64/dec128 type at all) or a genuine DECFLOAT column. See the README's .odb Tier 3 Gotchas entry.
  | "int128"
  | "dec64"
  | "dec128"
  | "unsupported-tz";

// align.h's own gds_cvt_blr_dtype[DTYPE_BLR_MAX + 1] array, restated as a lookup by BLR opcode. A 0 entry in the real table (an opcode that is not itself a datatype BLR, e.g. blr_word/blr_octets-adjacent slots never used for a column's own field type) has no FirebirdPhysicalType mapping here and falls through to decodeBlrType's own throw.
const BLR_TO_PHYSICAL_TYPE = new Map<number, FirebirdPhysicalType>([
  [BLR_SHORT, "short"],
  [BLR_LONG, "long"],
  [BLR_QUAD, "quad"],
  [BLR_FLOAT, "real"],
  [BLR_D_FLOAT, "double"],
  [BLR_SQL_DATE, "sql_date"],
  [BLR_SQL_TIME, "sql_time"],
  [BLR_TEXT, "text"],
  [BLR_TEXT2, "text"],
  [BLR_INT64, "int64"],
  [BLR_BOOL, "boolean"],
  [BLR_DEC64, "dec64"],
  [BLR_DEC128, "dec128"],
  [BLR_INT128, "int128"],
  [BLR_DOUBLE, "double"],
  [BLR_SQL_TIME_TZ, "unsupported-tz"],
  [BLR_TIMESTAMP_TZ, "unsupported-tz"],
  [BLR_EX_TIME_TZ, "unsupported-tz"],
  [BLR_EX_TIMESTAMP_TZ, "unsupported-tz"],
  [BLR_TIMESTAMP, "timestamp"],
  [BLR_VARYING, "varying"],
  [BLR_VARYING2, "varying"],
  [BLR_CSTRING, "cstring"],
  [BLR_CSTRING2, "cstring"],
  [BLR_BLOB, "blob"],
]);

export class FirebirdUnsupportedFieldTypeError extends Error {
  readonly blrType: number;

  constructor(blrType: number) {
    super(
      `Firebird backup: field has BLR type ${blrType}, which is not a recognised column datatype opcode for a Firebird-embedded .odb's own user/system tables`,
    );
    this.name = "FirebirdUnsupportedFieldTypeError";
    this.blrType = blrType;
  }
}

export function decodeBlrType(blrType: number): FirebirdPhysicalType {
  const physical = BLR_TO_PHYSICAL_TYPE.get(blrType);
  if (physical === undefined) {
    throw new FirebirdUnsupportedFieldTypeError(blrType);
  }
  return physical;
}

// A human-readable SQL-shaped type label for HsqldbColumn.type -- see that field's own doc comment: "kept whole rather than parsed into a structured type ... nothing here models SQL constraints". Synthesised from the field's own binary metadata (BLR type + length + scale + sub-type) rather than lifted verbatim from source SQL text (there IS no source SQL text in a gbak backup -- see the README's .odb Tier 3 Gotchas entry), but serves the identical purpose: a readable label, not a re-parseable declaration. scale is Firebird's own convention: 0 or negative, where the field's underlying integer value is multiplied by 10^scale to get the true numeric value (a DECIMAL(10,2) column carries scale -2).
export function describeFieldType(
  physical: FirebirdPhysicalType,
  lengthBytes: number,
  scale: number,
  characterLength: number | undefined,
  subType: number,
): string {
  switch (physical) {
    case "short":
      return scale === 0 ? "SMALLINT" : `NUMERIC(4,${-scale})`;
    case "long":
      return scale === 0 ? "INTEGER" : `NUMERIC(9,${-scale})`;
    case "int64":
      return scale === 0 ? "BIGINT" : `NUMERIC(18,${-scale})`;
    case "real":
      return "FLOAT";
    case "double":
      return "DOUBLE PRECISION";
    case "sql_date":
      return "DATE";
    case "sql_time":
      return "TIME";
    case "timestamp":
      return "TIMESTAMP";
    case "text":
      return `CHAR(${characterLength ?? lengthBytes})`;
    case "varying":
      return `VARCHAR(${characterLength ?? lengthBytes})`;
    case "cstring":
      return `CSTRING(${characterLength ?? lengthBytes})`;
    case "boolean":
      return "BOOLEAN";
    case "blob":
      // A blob's own sub-type is part of its declared type in real Firebird DDL (`BLOB SUB_TYPE 1` is a text blob, `SUB_TYPE 0` a binary one), and is what decides how src/firebird/data.ts records the recovered content -- so it belongs in the label rather than being flattened away.
      return `BLOB SUB_TYPE ${subType}`;
    case "quad":
      return "ARRAY";
    case "int128":
      return `NUMERIC(38,${-scale})`;
    case "dec64":
      return "DECFLOAT(16)";
    case "dec128":
      return "DECFLOAT(34)";
    case "unsupported-tz":
      return "TIMESTAMP/TIME WITH TIME ZONE";
  }
}
