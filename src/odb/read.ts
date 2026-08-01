import type { Package } from 'odf.js';
import { base64ToBytes, readOdbInventory } from 'odf.js';
import type { HsqldbTable } from '../hsqldb/script';
import { parseHsqldbScript } from '../hsqldb/script';
import { readManifest } from '../odf-package/manifest';
import { readFirebirdBackup } from '../firebird/backup';

// readOdbTables(pkg) is the decoder-selection shell for .odb (ODF database front-end) packages: it inspects what odf.js's own readOdbInventory and the package's own manifest-media-type-classified parts actually contain, and routes to one of two implemented decoders -- src/hsqldb/script.ts's Tier 1 HSQLDB TEXT-script parser, or src/firebird/backup.ts's Tier 3 Firebird gbak-backup-format reader -- when the shape matches, or throws a specific, named diagnostic naming exactly what was found otherwise -- never a silent empty result. Two failure modes remain permanently out of scope, not merely unimplemented: an external-only connection (no embedded engine to read from at all), and HSQLDB's own BINARY/COMPRESSED script formats (a real, still-unimplemented Tier 2 -- see the README's .odb Gotchas/Fidelity entries).

export class OdbNoEmbeddedDataSourceError extends Error {
  readonly url: string | undefined;

  constructor(url: string | undefined) {
    super(
      url === undefined
        ? 'readOdbTables: this .odb package has no embedded data source -- its office:database has no db:data-source/db:connection-data at all, so embedded vs external cannot be determined'
        : `readOdbTables: this .odb package has no embedded data source -- its connection ("${url}") points at an external datasource (MySQL/PostgreSQL/JDBC/ODBC or similar), which is permanently out of scope for readOdbTables`,
    );
    this.name = 'OdbNoEmbeddedDataSourceError';
    this.url = url;
  }
}

export type OdbUnsupportedFormat = 'hsqldb-binary' | 'hsqldb-compressed' | 'unrecognised-engine';

export class OdbUnsupportedFormatError extends Error {
  readonly format: OdbUnsupportedFormat;

  constructor(format: OdbUnsupportedFormat, detail: string) {
    super(`readOdbTables: ${detail} is not yet supported`);
    this.name = 'OdbUnsupportedFormatError';
    this.format = format;
  }
}

const DATABASE_SCRIPT_PART = 'database/script';
const DATABASE_FIREBIRD_PART = 'database/firebird.fbk';
const EMBEDDED_URL_PREFIX = 'sdbc:embedded:';

// Mirrors odf.js's own private isXmlMediaType (src/typed/odb/read.ts) exactly -- the classification rule the whole "never misclassify database/script" guarantee is built on: a manifest-listed part is worth treating as XML content iff its OWN manifest:media-type says so, never by pattern-matching its path. Not exported by odf.js, so restated here rather than reached for through a non-existent import.
function isXmlMediaType(mediaType: string): boolean {
  return mediaType === 'text/xml' || mediaType === 'application/xml' || mediaType.endsWith('+xml');
}

const GZIP_MAGIC = [0x1f, 0x8b];

// A crude but decisive text/binary classifier for database/script's own raw bytes. HSQLDB's TEXT script format (hsqldb.script_format=0) is, by construction, printable SQL -- no NUL or other C0 control byte outside \t/\n/\r appears anywhere in genuine output, and it is always valid UTF-8. hsqldb.script_format=1 (BINARY) and =3 (COMPRESSED, gzip -- detected directly via its own two-byte magic number, checked first since gzip bytes would otherwise often also fail the control-byte scan for an unrelated reason) both fail this test: BINARY's own row encoding embeds arbitrary non-text byte values throughout, and COMPRESSED is gzip-compressed bytes, never valid UTF-8 SQL text. A false positive -- real binary/compressed content that happens to pass this screen -- is not a realistic residual risk: passing this check only hands the bytes to parseHsqldbScript, which throws its own HsqldbScriptParseError for anything that doesn't look like a real CREATE TABLE/INSERT INTO/ignorable statement, so a misclassified file still fails loudly rather than silently producing wrong data.
function classifyScriptBytes(bytes: Uint8Array): 'text' | 'compressed' | 'binary' {
  if (bytes.length >= GZIP_MAGIC.length && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1]) {
    return 'compressed';
  }
  for (const byte of bytes) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
      return 'binary';
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return 'binary';
  }
  return 'text';
}

export function readOdbTables(pkg: Package): readonly HsqldbTable[] {
  const inventory = readOdbInventory(pkg);
  if (inventory.connection === undefined || inventory.connection.type === 'external') {
    throw new OdbNoEmbeddedDataSourceError(inventory.connection?.url);
  }

  const url = inventory.connection.url;
  if (url === undefined) {
    throw new OdbUnsupportedFormatError('unrecognised-engine', 'an embedded connection with no connection url to identify its engine');
  }
  // Safe without a defensive fallback: odf.js's own readOdbInventory only ever sets connection.type to 'embedded' when url already starts with this exact prefix (see odf.js's readConnectionInfo) -- the branch above has already ruled out every other connection.type value.
  const engine = url.slice(EMBEDDED_URL_PREFIX.length);

  if (engine === 'firebird') {
    const firebirdPart = pkg.parts[DATABASE_FIREBIRD_PART];
    if (firebirdPart === undefined) {
      throw new OdbUnsupportedFormatError('unrecognised-engine', `an embedded Firebird engine with no ${DATABASE_FIREBIRD_PART} part -- an unrecognised embedded storage shape`);
    }
    if (firebirdPart.kind !== 'binary') {
      throw new Error(`readOdbTables: ${DATABASE_FIREBIRD_PART} is not a binary part (found kind "${firebirdPart.kind}") -- malformed .odb package`);
    }
    const backupBytes = base64ToBytes(firebirdPart.base64);
    return readFirebirdBackup(backupBytes).tables;
  }
  if (engine !== 'hsqldb') {
    throw new OdbUnsupportedFormatError('unrecognised-engine', `the embedded "${engine}" database engine`);
  }

  const manifestEntry = readManifest(pkg).entries.find((entry) => entry.fullPath === DATABASE_SCRIPT_PART);
  if (manifestEntry !== undefined && isXmlMediaType(manifestEntry.mediaType)) {
    throw new Error(`readOdbTables: ${DATABASE_SCRIPT_PART} is declared as an XML sub-document in the manifest (media type "${manifestEntry.mediaType}") -- not a recognised HSQLDB script part`);
  }

  const scriptPart = pkg.parts[DATABASE_SCRIPT_PART];
  if (scriptPart === undefined) {
    throw new OdbUnsupportedFormatError('unrecognised-engine', `an embedded HSQLDB engine with no ${DATABASE_SCRIPT_PART} part -- binary HSQLDB cache-only storage, or an unrecognised embedded storage shape`);
  }
  if (scriptPart.kind !== 'binary') {
    throw new Error(`readOdbTables: ${DATABASE_SCRIPT_PART} is not a binary part (found kind "${scriptPart.kind}") -- malformed .odb package`);
  }

  const scriptBytes = base64ToBytes(scriptPart.base64);
  const classification = classifyScriptBytes(scriptBytes);
  if (classification === 'compressed') {
    throw new OdbUnsupportedFormatError('hsqldb-compressed', "HSQLDB's compressed script format (hsqldb.script_format=3)");
  }
  if (classification === 'binary') {
    throw new OdbUnsupportedFormatError('hsqldb-binary', "HSQLDB's binary script format (hsqldb.script_format=1)");
  }

  return parseHsqldbScript(scriptBytes);
}
