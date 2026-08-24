import type { Package } from "odf.js";
import { base64ToBytes, readOdbInventory } from "odf.js";
import {
  inflateHsqldbCompressedScript,
  parseHsqldbBinaryScript,
} from "../hsqldb/binary-script";
import { decodeHsqldbCachedTables } from "../hsqldb/cache";
import type { HsqldbDecodeOptions } from "../hsqldb/rowformat";
import type { HsqldbTable } from "../hsqldb/script";
import { parseHsqldbScript } from "../hsqldb/script";
import { readManifest } from "odf.js";
import { readFirebirdBackup } from "../firebird/backup";

// readOdbTables(pkg) is the decoder-selection shell for .odb (ODF database front-end) packages: it inspects what odf.js's own readOdbInventory and the package's own manifest-media-type-classified parts actually contain, and routes to the implemented decoders, or throws a specific, named diagnostic naming exactly what was found otherwise -- never a silent empty result. Every embedded storage shape HSQLDB and Firebird can produce is now decoded: src/hsqldb/script.ts's Tier 1 TEXT-script parser (hsqldb.script_format=0), extended by src/hsqldb/cache.ts's Tier 2 CACHED-table binary row-store decoder whenever a database/data part is present; src/firebird/backup.ts's Tier 3 gbak-backup-format reader for a Firebird-backed .odb; and src/hsqldb/binary-script.ts's Tier 4 whole-script BINARY/COMPRESSED reader (hsqldb.script_format=1 and =3, the latter being that identical byte stream under ordinary zlib DEFLATE -- see this module's own classifyScriptBytes comment). Tier 4's own recovered DDL feeds Tier 2 exactly as Tier 1's does, so a BINARY-format script belonging to a database with CACHED tables decodes end to end too. One failure mode remains permanently out of scope rather than merely unimplemented: an external-only connection, with no embedded engine to read from at all.

export class OdbNoEmbeddedDataSourceError extends Error {
  readonly url: string | undefined;

  constructor(url: string | undefined) {
    super(
      url === undefined
        ? "readOdbTables: this .odb package has no embedded data source -- its office:database has no db:data-source/db:connection-data at all, so embedded vs external cannot be determined"
        : `readOdbTables: this .odb package has no embedded data source -- its connection ("${url}") points at an external datasource (MySQL/PostgreSQL/JDBC/ODBC or similar), which is permanently out of scope for readOdbTables`,
    );
    this.name = "OdbNoEmbeddedDataSourceError";
    this.url = url;
  }
}

// One member today, since every embedded storage shape this package encounters is now decoded -- what remains is a connection naming an embedded engine (or an engine's own storage shape) this package has no reader for at all.
export type OdbUnsupportedFormat = "unrecognised-engine";

export class OdbUnsupportedFormatError extends Error {
  readonly format: OdbUnsupportedFormat;

  constructor(format: OdbUnsupportedFormat, detail: string) {
    super(`readOdbTables: ${detail} is not yet supported`);
    this.name = "OdbUnsupportedFormatError";
    this.format = format;
  }
}

const DATABASE_SCRIPT_PART = "database/script";
const DATABASE_DATA_PART = "database/data";
const DATABASE_PROPERTIES_PART = "database/properties";
const DATABASE_FIREBIRD_PART = "database/firebird.fbk";
const EMBEDDED_URL_PREFIX = "sdbc:embedded:";

// Mirrors odf.js's own private isXmlMediaType (src/typed/odb/read.ts) exactly -- the classification rule the whole "never misclassify database/script" guarantee is built on: a manifest-listed part is worth treating as XML content iff its OWN manifest:media-type says so, never by pattern-matching its path. Not exported by odf.js, so restated here rather than reached for through a non-existent import.
function isXmlMediaType(mediaType: string): boolean {
  return (
    mediaType === "text/xml" ||
    mediaType === "application/xml" ||
    mediaType.endsWith("+xml")
  );
}

// A real hsqldb.script_format=3 file's own leading bytes, confirmed by generating one with the actual HSQLDB 1.8.0.10 engine (org.hsqldb.scriptio.ScriptWriterZipped wraps its output in a plain java.util.zip.DeflaterOutputStream/Deflater, which is zlib-framed -- RFC 1950 -- by default, not gzip): a minimal, spec-based check on the 2-byte zlib header (CMF/FLG) rather than a single fixed magic-byte pair, since any conformant zlib producer -- not only this one exact Deflater configuration -- is a legitimate match. CMF's low nibble must declare the DEFLATE compression method (8), and (CMF*256+FLG) must be an exact multiple of 31, the header's own built-in checksum.
function isZlibHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 2) {
    return false;
  }
  const cmf = bytes[0];
  const flg = bytes[1];
  if (cmf === undefined || flg === undefined) {
    return false;
  }
  return (cmf & 0x0f) === 8 && (cmf * 256 + flg) % 31 === 0;
}

// A crude but decisive text/binary classifier for database/script's own raw bytes. HSQLDB's TEXT script format (hsqldb.script_format=0) is, by construction, printable SQL -- no NUL or other C0 control byte outside \t/\n/\r appears anywhere in genuine output, and it is always valid UTF-8. hsqldb.script_format=1 (BINARY) and =3 (COMPRESSED -- detected directly via its own zlib header, checked first since a compressed stream's bytes would otherwise also fail the control-byte scan for an unrelated reason) both fail this test: BINARY's own row encoding embeds arbitrary non-text byte values throughout, and COMPRESSED is zlib-compressed bytes, never valid UTF-8 SQL text. A false positive -- real binary/compressed content that happens to pass this screen -- is not a realistic residual risk: passing this check only hands the bytes to parseHsqldbScript, which throws its own HsqldbScriptParseError for anything that doesn't look like a real CREATE TABLE/INSERT INTO/ignorable statement, so a misclassified file still fails loudly rather than silently producing wrong data.
function classifyScriptBytes(
  bytes: Uint8Array,
): "text" | "compressed" | "binary" {
  if (isZlibHeader(bytes)) {
    return "compressed";
  }
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      return "binary";
    }
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return "binary";
  }
  return "text";
}

export function readOdbTables(
  pkg: Package,
  options?: HsqldbDecodeOptions,
): readonly HsqldbTable[] {
  const inventory = readOdbInventory(pkg);
  if (
    inventory.connection === undefined ||
    inventory.connection.type === "external"
  ) {
    throw new OdbNoEmbeddedDataSourceError(inventory.connection?.url);
  }

  const url = inventory.connection.url;
  if (url === undefined) {
    throw new OdbUnsupportedFormatError(
      "unrecognised-engine",
      "an embedded connection with no connection url to identify its engine",
    );
  }
  // Safe without a defensive fallback: odf.js's own readOdbInventory only ever sets connection.type to 'embedded' when url already starts with this exact prefix (see odf.js's readConnectionInfo) -- the branch above has already ruled out every other connection.type value.
  const engine = url.slice(EMBEDDED_URL_PREFIX.length);

  if (engine === "firebird") {
    const firebirdPart = pkg.parts[DATABASE_FIREBIRD_PART];
    if (firebirdPart === undefined) {
      throw new OdbUnsupportedFormatError(
        "unrecognised-engine",
        `an embedded Firebird engine with no ${DATABASE_FIREBIRD_PART} part -- an unrecognised embedded storage shape`,
      );
    }
    if (firebirdPart.kind !== "binary") {
      throw new Error(
        `readOdbTables: ${DATABASE_FIREBIRD_PART} is not a binary part (found kind "${firebirdPart.kind}") -- malformed .odb package`,
      );
    }
    const backupBytes = base64ToBytes(firebirdPart.base64);
    return readFirebirdBackup(backupBytes).tables;
  }
  if (engine !== "hsqldb") {
    throw new OdbUnsupportedFormatError(
      "unrecognised-engine",
      `the embedded "${engine}" database engine`,
    );
  }

  const manifestEntry = readManifest(pkg).entries.find(
    (entry) => entry.fullPath === DATABASE_SCRIPT_PART,
  );
  if (manifestEntry !== undefined && isXmlMediaType(manifestEntry.mediaType)) {
    throw new Error(
      `readOdbTables: ${DATABASE_SCRIPT_PART} is declared as an XML sub-document in the manifest (media type "${manifestEntry.mediaType}") -- not a recognised HSQLDB script part`,
    );
  }

  const scriptPart = pkg.parts[DATABASE_SCRIPT_PART];
  if (scriptPart === undefined) {
    throw new OdbUnsupportedFormatError(
      "unrecognised-engine",
      `an embedded HSQLDB engine with no ${DATABASE_SCRIPT_PART} part -- an unrecognised embedded storage shape`,
    );
  }
  if (scriptPart.kind !== "binary") {
    throw new Error(
      `readOdbTables: ${DATABASE_SCRIPT_PART} is not a binary part (found kind "${scriptPart.kind}") -- malformed .odb package`,
    );
  }

  const scriptBytes = base64ToBytes(scriptPart.base64);
  const classification = classifyScriptBytes(scriptBytes);
  if (classification !== "text") {
    // Tier 4: one whole-script binary stream, optionally zlib-wrapped. Its own DDL comes back as ordinary TEXT-format script text, which is what withCachedTableRows needs to find any CACHED table's index roots in -- so the two tiers compose exactly as they do for a TEXT script.
    const binaryBytes =
      classification === "compressed"
        ? inflateHsqldbCompressedScript(scriptBytes)
        : scriptBytes;
    const { scriptText, tables } = parseHsqldbBinaryScript(
      binaryBytes,
      options,
    );
    return withCachedTableRows(pkg, tables, scriptText, options);
  }

  const scriptText = new TextDecoder("utf-8", { fatal: true }).decode(
    scriptBytes,
  );
  return withCachedTableRows(
    pkg,
    parseHsqldbScript(scriptBytes),
    scriptText,
    options,
  );
}

// A CACHED table's own DDL always lives in database/script (as literal SQL text for a TEXT script, and as a DDL statement inside the leading Result record for a BINARY/COMPRESSED one, which Tier 4 recovers into the identical text) -- the caller has already produced every table's correct column list from it -- but a real HSQLDB writer never emits row data for a CACHED table into the script in any format, only for MEMORY/TEXT tables. database/data (present only when at least one table is CACHED) carries the actual row bytes; src/hsqldb/cache.ts's decodeHsqldbCachedTables splices them in. No database/data part at all -- the common case, every table MEMORY/TEXT, or (per the existing Tier 1 fixtures) no CACHED table involved -- leaves parseHsqldbScript's own result untouched, exactly matching every pre-Tier-2 caller's existing expectations.
function withCachedTableRows(
  pkg: Package,
  tables: readonly HsqldbTable[],
  scriptText: string,
  options: HsqldbDecodeOptions | undefined,
): readonly HsqldbTable[] {
  const dataPart = pkg.parts[DATABASE_DATA_PART];
  if (dataPart === undefined) {
    return tables;
  }
  if (dataPart.kind !== "binary") {
    throw new Error(
      `readOdbTables: ${DATABASE_DATA_PART} is not a binary part (found kind "${dataPart.kind}") -- malformed .odb package`,
    );
  }
  const propertiesPart = pkg.parts[DATABASE_PROPERTIES_PART];
  if (propertiesPart === undefined) {
    throw new Error(
      `readOdbTables: ${DATABASE_DATA_PART} is present but ${DATABASE_PROPERTIES_PART} is not -- malformed .odb package (a CACHED-table row store always ships alongside its own properties file, which this decoder needs for the cache file's own scale)`,
    );
  }
  if (propertiesPart.kind !== "binary") {
    throw new Error(
      `readOdbTables: ${DATABASE_PROPERTIES_PART} is not a binary part (found kind "${propertiesPart.kind}") -- malformed .odb package`,
    );
  }

  const dataBytes = base64ToBytes(dataPart.base64);
  const propertiesText = new TextDecoder("utf-8", { fatal: true }).decode(
    base64ToBytes(propertiesPart.base64),
  );
  return decodeHsqldbCachedTables(
    tables,
    scriptText,
    dataBytes,
    propertiesText,
    options,
  );
}
