import type { FirebirdBackupReader } from "./reader";
import { decodeBlrType, describeFieldType } from "./blr-types";
import type { FirebirdPhysicalType } from "./blr-types";

// rec_relation (schema: table name + column definitions) parsing, matching Firebird's own restore.epp get_relation/get_field shape exactly -- see this reader's own README-FORMAT.md note and the burp.h grammar comment: `<rec_relation> <rel name> <att_end> <local fields> <view> <rec_relation_end>`, where each local field is `<rec_field> <att_field_...> <att_end>`. This module produces the SCHEMA only -- see data.ts for the separate rec_relation_data (row) records that reference a relation purely by name.

// rec_type values this module's own top-level walk (backup.ts) needs to recognise while inside a rec_relation's own field loop -- restated here (not imported from a shared enum) since only these three matter to schema parsing; backup.ts owns the authoritative, complete rec_type table for its own top-level dispatch.
const REC_FIELD = 4;
const REC_RELATION_END = 9;

export interface FirebirdField {
  readonly name: string;
  readonly physicalType: FirebirdPhysicalType;
  // Raw on-the-wire byte length (att_field_length) -- for 'text'/'varying'/'cstring' this is the byte capacity (already character-set-multiplier-adjusted by the engine itself, so no charset-aware recomputation is needed here); for every fixed-size numeric/date/time/boolean kind it is redundant with the type's own known width and kept only for completeness.
  readonly lengthBytes: number;
  // Firebird's own convention: 0 or negative; the field's underlying stored integer is multiplied by 10^scale to recover the true value. Only meaningful for 'short'/'long'/'int64'/'int128' (a DECIMAL/NUMERIC column); 0 for every other physical type.
  readonly scale: number;
  readonly characterLength: number | undefined;
  // att_field_sub_type. Only interpreted for a BLOB column, where Firebird's own convention is 0 = binary and 1 = text -- which is what decides whether src/firebird/data.ts records a recovered blob's bytes as decoded text or as a base64 data URI. 0 for every other physical type.
  readonly subType: number;
  // att_field_number -- burp.h's own comment for it is literally "Field number to match up blobs", and it is the value a rec_blob record's own att_blob_field_number carries (backup.epp's put_blob: `put_int32(att_blob_field_number, field->fld_number)`). Deliberately NOT the field's position in the relation (that is att_field_position, a separate attribute this reader has no use for) and NOT its index in this record's own field sequence -- the two coincide in some real files and differ in others, which is exactly why this is read rather than inferred.
  readonly fieldNumber: number | undefined;
  readonly typeLabel: string;
  // True for a computed (non-stored) column -- gbak's own put_data explicitly skips these when writing row data (backup.epp: `if (field->fld_flags & FLD_computed) continue;`), so a row's own field-value sequence never includes one. Kept on the field record purely so data.ts's row decoder can apply gbak's identical skip rule when walking the same field list.
  readonly computed: boolean;
}

export interface FirebirdRelation {
  readonly name: string;
  readonly fields: readonly FirebirdField[];
}

export class FirebirdSchemaParseError extends Error {
  constructor(message: string) {
    super(`Firebird backup schema parse error: ${message}`);
    this.name = "FirebirdSchemaParseError";
  }
}

// att_type values relevant to a rec_relation's own attribute list (att_relation_name and the handful of others this reader cares about -- attributes outside this set are skipped generically via reader.skipAttributeValue()).
const ATT_RELATION_NAME = 1;

// att_type values relevant to a rec_field's own attribute list (restore.epp's get_field switch, restricted to the subset this reader interprets). Indices recounted directly against burp.h's own field-attribute enum block (att_field_name=SERIES=1 through att_field_schema_name=48) rather than trusted from a first-pass read -- att_field_type is 8 (att_field_sub_type, not att_field_type, is 9), att_field_computed_flag is 23 (att_field_number is 22), att_field_character_length is 41 (att_field_character_set, not character_length, is 42): three genuine off-by-one mistakes this reader's own construction caught and fixed before ever touching a real fixture.
const ATT_FIELD_NAME = 1;
const ATT_FIELD_TYPE = 8;
// att_field_sub_type: for a BLOB column, 0 = binary and 1 = text, which is what decides how src/firebird/data.ts records a recovered blob's own bytes. Still not interpreted for anything else (NUMERIC/DECIMAL-vs-plain disambiguation would use it too, but typeLabel already derives that from scale).
const ATT_FIELD_SUB_TYPE = 9;
const ATT_FIELD_LENGTH = 10;
const ATT_FIELD_SCALE = 11;
// burp.h: "Field number to match up blobs" -- see FirebirdField.fieldNumber.
const ATT_FIELD_NUMBER = 22;
const ATT_FIELD_COMPUTED_FLAG = 23;
const ATT_FIELD_CHARACTER_LENGTH = 41;

// Reads one rec_field's own attribute list (tag already consumed by the caller) up to and including its terminating att_end.
function readField(reader: FirebirdBackupReader): FirebirdField {
  let name: string | undefined;
  let blrType: number | undefined;
  let lengthBytes = 0;
  let scale = 0;
  let characterLength: number | undefined;
  let subType = 0;
  let fieldNumber: number | undefined;
  let computed = false;

  for (;;) {
    const attribute = reader.readTag();
    if (attribute === 0) {
      break;
    }
    switch (attribute) {
      case ATT_FIELD_NAME:
        name = reader.readTextAttribute();
        break;
      case ATT_FIELD_TYPE:
        blrType = reader.readInt32Attribute();
        break;
      case ATT_FIELD_SUB_TYPE:
        subType = reader.readInt32Attribute();
        break;
      case ATT_FIELD_LENGTH:
        lengthBytes = reader.readInt32Attribute();
        break;
      case ATT_FIELD_NUMBER:
        fieldNumber = reader.readInt32Attribute();
        break;
      case ATT_FIELD_SCALE:
        scale = reader.readInt32Attribute();
        break;
      case ATT_FIELD_CHARACTER_LENGTH:
        characterLength = reader.readInt32Attribute();
        break;
      case ATT_FIELD_COMPUTED_FLAG:
        computed = reader.readInt32Attribute() !== 0;
        break;
      default:
        reader.skipAttributeValue();
        break;
    }
  }

  if (name === undefined) {
    throw new FirebirdSchemaParseError(
      "a rec_field record had no att_field_name attribute",
    );
  }
  if (blrType === undefined) {
    throw new FirebirdSchemaParseError(
      `field "${name}" had no att_field_type attribute`,
    );
  }

  const physicalType = decodeBlrType(blrType);
  const typeLabel = describeFieldType(
    physicalType,
    lengthBytes,
    scale,
    characterLength,
    subType,
  );
  return {
    name,
    physicalType,
    lengthBytes,
    scale,
    characterLength,
    subType,
    fieldNumber,
    typeLabel,
    computed,
  };
}

// Reads one rec_relation's own attribute list, then loops over its nested rec_field records until rec_relation_end (the tag itself already consumed by the caller). Throws FirebirdCompositeRecordUnsupportedError (via the caller-supplied onUnhandledNested callback) for a rec_view child -- a view has no rows of its own to back up and this reader has not verified its own attribute shape against a real fixture; see the README's .odb Tier 3 Gotchas entry.
export function readRelationSchema(
  reader: FirebirdBackupReader,
  onUnhandledNested: (recordType: number) => never,
): FirebirdRelation {
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
    throw new FirebirdSchemaParseError(
      "a rec_relation record had no att_relation_name attribute",
    );
  }

  const fields: FirebirdField[] = [];
  for (;;) {
    const recordType = reader.readTag();
    if (recordType === REC_RELATION_END) {
      break;
    }
    if (recordType === REC_FIELD) {
      fields.push(readField(reader));
      continue;
    }
    onUnhandledNested(recordType);
  }

  return { name, fields };
}
