import type { HsqldbColumn, HsqldbTable } from "../hsqldb/script";
import { FirebirdBackupReader } from "./reader";
import { readRelationSchema } from "./schema";
import type { FirebirdRelation } from "./schema";
import {
  readRelationData,
  FirebirdCompositeRecordUnsupportedError,
} from "./data";

// The top-level walk of a Firebird gbak backup stream (a .odb package's own database/firebird.fbk part -- see src/odb/read.ts's own top-of-file note and this reader's README-FORMAT.md for the full "this is a logical backup, not raw ODS pages" finding): rec_burp (backup program attributes) -> rec_database (skipped) -> zero-or-more rec_relation (schema) -> zero-or-more OTHER schema-adjacent records this reader does not need (rec_charset/rec_collation/rec_rel_constraint/etc., generically skipped) -> zero-or-more rec_relation_data (row data, referencing an earlier rec_relation purely by name) -> rec_end. Produces HsqldbTable[] -- the identical shape src/hsqldb/script.ts's own Tier 1 HSQLDB reader produces -- so odbTablesToSpreadsheetDocument/buildOdbTableCsv (src/odb/spreadsheet.ts, src/odb/csv.ts) work completely unchanged for a Firebird-backed .odb.

// rec_type values this module's own top-level dispatch needs (see schema.ts/data.ts's identical local-restatement convention and comment on why these aren't a shared enum import).
const REC_DATABASE = 1;
const REC_RELATION = 3;
const REC_RELATION_DATA = 8;
const REC_END = 10;
// rec_physical_db precedes rec_database in real output (confirmed against a real generated fixture) -- restore.epp's own create_database checks for it explicitly first (`if (get_record(&record, tdgbl) == rec_physical_db)`) and reads it through the SAME att_type vocabulary rec_database uses (att_page_size/att_SQL_dialect/etc share one "Database attributes" SERIES block in burp.h, covering both record kinds), so this reader treats the two identically via readDatabaseHeader rather than a separate skip path.
const REC_PHYSICAL_DB = 14;

// Flat record kinds (attribute list only, no nested records of their own) this reader has verified are safe to skip generically by reading attributes until att_end -- restore.epp's own get_rel_constraint/get_charset/get_collation/etc. each follow exactly this shape. A record kind NOT in this set that isn't rec_relation/rec_relation_data/rec_database/rec_end throws FirebirdCompositeRecordUnsupportedError rather than being guessed at -- see that error's own doc comment.
const FLAT_SKIPPABLE_RECORD_TYPES = new Set([
  2, // rec_global_field
  24, // rec_field_dimensions
  31, // rec_rel_constraint
  32, // rec_ref_constraint
  33, // rec_chk_constraint
  34, // rec_charset
  35, // rec_collation
  19, // rec_system_type
  20, // rec_filter (NOTE: shares no relationship with att_backup_... numbering -- rec_type and att_type are independent enumerations)
  26, // rec_generator
  12, // rec_security_class
  25, // rec_files
  36, // rec_sql_roles
  37, // rec_mapping
  39, // rec_db_creator
  21, // rec_trigger_message
  22, // rec_user_privilege
  40, // rec_publication
  41, // rec_pub_table
  42, // rec_schema
  43, // rec_constants
]);

export class FirebirdBackupFormatError extends Error {
  constructor(message: string) {
    super(`Firebird backup: ${message}`);
    this.name = "FirebirdBackupFormatError";
  }
}

export interface FirebirdBackupSummary {
  readonly backupFormatVersion: number;
  readonly transportable: boolean;
  readonly compressed: boolean;
  readonly pageSizeBytes: number | undefined;
}

// att_type values inside rec_burp's own attribute list this reader interprets (see this module's own README-FORMAT.md derivation).
const ATT_BACKUP_FORMAT = 2;
const ATT_BACKUP_COMPRESS = 4;
const ATT_BACKUP_TRANSPORTABLE = 5;

// att_page_size lives inside rec_database's own attribute list (a SEPARATE SERIES reset from rec_burp's), value 5 -- see this module's own README-FORMAT.md derivation.
const ATT_PAGE_SIZE = 5;

function readBurpHeader(reader: FirebirdBackupReader): {
  backupFormatVersion: number;
  transportable: boolean;
  compressed: boolean;
} {
  let backupFormatVersion: number | undefined;
  let transportable = false;
  let compressed = false;

  for (;;) {
    const attribute = reader.readTag();
    if (attribute === 0) {
      break;
    }
    switch (attribute) {
      case ATT_BACKUP_FORMAT:
        backupFormatVersion = reader.readInt32Attribute();
        break;
      case ATT_BACKUP_TRANSPORTABLE:
        // Written via mvol.cpp's write_header as put_numeric(att_backup_transportable, 1) -- a 4-byte int32, always literally 1, and ONLY EVER WRITTEN AT ALL when tdgbl->gbl_sw_transportable is true (`if (tdgbl->gbl_sw_transportable) put_numeric(...)`). This attribute's own PRESENCE is the true/false signal, not a boolean value encoding -- confirmed against a real generated fixture, which caught this reader's own first-pass assumption (readBooleanAttribute, a 1-byte value) as wrong: the real wire length is 4, not 1.
        transportable = reader.readInt32Attribute() !== 0;
        break;
      case ATT_BACKUP_COMPRESS:
        // Same presence-based encoding as att_backup_transportable immediately above -- see that case's own comment.
        compressed = reader.readInt32Attribute() !== 0;
        break;
      default:
        reader.skipAttributeValue();
        break;
    }
  }

  if (backupFormatVersion === undefined) {
    throw new FirebirdBackupFormatError(
      "the leading rec_burp record had no att_backup_format attribute -- not a recognisable gbak backup stream",
    );
  }
  return { backupFormatVersion, transportable, compressed };
}

function readDatabaseHeader(reader: FirebirdBackupReader): {
  pageSizeBytes: number | undefined;
} {
  let pageSizeBytes: number | undefined;
  for (;;) {
    const attribute = reader.readTag();
    if (attribute === 0) {
      break;
    }
    if (attribute === ATT_PAGE_SIZE) {
      pageSizeBytes = reader.readInt32Attribute();
    } else {
      reader.skipAttributeValue();
    }
  }
  return { pageSizeBytes };
}

// The single Firebird gbak backup format version this reader has been built and verified against -- see this module's own README-FORMAT.md and the package README's .odb Tier 3 Gotchas entry for the full empirical derivation (a real, LibreOffice 26.2-generated Firebird-embedded .odb fixture's own rec_burp/att_backup_format attribute). Per burp.h's own version-history comment, format 10 corresponds to "FB2.5 -> FB3.0"; any other value throws rather than silently attempting to decode a stream shape this reader has not verified.
export const SUPPORTED_BACKUP_FORMAT_VERSION = 10;

export interface ReadFirebirdBackupResult {
  readonly summary: FirebirdBackupSummary;
  readonly tables: readonly HsqldbTable[];
}

function relationToColumns(relation: FirebirdRelation): HsqldbColumn[] {
  return relation.fields
    .filter((field) => !field.computed)
    .map((field) => ({ name: field.name, type: field.typeLabel }));
}

// Parses a complete Firebird gbak backup stream (database/firebird.fbk's own raw bytes, already extracted from the .odb package by the caller -- see src/odb/read.ts) into the same HsqldbTable[] shape src/hsqldb/script.ts's parseHsqldbScript produces for an HSQLDB-backed .odb.
export function readFirebirdBackup(
  bytes: Uint8Array<ArrayBuffer>,
): ReadFirebirdBackupResult {
  const reader = new FirebirdBackupReader(bytes);

  const leadingRecordType = reader.readTag();
  if (leadingRecordType !== 0) {
    throw new FirebirdBackupFormatError(
      `expected the stream to open with rec_burp (tag 0), found tag ${leadingRecordType} -- not a recognisable gbak backup stream`,
    );
  }
  const { backupFormatVersion, transportable, compressed } =
    readBurpHeader(reader);
  if (backupFormatVersion !== SUPPORTED_BACKUP_FORMAT_VERSION) {
    throw new FirebirdBackupFormatError(
      `backup format version ${backupFormatVersion} is not supported -- this reader has only been built and verified against format version ${SUPPORTED_BACKUP_FORMAT_VERSION} (Firebird 3.0-era gbak output). Refusing to guess at a different format's own attribute/record shape rather than risk silently misdecoding it.`,
    );
  }
  if (!transportable) {
    throw new FirebirdBackupFormatError(
      "backup is in non-transportable (native binary) row format (att_backup_transportable=false) -- this reader only decodes the transportable/XDR row encoding, the one every real fixture it was built against actually uses (gbak's own default).",
    );
  }

  let pageSizeBytes: number | undefined;
  const schema = new Map<string, FirebirdRelation>();
  const tablesInOrder: string[] = [];
  const rowsByRelation = new Map<
    string,
    ReturnType<typeof readRelationData>["rows"]
  >();

  for (;;) {
    const recordType = reader.readTag();
    if (recordType === REC_END) {
      break;
    }
    if (recordType === REC_DATABASE || recordType === REC_PHYSICAL_DB) {
      const databaseHeader = readDatabaseHeader(reader);
      pageSizeBytes = databaseHeader.pageSizeBytes ?? pageSizeBytes;
      continue;
    }
    if (recordType === REC_RELATION) {
      const relation = readRelationSchema(reader, (nestedRecordType) => {
        throw new FirebirdCompositeRecordUnsupportedError(
          nestedRecordType,
          "reading a relation's own schema (a rec_view child, most likely)",
        );
      });
      schema.set(relation.name, relation);
      tablesInOrder.push(relation.name);
      continue;
    }
    if (recordType === REC_RELATION_DATA) {
      const result = readRelationData(reader, schema, compressed);
      rowsByRelation.set(result.relationName, result.rows);
      continue;
    }
    if (FLAT_SKIPPABLE_RECORD_TYPES.has(recordType)) {
      reader.skipFlatRecordAttributes();
      continue;
    }
    throw new FirebirdCompositeRecordUnsupportedError(
      recordType,
      "walking the backup stream's own top-level record sequence",
    );
  }

  // No check that reader.atEnd() here -- confirmed against a real fixture that rec_end is genuinely NOT the last byte of the stream: mvol.cpp writes backup volumes in fixed-size blocks (att_backup_blksize), zero-padding the final block out to that size, so real trailing bytes after rec_end are legitimate filler, not a sign of a mis-walked stream. restore.epp's own top-level loop (`while (get_record(&record, tdgbl) != rec_end)`) matches this exactly -- it stops at rec_end and never inspects what follows.

  // Only USER tables (schema.system_flag-free, which this reader never reads at all -- see the README's .odb Tier 3 Fidelity note) are reported: RDB$RELATIONS/RDB$RELATION_FIELDS/RDB$FIELDS and every other system table never appear as their own rec_relation records in a gbak backup at all -- gbak's own schema dump only ever emits user-created relations (plus any user-created VIEWs, which this reader throws on as an unsupported composite record -- see schema.ts's own onUnhandledNested). There is consequently no RDB$RELATIONS-bootstrap step in this reader at all: unlike raw ODS-page reading, gbak's own backup format has ALREADY resolved table/column definitions into rec_relation/rec_field records by the time this reader ever sees them -- see the README's own .odb Tier 3 Gotchas entry for why this is a genuine, load-bearing correction to the design plan's original raw-page-format premise.
  const tables: HsqldbTable[] = tablesInOrder.map((name) => {
    const relation = schema.get(name);
    if (relation === undefined) {
      throw new FirebirdBackupFormatError(
        `internal error: relation "${name}" missing from its own schema map`,
      );
    }
    const rows = rowsByRelation.get(name) ?? [];
    return {
      tableName: relation.name,
      columns: relationToColumns(relation),
      rows,
    };
  });

  return {
    summary: { backupFormatVersion, transportable, compressed, pageSizeBytes },
    tables,
  };
}
