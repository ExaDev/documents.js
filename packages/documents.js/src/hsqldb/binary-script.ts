import { unzlibSync } from "fflate";
import type { ContentCellValue } from "document-schema.js";
import type { HsqldbDecodeOptions } from "./rowformat";
import {
  HsqldbDataCursor,
  readHsqldbColumnValue,
  readModifiedUtf8,
  resolveHsqldbTypeCode,
} from "./rowformat";
import type { HsqldbTable } from "./script";
import { parseHsqldbScript } from "./script";

// Tier 4 -- HSQLDB's own whole-script BINARY (hsqldb.script_format=1) and COMPRESSED (=3) serialisations of database/script, the two alternatives to the TEXT format (=0) src/hsqldb/script.ts parses. These are NOT a different encoding of the same SQL text: org.hsqldb.scriptio.ScriptWriterBinary writes the database's own DDL as one org.hsqldb.Result record (the identical Result DatabaseScript.getScript builds for the TEXT writer, serialised through Result.write/RowOutputBinary rather than printed), followed by a per-table section carrying each MEMORY/TEXT table's rows in the SAME per-column binary encoding src/hsqldb/rowformat.ts already decodes for a CACHED table's row store. COMPRESSED is that identical byte stream wrapped in ordinary zlib DEFLATE (RFC 1950) -- ScriptWriterZipped's own java.util.zip.DeflaterOutputStream, whose default framing is zlib, not gzip -- and nothing else.
//
// The consequence for this package is that Tier 4 needs no new value decoding at all: it recovers the DDL text, hands it to Tier 1's own parseHsqldbScript to get the table/column definitions, and then splices in the row values the binary section carries. A CACHED table's rows are still NOT in the script in either format (ScriptWriterBase.writeExistingData only writes a table's rows when includeCachedData is set, which it never is for a checkpoint script), so a Tier 4 script from a database with CACHED tables still needs Tier 2's own database/data decode on top -- and gets it, because the DDL this module recovers includes the same SET TABLE ... INDEX'...' lines Tier 2 reads its roots from.
//
// Ground truth is the decompiled HSQLDB 1.8.0.10 engine bundled in LibreOffice 26.2's own hsqldb.jar (org.hsqldb.scriptio.ScriptWriterBinary/ScriptReaderBinary/ScriptWriterZipped/ScriptReaderZipped for the record framing, org.hsqldb.Result.write/Result(RowInputBinary) and its nested ResultMetaData for the DDL record, org.hsqldb.rowio.RowOutputBinary/RowInputBinary for the field encoding), verified against two real databases that same jar produced -- one at hsqldb.script_format=1 and one at =3, otherwise identical, each created, populated, switched to its format via `SET SCRIPTFORMAT`, checkpointed, and shut down through java.sql, then re-opened by the engine itself and dumped back through JDBC as the ground-truth oracle. Both oracles are byte-identical to each other and to what this module decodes. See src/test-support/odb.ts's own Tier 4 fixtures and src/hsqldb/binary-script.test.ts.

export class HsqldbBinaryScriptParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(
      `HSQLDB binary script parse error at byte offset ${offset}: ${message}`,
    );
    this.name = "HsqldbBinaryScriptParseError";
    this.offset = offset;
  }
}

// org.hsqldb.ResultConstants.DATA -- the only Result mode ScriptWriterBinary ever writes, since DatabaseScript.getScript builds its script through Result.newSingleColumnResult("COMMAND", Types.VARCHAR).
const RESULT_MODE_DATA = 3;
const SQL_TYPE_VARCHAR = 12;

// org.hsqldb.scriptio.ScriptReaderBinary.readTableInit's own second field: 1 means "a schema name follows", 0 means "no schema" (a pre-schema-support script). Any other value is an error in the engine's own reader too.
const TABLE_INIT_WITH_SCHEMA = 1;
const TABLE_INIT_WITHOUT_SCHEMA = 0;

export interface HsqldbBinaryScript {
  // The database's own DDL, recovered from the leading Result record and rejoined into exactly the TEXT-format script text the same database would have written at hsqldb.script_format=0 -- including its SET TABLE ... INDEX'...' lines, which src/hsqldb/cache.ts (Tier 2) needs to decode any CACHED table's rows out of database/data.
  readonly scriptText: string;
  // One table per CREATE TABLE statement in that DDL, with the rows the binary section carried for it (MEMORY and TEXT tables only -- a CACHED table's rows are never in the script, in any format).
  readonly tables: readonly HsqldbTable[];
}

// A cursor plus the two script-record primitives HSQLDB's own RowInput/RowOutput pair adds on top of the per-column field encoding: a length-prefixed modified-UTF-8 string (RowOutputBinary.writeString/RowInputBinary.readString) and an end-of-stream check the record loops need.
class BinaryScriptCursor {
  readonly cursor: HsqldbDataCursor;
  private readonly length: number;

  constructor(bytes: Uint8Array<ArrayBuffer>) {
    this.cursor = new HsqldbDataCursor(bytes);
    this.length = bytes.length;
  }

  get position(): number {
    return this.cursor.position;
  }

  set position(value: number) {
    this.cursor.position = value;
  }

  // Whether a further 4-byte record-length field can still be read. org.hsqldb.scriptio.ScriptReaderBinary.readRow treats an EOFException here as an ordinary end of stream rather than an error, so a script that simply stops (no trailing zero-size data terminator) is legitimate and this mirrors that.
  hasRecordLength(): boolean {
    return this.cursor.position + 4 <= this.length;
  }

  require(byteCount: number, what: string): void {
    if (this.cursor.position + byteCount > this.length) {
      throw new HsqldbBinaryScriptParseError(
        `stream ends after ${this.length} bytes while reading ${what} (${byteCount} byte(s) needed)`,
        this.cursor.position,
      );
    }
  }

  readInt32(what: string): number {
    this.require(4, what);
    return this.cursor.readInt32();
  }

  readInt16(what: string): number {
    this.require(2, what);
    return this.cursor.readInt16();
  }

  readString(what: string): string {
    const byteLength = this.readInt32(`${what}'s own length prefix`);
    if (byteLength < 0) {
      throw new HsqldbBinaryScriptParseError(
        `${what} declares a negative length ${byteLength}`,
        this.cursor.position,
      );
    }
    this.require(byteLength, what);
    return readModifiedUtf8(this.cursor.readBytes(byteLength));
  }
}

// org.hsqldb.Result's own nested ResultMetaData(RowInputBinary, mode) constructor, restricted to the DATA mode ScriptWriterBinary writes: a column count, then per column a 2-byte type, two int32s (size/scale), four length-prefixed strings (label/tableName/colName/className), and -- only when tableName and colName are both non-empty, isTableColumn's own rule -- a further int32 attribute mask and two more strings (catalog/schema). Returns the column types, the only part of the metadata this module has any use for.
function readResultMetaData(reader: BinaryScriptCursor): number[] {
  const columnCount = reader.readInt32("the DDL result's own column count");
  if (columnCount < 0) {
    throw new HsqldbBinaryScriptParseError(
      `the DDL result declares a negative column count ${columnCount}`,
      reader.position,
    );
  }
  const columnTypes: number[] = [];
  for (let i = 0; i < columnCount; i++) {
    columnTypes.push(reader.readInt16(`column ${i}'s own SQL type`));
    reader.readInt32(`column ${i}'s own declared size`);
    reader.readInt32(`column ${i}'s own declared scale`);
    reader.readString(`column ${i}'s own label`);
    const tableName = reader.readString(`column ${i}'s own table name`);
    const columnName = reader.readString(`column ${i}'s own name`);
    reader.readString(`column ${i}'s own class name`);
    if (tableName.length > 0 && columnName.length > 0) {
      reader.readInt32(`column ${i}'s own table-column attribute mask`);
      reader.readString(`column ${i}'s own catalog name`);
      reader.readString(`column ${i}'s own schema name`);
    }
  }
  return columnTypes;
}

// The leading record: one org.hsqldb.Result, written by Result.write and framed exactly as Result.read expects (a 4-byte total record length INCLUDING those four bytes, then mode/databaseID/sessionID, then -- for DATA mode -- the metadata, a row count, and that many rows in the same per-column field encoding a table row uses). Every row is a single VARCHAR: one DDL statement.
function readDdlStatements(reader: BinaryScriptCursor): string[] {
  const recordStart = reader.position;
  const recordLength = reader.readInt32(
    "the leading DDL result record's own length",
  );
  if (recordLength <= 4) {
    throw new HsqldbBinaryScriptParseError(
      `the leading DDL result record declares an implausible length ${recordLength} -- not a recognisable HSQLDB binary script`,
      recordStart,
    );
  }
  const mode = reader.readInt32("the DDL result's own mode");
  if (mode !== RESULT_MODE_DATA) {
    throw new HsqldbBinaryScriptParseError(
      `the leading record has Result mode ${mode}, not the DATA mode (${RESULT_MODE_DATA}) a script's own DDL result always carries -- not a recognisable HSQLDB binary script`,
      recordStart,
    );
  }
  reader.readInt32("the DDL result's own database id");
  reader.readInt32("the DDL result's own session id");

  const columnTypes = readResultMetaData(reader);
  const firstColumnType = columnTypes[0];
  if (columnTypes.length !== 1 || firstColumnType !== SQL_TYPE_VARCHAR) {
    throw new HsqldbBinaryScriptParseError(
      `the DDL result has ${columnTypes.length} column(s) of type [${columnTypes.join(", ")}] -- a script's own DDL result is always the single VARCHAR "COMMAND" column DatabaseScript.getScript builds`,
      recordStart,
    );
  }

  const rowCount = reader.readInt32("the DDL result's own row count");
  if (rowCount < 0) {
    throw new HsqldbBinaryScriptParseError(
      `the DDL result declares a negative row count ${rowCount}`,
      reader.position,
    );
  }
  const statements: string[] = [];
  for (let i = 0; i < rowCount; i++) {
    reader.require(1, `DDL statement ${i}`);
    const value = readHsqldbColumnValue(reader.cursor, SQL_TYPE_VARCHAR);
    if (value.kind !== "string") {
      throw new HsqldbBinaryScriptParseError(
        `DDL statement ${i} decoded as a ${value.kind} value rather than a string`,
        reader.position,
      );
    }
    statements.push(value.value);
  }

  const recordEnd = recordStart + recordLength;
  if (reader.position > recordEnd) {
    throw new HsqldbBinaryScriptParseError(
      `the DDL result overran its own declared length (consumed ${reader.position - recordStart} bytes, declared ${recordLength})`,
      reader.position,
    );
  }
  reader.position = recordEnd;
  return statements;
}

interface TableSection {
  readonly tableName: string;
  readonly rows: ContentCellValue[][];
}

// One table's own data section: the init record (org.hsqldb.scriptio.ScriptWriterBinary.writeTableInit -- length, table name, a schema-presence flag, and the schema name when the flag is 1), then one record per row, then the terminator pair writeTableTerm writes (a zero length, then the table's own row count, which the engine's own reader cross-checks against how many rows it actually read -- mirrored here). Returns undefined when the record at the cursor is instead writeDataTerm's own lone zero length: the end of the whole data section.
function readTableSection(
  reader: BinaryScriptCursor,
  tables: ReadonlyMap<string, HsqldbTable>,
  options: HsqldbDecodeOptions | undefined,
): TableSection | undefined {
  if (!reader.hasRecordLength()) {
    return undefined;
  }
  const initLength = reader.readInt32(
    "a table section's own init record length",
  );
  if (initLength === 0) {
    return undefined;
  }
  const tableName = reader.readString("a table section's own table name");
  const schemaFlag = reader.readInt32(
    `table "${tableName}"'s own schema-presence flag`,
  );
  if (
    schemaFlag !== TABLE_INIT_WITH_SCHEMA &&
    schemaFlag !== TABLE_INIT_WITHOUT_SCHEMA
  ) {
    throw new HsqldbBinaryScriptParseError(
      `table "${tableName}"'s init record has schema flag ${schemaFlag}, which is neither ${TABLE_INIT_WITHOUT_SCHEMA} nor ${TABLE_INIT_WITH_SCHEMA}`,
      reader.position,
    );
  }
  if (schemaFlag === TABLE_INIT_WITH_SCHEMA) {
    reader.readString(`table "${tableName}"'s own schema name`);
  }

  const table = tables.get(tableName.toUpperCase());
  if (table === undefined) {
    throw new HsqldbBinaryScriptParseError(
      `the data section declares rows for table "${tableName}", which the script's own DDL never declared`,
      reader.position,
    );
  }
  const typeCodes = table.columns.map((column) =>
    resolveHsqldbTypeCode(column.type),
  );

  const rows: ContentCellValue[][] = [];
  for (;;) {
    const rowStart = reader.position;
    const rowLength = reader.readInt32(`a row length in table "${tableName}"`);
    if (rowLength === 0) {
      break;
    }
    if (rowLength < 0) {
      throw new HsqldbBinaryScriptParseError(
        `a row in table "${tableName}" declares a negative length ${rowLength}`,
        rowStart,
      );
    }
    const rowEnd = rowStart + rowLength;
    reader.require(rowLength - 4, `a row in table "${tableName}"`);
    rows.push(
      typeCodes.map((typeCode) =>
        readHsqldbColumnValue(reader.cursor, typeCode, options),
      ),
    );
    if (reader.position > rowEnd) {
      throw new HsqldbBinaryScriptParseError(
        `a row in table "${tableName}" overran its own declared length (consumed ${reader.position - rowStart} bytes, declared ${rowLength})`,
        reader.position,
      );
    }
    reader.position = rowEnd;
  }

  const declaredRowCount = reader.readInt32(
    `table "${tableName}"'s own trailing row count`,
  );
  if (declaredRowCount !== rows.length) {
    throw new HsqldbBinaryScriptParseError(
      `table "${tableName}" declares ${declaredRowCount} row(s) in its own terminator but the section carried ${rows.length}`,
      reader.position,
    );
  }
  return { tableName, rows };
}

// Parses a whole-script BINARY (hsqldb.script_format=1) database/script part. Hand it already-inflated bytes for the COMPRESSED (=3) variant -- see inflateHsqldbCompressedScript below.
export function parseHsqldbBinaryScript(
  bytes: Uint8Array<ArrayBuffer>,
  options?: HsqldbDecodeOptions,
): HsqldbBinaryScript {
  const reader = new BinaryScriptCursor(bytes);
  const statements = readDdlStatements(reader);
  // Rejoined with newlines and handed straight to Tier 1: DatabaseScript.getScript builds each statement as a single line (its own StringBuffer never emits a raw newline outside a quoted literal), which is exactly what splitStatements' quote-aware newline split expects -- and an empty statement, which getIdentityUpdateDDL genuinely produces for a table with no identity column, is dropped there as a blank line.
  const scriptText = statements.join("\n");
  const tables = parseHsqldbScript(new TextEncoder().encode(scriptText));
  const tablesByName = new Map(
    tables.map((table) => [table.tableName.toUpperCase(), table]),
  );

  const rowsByTable = new Map<string, ContentCellValue[][]>();
  for (;;) {
    const section = readTableSection(reader, tablesByName, options);
    if (section === undefined) {
      break;
    }
    rowsByTable.set(section.tableName.toUpperCase(), section.rows);
  }

  return {
    scriptText,
    tables: tables.map((table) => {
      const rows = rowsByTable.get(table.tableName.toUpperCase());
      return rows === undefined ? table : { ...table, rows };
    }),
  };
}

// org.hsqldb.scriptio.ScriptWriterZipped wraps ScriptWriterBinary's identical output in a java.util.zip.DeflaterOutputStream over a plain `new Deflater(-1)` -- i.e. zlib framing (RFC 1950), not raw DEFLATE and not gzip -- and ScriptReaderZipped reads it back through a plain InflaterInputStream. fflate's unzlibSync is the exact counterpart, and is already this package's own dependency for every other DEFLATE stream it touches.
export function inflateHsqldbCompressedScript(
  bytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return unzlibSync(bytes);
}
