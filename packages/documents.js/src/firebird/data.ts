import type { ContentCellValue } from "document-schema.js";
import type { FirebirdBackupReader } from "./reader";
import { XdrReader } from "./reader";
import type { FirebirdField, FirebirdRelation } from "./schema";
import {
  formatFirebirdDate,
  formatFirebirdTime,
  formatFirebirdTimestamp,
} from "./date";

// rec_relation_data (row data) parsing -- see the burp.h grammar comment: `<rec_relation_data> <rel attributes> <gen id> <indices> <data> <trigger-old> <rec_relation_end>`, where a relation's own rows are addressed purely by NAME (att_relation_name), resolved against the FirebirdRelation schema map schema.ts already built from the earlier, separate rec_relation pass. Row VALUES only ever arrive here as a `rec_data` record's own att_data_data payload, and only when the whole backup's own att_backup_transportable attribute is TRUE (confirmed true in every real fixture this reader was built against) -- see canonical.cpp's CAN_encode_decode, the exact per-SQL-type XDR shape this module's decodeRowValues mirrors field-for-field.

// rec_type values this module's own row-group loop needs to recognise (restated locally -- see schema.ts's identical note on why these aren't a shared enum import).
const REC_DATA = 6;
const REC_BLOB = 7;
const REC_RELATION_END = 9;
const REC_GEN_ID = 18;
const REC_INDEX = 5;
const REC_TRIGGER = 13;

// att_type values relevant to a rec_relation_data record's own attribute list.
const ATT_RELATION_NAME = 1;

// att_type values inside a single row's own rec_data record.
const ATT_DATA_LENGTH = 1;
const ATT_DATA_DATA = 2;
// att_xdr_length shares the same numeric value the attribute table assigns it (SERIES + 16, see burp.h) -- restated directly rather than derived, since this module only ever needs the one constant.
const ATT_XDR_LENGTH = 17;

export class FirebirdDataParseError extends Error {
  constructor(message: string) {
    super(`Firebird backup data parse error: ${message}`);
    this.name = "FirebirdDataParseError";
  }
}

export class FirebirdCompositeRecordUnsupportedError extends Error {
  readonly recordType: number;

  constructor(recordType: number, context: string) {
    super(
      `Firebird backup: encountered record type ${recordType} while ${context}, which this reader's own bounded implementation does not know how to skip safely (its own attribute/sub-record shape has not been verified against a real fixture) -- refusing to guess rather than risk silently desynchronising the rest of the stream`,
    );
    this.name = "FirebirdCompositeRecordUnsupportedError";
    this.recordType = recordType;
  }
}

interface FirebirdBlob {
  // att_blob_field_number: the value of the owning field's own att_field_number (burp.h names that attribute "Field number to match up blobs"), NOT the field's position in the relation and NOT its index in the rec_field sequence -- see FirebirdField.fieldNumber.
  readonly fieldNumber: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

// Reads one blob record in full (rec_blob tag already consumed by the caller), concatenating every segment of its content. The record's exact shape is backup.epp's own put_blob, confirmed byte-for-byte against a real LibreOffice-generated blob-bearing fixture: `rec_blob att_blob_field_number <int32> att_blob_max_segment <int32> att_blob_number_segments <int32> att_blob_type <int32> att_blob_data (<2-byte little-endian segment length> <that many raw bytes>)*`.
//
// Two things about that shape are load-bearing and were BOTH got wrong by this module's first implementation, which is why a blob-bearing .odb previously failed outright rather than merely losing its blob content. (1) There is NO att_end terminator: put_blob returns straight after its last segment, and restore.epp's own get_blob correspondingly reads attributes only until it sees att_blob_data (`while (get_attribute(&attribute, tdgbl) != att_blob_data)`), never looking for att_end. Reading on past the segments therefore consumed the NEXT record's own tag as an attribute and desynchronised the whole stream. (2) A NULL blob writes no rec_blob record at all ("If the blob is null, don't store it. It will be restored as null." -- put_blob's own comment), so a field with no matching record here is genuinely null, not missing data.
//
// A third thing is worth stating explicitly because it is a genuine asymmetry rather than an omission: a blob's own segments are ALWAYS raw, never RLE-compressed, even when the whole backup sets att_backup_compress (as every real fixture this reader was built against does). backup.epp calls its own compress() at exactly one site -- put_data's row payload, guarded by `if (tdgbl->gbl_sw_compress) compress(p, record_length);` -- while put_blob writes every segment through plain put_block with no such guard anywhere in it. Hence readRawPayload below rather than the readCompressedPayload readRowGroup uses for the row itself; the blob fixture's own 256-byte 0x00..0xFF payload is what proves it empirically, since any compression assumption either way would corrupt those exact bytes and desynchronise the records after them.
function readBlobRecord(reader: FirebirdBackupReader): FirebirdBlob {
  // Blob-record attributes (burp.h): att_blob_field_number = SERIES+2 = 3, att_blob_type = 4, att_blob_number_segments = 5, att_blob_max_segment = 6, att_blob_data = 7 (a bare tag with no length prefix -- see reader.ts's own top-of-file note).
  const ATT_BLOB_FIELD_NUMBER = 3;
  const ATT_BLOB_NUMBER_SEGMENTS = 5;
  const ATT_BLOB_DATA = 7;

  let fieldNumber: number | undefined;
  let segmentCount = 0;
  for (;;) {
    const attribute = reader.readTag();
    if (attribute === ATT_BLOB_DATA) {
      break;
    }
    if (attribute === ATT_BLOB_FIELD_NUMBER) {
      fieldNumber = reader.readInt32Attribute();
    } else if (attribute === ATT_BLOB_NUMBER_SEGMENTS) {
      segmentCount = reader.readInt32Attribute();
    } else {
      reader.skipAttributeValue();
    }
  }
  if (fieldNumber === undefined) {
    throw new FirebirdDataParseError(
      "a rec_blob record had no att_blob_field_number attribute, so its content cannot be attributed to a column",
    );
  }

  const segments: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;
  for (let i = 0; i < segmentCount; i++) {
    const length = reader.readBlobSegmentLength();
    const segment = reader.readRawPayload(length);
    segments.push(segment);
    total += segment.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const segment of segments) {
    bytes.set(segment, offset);
    offset += segment.length;
  }
  return { fieldNumber, bytes };
}

// document-schema.js's ContentCellValue union has no binary kind at all (number/percentage/currency/boolean/date/time/dateTime/string/error/empty), so a recovered blob has to arrive as one of those or not at all. A TEXT blob (Firebird's own att_field_sub_type 1) is genuinely text and becomes an ordinary string, decoded as UTF-8 -- the same assumption every other character-typed column in this module already makes, and the charset a LibreOffice-created embedded Firebird database actually declares. A BINARY blob (any other sub-type) has no honest plain-string reading, so it becomes a base64 `data:` URI: self-describing, standard, losslessly decodable, and distinguishable from a string a column could genuinely have held, rather than a bare base64 run that would be indistinguishable from real text. This is a real, tracked schema gap rather than a decoding limit -- the bytes are fully recovered either way; what is missing is a `ContentCellValue` variant able to say "these are bytes", which belongs in document-schema.js rather than being invented here.
const BINARY_BLOB_DATA_URI_PREFIX = "data:application/octet-stream;base64,";
const BLOB_SUB_TYPE_TEXT = 1;
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// Standard RFC 4648 base64, hand-rolled rather than reached for from odf.js's own bytesToBase64: src/firebird/ deliberately imports nothing but document-schema.js's ContentCellValue type and src/hsqldb's own table shape (see this package's README on that isolation), and a dozen lines of alphabet indexing is a smaller price than making a byte-level backup-format decoder depend on an ODF package.
function bytesToBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);
    result += BASE64_ALPHABET[(triple >> 18) & 0x3f] ?? "";
    result += BASE64_ALPHABET[(triple >> 12) & 0x3f] ?? "";
    result +=
      b1 === undefined ? "=" : (BASE64_ALPHABET[(triple >> 6) & 0x3f] ?? "");
    result += b2 === undefined ? "=" : (BASE64_ALPHABET[triple & 0x3f] ?? "");
  }
  return result;
}

function blobCellValue(
  field: FirebirdField,
  bytes: Uint8Array<ArrayBuffer>,
): ContentCellValue {
  if (field.subType === BLOB_SUB_TYPE_TEXT) {
    return { kind: "string", value: new TextDecoder("utf-8").decode(bytes) };
  }
  return {
    kind: "string",
    value: `${BINARY_BLOB_DATA_URI_PREFIX}${bytesToBase64(bytes)}`,
  };
}

// Decodes exactly one row's own XDR-encoded field-value sequence (canonical.cpp's CAN_encode_decode, direction=DECODE) into ContentCellValue[], one entry per NON-computed field in the relation's own declared order -- matching gbak's own put_data field loop (`if (field->fld_flags & FLD_computed) continue;`). Trailing null-flag shorts (one per non-computed field, same order) are read immediately after every field value per canonical.cpp's own two-pass shape ("Next, get null flags") and applied retroactively: a non-zero null flag replaces whatever value was just decoded with ContentCellValue's 'empty' kind, mirroring src/hsqldb/script.ts's own NULL handling.
function storedFieldsOf(
  fields: readonly FirebirdField[],
): readonly FirebirdField[] {
  return fields.filter((field) => !field.computed);
}

// unscaled * 10^-decimalScale as an exact, arbitrary-precision decimal digit string, built via BigInt digit manipulation rather than the floating multiplication (`raw * 10 ** field.scale`) this module's own first implementation used -- that multiplication is exactly the kind of rounding-prone arithmetic this function exists to avoid for a large stored integer. Mirrors src/hsqldb/rowformat.ts's own identically-named-in-spirit helper, restated locally rather than imported: src/firebird/ deliberately carries no value-level dependency on src/hsqldb (only a type-only one, for HsqldbTable/HsqldbColumn -- see this package's README on that isolation), and this is a self-contained handful of lines, the same "duplicate a small port-level helper rather than couple two independent decoder tiers" call this package already makes for throwIfAborted.
function exactDecimalDigits(unscaled: bigint, decimalScale: number): string {
  const isNegative = unscaled < 0n;
  const magnitudeDigits = (isNegative ? -unscaled : unscaled).toString();
  const sign = isNegative ? "-" : "";
  if (decimalScale <= 0) {
    return `${sign}${magnitudeDigits}${"0".repeat(-decimalScale)}`;
  }
  const padded = magnitudeDigits.padStart(decimalScale + 1, "0");
  const wholePart = padded.slice(0, padded.length - decimalScale);
  const fractionPart = padded.slice(padded.length - decimalScale);
  return `${sign}${wholePart}.${fractionPart}`;
}

// Strips trailing zeros from a decimal digit string's own fractional part (and the decimal point itself, once the fraction is fully consumed) -- see src/hsqldb/rowformat.ts's identical helper for the full reasoning: a fixed-scale value like "250.00" carries no more precision than "250", so without this normalisation an ordinary whole-number-valued DECIMAL/NUMERIC column (the BONUS/BUDGET fixtures this module's own tests already cover both have one) would spuriously gain an exactValue sidecar even though Number() already represents it exactly.
function trimTrailingFractionZeros(digits: string): string {
  if (!digits.includes(".")) {
    return digits;
  }
  const trimmed = digits.replace(/0+$/, "");
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

// A 'number'-kind ContentCellValue for a 'short'/'long'/'int64' field's own exact stored-integer-plus-scale value (field.scale is Firebird's own convention, 0 or negative -- see FirebirdField.scale -- so decimalScale here is its negation, matching the "positive scale = digits after the decimal point" convention src/hsqldb/rowformat.ts's own sidecar helper uses). Attaches document-schema.js's own exactValue sidecar (ContentCellValueSchema's own doc comment: "a producer should only set it when String(Number(exactValue)) would not round-trip back to exactValue exactly") only when the double approximation genuinely loses information -- absent for the overwhelming majority of real BIGINT/DECIMAL/NUMERIC cells, present with the real, full-precision decimal string for an int64 (BIGINT-equivalent) value beyond Number.MAX_SAFE_INTEGER or a scaled DECIMAL/NUMERIC value with more significant digits than a double can carry.
function numericCellValue(
  unscaled: bigint,
  decimalScale: number,
): ContentCellValue {
  const exact = trimTrailingFractionZeros(
    exactDecimalDigits(unscaled, decimalScale),
  );
  const value = Number(exact);
  return String(value) === exact
    ? { kind: "number", value }
    : { kind: "number", value, exactValue: exact };
}

export function decodeRowValues(
  fields: readonly FirebirdField[],
  payload: Uint8Array<ArrayBuffer>,
): ContentCellValue[] {
  const storedFields = storedFieldsOf(fields);
  const xdr = new XdrReader(payload);
  const rawValues: (ContentCellValue | undefined)[] = [];

  for (const field of storedFields) {
    switch (field.physicalType) {
      case "short":
        rawValues.push(numericCellValue(BigInt(xdr.readInt16()), -field.scale));
        break;
      case "long":
        rawValues.push(numericCellValue(BigInt(xdr.readInt32()), -field.scale));
        break;
      case "int64":
        rawValues.push(numericCellValue(xdr.readInt64(), -field.scale));
        break;
      case "real":
        rawValues.push({ kind: "number", value: xdr.readFloat() });
        break;
      case "double":
        rawValues.push({ kind: "number", value: xdr.readDouble() });
        break;
      case "sql_date": {
        const days = xdr.readInt32();
        rawValues.push({ kind: "date", value: formatFirebirdDate(days) });
        break;
      }
      case "sql_time": {
        const ticks = xdr.readInt32() >>> 0;
        rawValues.push({ kind: "time", value: formatFirebirdTime(ticks) });
        break;
      }
      case "timestamp": {
        const days = xdr.readInt32();
        const ticks = xdr.readInt32() >>> 0;
        rawValues.push({
          kind: "date",
          value: formatFirebirdTimestamp(days, ticks),
        });
        break;
      }
      case "text": {
        const bytes = xdr.readOpaque(field.lengthBytes);
        rawValues.push({
          kind: "string",
          value: new TextDecoder("utf-8").decode(bytes).replace(/\s+$/, ""),
        });
        break;
      }
      case "varying": {
        const stringLength = xdr.readInt16();
        const bytes = xdr.readOpaque(stringLength);
        rawValues.push({
          kind: "string",
          value: new TextDecoder("utf-8").decode(bytes),
        });
        break;
      }
      case "cstring": {
        const stringLength = xdr.readInt16();
        const bytes = xdr.readOpaque(stringLength);
        rawValues.push({
          kind: "string",
          value: new TextDecoder("utf-8").decode(bytes),
        });
        break;
      }
      case "boolean": {
        const bytes = xdr.readOpaque(field.lengthBytes);
        rawValues.push({ kind: "boolean", value: (bytes[0] ?? 0) !== 0 });
        break;
      }
      case "blob":
        // The blob's own quad (two 32-bit halves: a blob ID, not its content) still occupies the row's own fixed field slot and must be consumed to keep the XDR cursor aligned with every field after it. The CONTENT lives in the separate rec_blob records that follow this row -- readRowGroup below reads them and overwrites this placeholder for every field one arrives for; a field with no rec_blob of its own is genuinely null (put_blob writes nothing at all for a null blob) and correctly keeps this value.
        xdr.readInt32();
        xdr.readInt32();
        rawValues.push({ kind: "empty" });
        break;
      case "quad":
        // An ARRAY-typed column's own blob-id quad -- same reasoning as 'blob' above: consumed for alignment, never decoded.
        xdr.readInt32();
        xdr.readInt32();
        rawValues.push({ kind: "empty" });
        break;
      case "int128":
      case "dec64":
      case "dec128":
      case "unsupported-tz":
        throw new FirebirdDataParseError(
          `column "${field.name}" has physical type "${field.physicalType}", which this reader's own bounded implementation does not decode (FB4+-only types not exercised by this reader's Firebird 3.0-era real fixture) -- see the README's .odb Tier 3 Fidelity note`,
        );
    }
  }

  // Trailing null-flag pass: one XDR short per non-computed field, same declared order, immediately after every field value (canonical.cpp's own second loop). A non-zero flag means the field is NULL -- Firebird's own sqlind convention (-1 for null, 0 for a real value), though this reader treats ANY non-zero flag as null rather than asserting the exact -1 sentinel, matching restore.epp's own equally permissive `xdr_short` read-back.
  for (let i = 0; i < storedFields.length; i++) {
    const nullFlag = xdr.readInt16();
    if (nullFlag !== 0) {
      rawValues[i] = { kind: "empty" };
    }
  }

  return rawValues.map((value) => value ?? { kind: "empty" });
}

// Reads one rec_data record's own row-group (the tag itself already consumed by the caller) -- one-or-more consecutive rows, each shaped `att_data_length <int32> [att_xdr_length <int32>] att_data_data <bytes -- raw or RLE-compressed, see reader.ts's own Encoding 3 note> (rec_blob)*`, ending when the tag immediately following a row's own trailing blob records is anything other than another rec_data -- see reader.ts's own top-of-file note and this module's own top-of-file note for the full empirical derivation. Returns the decoded rows plus the record type that terminated the group (handed back to the caller, since IT owns interpreting what that terminator means: another rec_data means "resume this same loop from the top", anything else means "the row-group for this relation is over"). compressed mirrors the whole backup's own att_backup_compress flag (readBackupHeader in backup.ts) -- a per-backup, not per-row, setting.
function readRowGroup(
  reader: FirebirdBackupReader,
  relation: FirebirdRelation,
  compressed: boolean,
): { rows: ContentCellValue[][]; terminator: number } {
  const rows: ContentCellValue[][] = [];
  let terminator: number;

  for (;;) {
    const lengthTag = reader.readTag();
    if (lengthTag !== ATT_DATA_LENGTH) {
      throw new FirebirdDataParseError(
        `relation "${relation.name}": expected att_data_length (tag ${ATT_DATA_LENGTH}), found tag ${lengthTag}`,
      );
    }
    const recordLength = reader.readInt32Attribute();

    let xdrLength = recordLength;
    const maybeXdrTag = reader.readTag();
    if (maybeXdrTag === ATT_XDR_LENGTH) {
      xdrLength = reader.readInt32Attribute();
    } else if (maybeXdrTag !== ATT_DATA_DATA) {
      throw new FirebirdDataParseError(
        `relation "${relation.name}": expected att_xdr_length or att_data_data, found tag ${maybeXdrTag}`,
      );
    }

    if (maybeXdrTag !== ATT_DATA_DATA) {
      const dataTag = reader.readTag();
      if (dataTag !== ATT_DATA_DATA) {
        throw new FirebirdDataParseError(
          `relation "${relation.name}": expected att_data_data (tag ${ATT_DATA_DATA}), found tag ${dataTag}`,
        );
      }
    }

    const payload = compressed
      ? reader.readCompressedPayload(xdrLength)
      : reader.readRawPayload(xdrLength);
    const values = decodeRowValues(relation.fields, payload);
    rows.push(values);

    // Every rec_blob record between this row and the next belongs to THIS row (backup.epp's put_data writes a row's blob records immediately after the row itself), so each one's content replaces the placeholder decodeRowValues left in that column.
    let next = reader.readTag();
    while (next === REC_BLOB) {
      const blob = readBlobRecord(reader);
      const storedFields = storedFieldsOf(relation.fields);
      const columnIndex = storedFields.findIndex(
        (field) => field.fieldNumber === blob.fieldNumber,
      );
      const field = storedFields[columnIndex];
      if (field === undefined) {
        throw new FirebirdDataParseError(
          `relation "${relation.name}": a rec_blob record names att_blob_field_number ${blob.fieldNumber}, which matches no field's own att_field_number in this relation`,
        );
      }
      values[columnIndex] = blobCellValue(field, blob.bytes);
      next = reader.readTag();
    }

    if (next !== REC_DATA) {
      terminator = next;
      break;
    }
  }

  return { rows, terminator };
}

// Reads one rec_relation_data record in full (the tag itself already consumed by the caller): its own attribute list (identifying the relation by name), then the mixed record sequence the burp.h grammar comment describes (`<gen id> <indices> <data> <trigger-old> <rec_relation_end>`) -- in practice, whatever order rec_gen_id/rec_index/rec_trigger/rec_data actually appear in (this reader makes no assumption about their relative order, matching restore.epp's own get_relation_data dispatch loop). schema is a name -> FirebirdRelation map already built from the earlier, separate rec_relation pass (readRelationSchema); throws if a rec_relation_data references a name with no matching schema.
export function readRelationData(
  reader: FirebirdBackupReader,
  schema: ReadonlyMap<string, FirebirdRelation>,
  compressed: boolean,
): { relationName: string; rows: ContentCellValue[][] } {
  let name: string | undefined;

  for (;;) {
    const attribute = reader.readTag();
    if (attribute === 0) {
      break;
    }
    if (attribute === ATT_RELATION_NAME) {
      name = reader.readTextAttribute();
    } else {
      reader.skipAttributeValue();
    }
  }

  if (name === undefined) {
    throw new FirebirdDataParseError(
      "a rec_relation_data record had no att_relation_name attribute",
    );
  }
  const relation = schema.get(name);
  if (relation === undefined) {
    throw new FirebirdDataParseError(
      `rec_relation_data references relation "${name}", which no earlier rec_relation declared`,
    );
  }

  const rows: ContentCellValue[][] = [];
  let recordType = reader.readTag();
  for (;;) {
    if (recordType === REC_RELATION_END) {
      break;
    }
    if (recordType === REC_DATA) {
      const group = readRowGroup(reader, relation, compressed);
      rows.push(...group.rows);
      recordType = group.terminator;
      continue;
    }
    if (recordType === REC_GEN_ID) {
      reader.readAttributeBytes(); // a bare length-prefixed int32 value, no attribute-tag wrapper (restore.epp: `gen_id = get_int32(tdgbl);` directly, no get_attribute call first).
      recordType = reader.readTag();
      continue;
    }
    if (recordType === REC_INDEX || recordType === REC_TRIGGER) {
      // Both flat, attribute-list-only records (restore.epp's get_index/get_trigger_old) -- an index definition (segment names/uniqueness/etc, e.g. the implicit index a PRIMARY KEY constraint creates) or an old-style trigger, neither of which this reader models. Genuinely skippable: this reader has no use for either, and their own attribute vocabulary carries no table/column/row data.
      reader.skipFlatRecordAttributes();
      recordType = reader.readTag();
      continue;
    }
    throw new FirebirdCompositeRecordUnsupportedError(
      recordType,
      `reading relation data for "${name}"`,
    );
  }

  return { relationName: name, rows };
}
