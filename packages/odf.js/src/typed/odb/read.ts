import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import type { ManifestEntry } from '../../manifest';
import { readManifest } from '../../manifest';
import { rootElement, findChildElement, childrenWithTag, attrValue } from '../../xml/query';
import { decodeXmlText } from '../../xml/entities';

// Package -> OdbInventory: connection info plus the NAMES of forms/queries/reports/tables in a .odb (application/vnd.oasis.opendocument.base) database front-end package -- never their content, and never the embedded/external database engine's own binary or script storage. This is deliberately NOT a typed content reader in the sense readOdt/readOdp/readOds/readOdg are: a .odb's real "content" -- table rows, query result sets, form/report layout and logic -- lives either inside a real database engine (HSQLDB, Firebird, or an external server) this reader does not and will not parse, or inside each form's/report's own genuine ODF sub-document (a real, separately-readable office:document-content the existing readOdt-style machinery could open on its own merit, but which this reader deliberately never opens, matching the "never their content" mandate). HSQLDB/Firebird binary parsing is separate, later work in the documents.js repo, not here.
//
// EMPIRICALLY CONFIRMED against real, unmodified LibreOffice 26.2 output, not assumed: a headless UNO Basic macro (mirroring the same technique src/typed/odm/read.ts's own top-of-file note describes) created a real embedded-Firebird .odb via com.sun.star.sdb.DatabaseContext.createInstance() with URL "sdbc:embedded:firebird", two real tables via a live SQL connection (CREATE TABLE "Customers"/"Orders"), and one real query via the data source's own QueryDefinitions container -- then stored it and unzipped the result directly (src/typed/odb/fixtures/embedded-firebird.odb, checked in alongside this reader, never hand-edited afterwards). Three real findings from that inspection, all load-bearing for this reader's own design, and all genuine corrections to this reader's own design-phase assumptions (which, per the OASIS ODF 1.3 schema's own "Database Front-end Document" chapter table of contents, expected a separate database/connection.xml part):
//
// 1. There is NO separate database/connection.xml part at all in real output. office:database (ODF's own database-front-end root, one of office:body's own content alternatives alongside office:text/office:spreadsheet/etc. -- confirmed directly against the real OASIS ODF 1.3 RelaxNG schema's own office-body-content define) lives directly inside the package's ordinary top-level content.xml, wrapped in the exact same office:document-content/office:body shell every other odf.js typed reader already unwraps. This reader's own CONTENT_PART constant is therefore "content.xml", matching every other typed reader in this package, not a database-specific path.
// 2. The embedded database engine's own storage is a single opaque part under database/ (here, database/firebird.fbk -- a real Firebird backup file) with NO extension and a manifest:media-type of "" (empty) -- exactly the "extensionless, unclassifiable-by-extension" shape this reader's own design brief anticipated for HSQLDB's equivalent database/script text file (an older embedded engine LibreOffice still supports choosing explicitly; this session's own headless HSQLDB attempt hit an unrelated Java classloader fault specific to this sandboxed environment, which is why the genuine fixture ended up Firebird-backed instead). Both shapes share the one property this reader's own part-classification logic actually depends on -- manifest:media-type, never the part's own path or extension, decides whether a manifest-listed part is worth treating as an XML sub-document (see isXmlMediaType and subdocumentNamesUnderPrefix below) -- so this reader is correct for either engine's own opaque storage shape without needing to special-case one over the other.
// 3. Tables have NO manifest-listed ODF part of their own at all -- confirmed by this exact fixture, which has two genuine, live-created tables and precisely zero manifest entries anywhere under a "tables/" prefix. A real engine's own tables are invisible to the ODF package entirely; the only ODF-level places a table's own NAME can legitimately appear without reading the engine's own binary/script storage (explicitly out of scope) are two optional, inline content.xml elements: db:table-representations/db:table-representation (a user's own saved column-width/style customisation for a table they've already browsed in Base -- present only if the user did that) and db:schema-definition/db:table-definitions/db:table-definition (used by a flat-file-backed data source with no real engine behind it, to describe its own schema since nothing else can). Neither appears in this reader's own genuine fixture (a fresh, uncustomised two-table database), so this reader's own real-fixture test asserts an honestly empty tables array for that file, not a bug -- see readTableNames below and Fidelity-equivalent framing in this module's own test suite.
//
// FORMS/REPORTS, by contrast, genuinely are separate manifest sub-document parts: db:forms/db:component and db:reports/db:component (content.xml's own registry of a form/report's NAME, alongside an xlink:href pointing at that form/report's own genuine ODF sub-document, e.g. "forms/CustomerForm/content.xml") share the identical external/embedded-document-reference shape src/manifest.ts's own subdocumentDirectories already recognises generically for ANY embedded ODF sub-document (a real, already-proven mechanism in this exact codebase -- see e.g. the formula reader's own "Object 1/content.xml" embedded-Math-object finding). This reader deliberately sources form/report NAMES from the manifest's own part listing (per this task's own design brief), not from parsing db:forms/db:reports in content.xml, for exactly that reason: the manifest is where a real sub-document's own existence is unambiguously recorded, and reading only its path -- never opening "forms/CustomerForm/content.xml" itself -- is what keeps this reader's own "never their content" promise honest. This session's own live-generation attempt could not get a real form/report to actually persist via headless UNO automation (com.sun.star.sdb.application.XDocumentContainer's own createInstance()/insertByName() sequence returned a null document instance in this specific environment, after several genuinely different argument shapes were tried -- an environment-specific automation gap, not a design uncertainty), so the "forms/<Name>/content.xml" / "reports/<Name>/content.xml" path shape below is grounded in the OASIS RNG schema's own db:component xlink:href mechanism plus this codebase's own already-proven subdocumentDirectories convention, not in a second genuine fixture -- covered instead by a hand-built synthetic manifest in this reader's own test suite, matching src/typed/odm/read.test.ts's own established split between one real base fixture and synthetic scope-boundary packages.
//
// QUERIES have no manifest part of their own either -- confirmed both by this reader's own real fixture (one query, CustomerList, present in content.xml's db:queries but nowhere in the manifest) and by the RNG schema itself: unlike db:component, db:query/db:query-collection carry no xlink:href at all, only an inline, mandatory db:command (the query's own SQL text) plus an optional db:escape-processing flag. Query definitions are read from content.xml's own db:queries/db:query (and nested db:query-collection) elements. A db:query-collection's OWN db:name (a folder-like grouping, not a runnable query) is never added to the result -- only the db:query leaves nested inside it are.
//
// POLICY CHANGE: this reader used to discard db:command entirely, on the grounds that it was query CONTENT rather than a NAME, matching the same "never their content" mandate this module's top-of-file note states for forms/reports/tables. That blanket treatment does not actually hold for a query the way it holds for a form/report: a form/report's real content is a genuine separate ODF sub-document (layout, script, the works) this reader deliberately never opens; a query's "content" is a single SQL string already sitting inline in content.xml, no sub-document read required to get it. The design work for Report Builder (rpt:) support found a concrete need for that string: a rpt:report's own data source references a query BY NAME, and there is no way to know what a report actually renders without the query's real command text alongside its name. db:command and db:escape-processing are consequently now read and returned via OdbQueryInfo; forms/reports/tables keep the original "name only" mandate unchanged, since their own content genuinely does live in a separate sub-document this reader still never opens.
//
// driverClass, present in this reader's own design brief's illustrative return shape, is deliberately never populated: a full read of the OASIS ODF 1.3 RelaxNG schema's entire db: namespace (every db-* define -- the real database/connection element vocabulary) turns up no driver-class-equivalent attribute anywhere. db:driver-settings carries db:system-driver-settings/db:base-dn/db:parameter-name-substitution/db:show-deleted/db:is-first-row-header-line, none of which name a JDBC driver class. Kept in OdbConnectionInfo's own type as optional -- matching src/typed/odm/read.ts's own OdmSection.inlineContent precedent, a field the design brief asked for and kept ready rather than dropped, in case a future ODF revision or a non-LibreOffice producer's own extension attribute does carry one -- but never set by this reader, since ODF itself has nowhere to source it from.

export interface OdbConnectionInfo {
  type: 'embedded' | 'external';
  // See this module's own top-of-file note: never populated by this reader -- ODF's own db: schema has no driver-class-equivalent attribute anywhere. Kept for a future producer/revision that might add one.
  driverClass?: string;
  url?: string;
}

export interface OdbQueryInfo {
  name: string;
  // The query's real SQL text, read from db:command -- see this module's own top-of-file note on the POLICY CHANGE that started reading it.
  command: string;
  // db:escape-processing (whether JDBC/ODBC escape syntax in db:command should be processed before running it), when the element declares one -- undefined when absent, never defaulted, since the ODF schema's own default for an absent attribute is a driver/engine concern this reader has no business guessing at.
  escapeProcessing?: boolean;
}

export interface OdbInventory {
  connection: OdbConnectionInfo | undefined;
  tables: string[];
  queries: OdbQueryInfo[];
  forms: string[];
  reports: string[];
}

const CONTENT_PART = 'content.xml';
const EMBEDDED_URL_PREFIX = 'sdbc:embedded:';
const SUBDOCUMENT_CONTENT_SUFFIX = '/content.xml';

// The one classification rule this whole reader is built around: a manifest-listed part is worth treating as XML content iff its OWN manifest:media-type says so -- ending in "+xml", or exactly "text/xml"/"application/xml" -- never by pattern-matching its path (a ".xml"-looking suffix) or by sniffing its bytes. This is what correctly leaves an extensionless, media-type-"" part like database/script or database/firebird.fbk untouched by the forms/reports enumeration below, with no special-casing of either engine's own opaque storage shape needed.
function isXmlMediaType(mediaType: string): boolean {
  return mediaType === 'text/xml' || mediaType === 'application/xml' || mediaType.endsWith('+xml');
}

// db:server-database has no single xlink:href of its own (unlike db:connection-resource/db:file-based-database) -- db:type plus either db:hostname[:db:port] or db:local-socket-name, plus an optional db:database-name, describe the connection instead. Never empirically observed (see this module's own top-of-file note); this formats those parts into one descriptive URL-shaped string on a defensible best-effort basis, purely for OdbConnectionInfo.url's own benefit -- it is not a real connection URL any driver would accept verbatim.
function formatServerDatabaseUrl(serverDatabase: XmlElement): string | undefined {
  const dbType = attrValue(serverDatabase, 'db:type');
  if (dbType === undefined) {
    return undefined;
  }
  const hostname = attrValue(serverDatabase, 'db:hostname');
  const port = attrValue(serverDatabase, 'db:port');
  const localSocketName = attrValue(serverDatabase, 'db:local-socket-name');
  const databaseName = attrValue(serverDatabase, 'db:database-name');
  const host = hostname === undefined ? localSocketName : `${hostname}${port === undefined ? '' : `:${port}`}`;

  if (host === undefined) {
    return databaseName === undefined ? `${dbType}://` : `${dbType}:///${databaseName}`;
  }
  return databaseName === undefined ? `${dbType}://${host}` : `${dbType}://${host}/${databaseName}`;
}

// db:data-source/db:connection-data -> OdbConnectionInfo, or undefined if the office:database element carries no connection data at all (malformed but salvageable, matching this codebase's general degrade-not-throw posture for an optional/malformed sub-part). db:connection-data's own content model is a CHOICE (per the OASIS RNG schema) between db:connection-resource (the common, genuinely-observed case -- a single xlink:href covering both embedded and external connections alike, discriminated here purely by the "sdbc:embedded:" URL scheme prefix confirmed in this reader's own real fixture) and db:database-description (a file-based or server-based description, handled defensively -- see formatServerDatabaseUrl above and this module's own top-of-file note on why neither was ever empirically observed).
function readConnectionInfo(databaseElement: XmlElement): OdbConnectionInfo | undefined {
  const dataSource = findChildElement(databaseElement.children, 'db:data-source');
  const connectionData = dataSource === undefined ? undefined : findChildElement(dataSource.children, 'db:connection-data');
  if (connectionData === undefined) {
    return undefined;
  }

  const resource = findChildElement(connectionData.children, 'db:connection-resource');
  if (resource !== undefined) {
    const url = attrValue(resource, 'xlink:href');
    if (url === undefined) {
      return undefined;
    }
    return { type: url.startsWith(EMBEDDED_URL_PREFIX) ? 'embedded' : 'external', url };
  }

  const description = findChildElement(connectionData.children, 'db:database-description');
  if (description === undefined) {
    return undefined;
  }

  const fileBased = findChildElement(description.children, 'db:file-based-database');
  if (fileBased !== undefined) {
    const url = attrValue(fileBased, 'xlink:href');
    return url === undefined ? { type: 'external' } : { type: 'external', url };
  }

  const serverDatabase = findChildElement(description.children, 'db:server-database');
  if (serverDatabase !== undefined) {
    const url = formatServerDatabaseUrl(serverDatabase);
    return url === undefined ? { type: 'external' } : { type: 'external', url };
  }

  return undefined;
}

// Walks db:queries' own db:query/db:query-collection children (recursively, since a query can sit inside an arbitrarily nested named group -- per the OASIS schema's own db-queries define), collecting each db:query's own db:name, db:command, and (when present) db:escape-processing -- see this module's own top-of-file note on why db:command is read now. db:command is entity-decoded (xml/entities.ts's decodeXmlText) before being returned, the same "projected plain-text content" treatment every other typed reader in this package already gives a real XML text value -- odf.js's own lossless model keeps entities raw for round-trip fidelity (processEntities:false), and OdbQueryInfo.command is exactly the boundary where that raw encoding needs to be undone (real SQL like `SELECT * FROM "Customers"` is stored in content.xml as `&quot;Customers&quot;`). A query missing either its name or its command (malformed -- both are mandatory per the schema) is skipped rather than returned half-populated, matching this reader's general "malformed-but-salvageable degrades, never fabricates" posture. A db:query-collection's own db:name (a folder-like grouping) is never itself collected as a query definition.
function collectQueryDefinitions(container: XmlElement, definitions: OdbQueryInfo[]): void {
  for (const child of container.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tag === 'db:query') {
      const name = attrValue(child, 'db:name');
      const command = attrValue(child, 'db:command');
      if (name === undefined || command === undefined) {
        continue;
      }
      const decodedCommand = decodeXmlText(command);
      const escapeProcessingRaw = attrValue(child, 'db:escape-processing');
      definitions.push(
        escapeProcessingRaw === undefined
          ? { name, command: decodedCommand }
          : { name, command: decodedCommand, escapeProcessing: escapeProcessingRaw === 'true' },
      );
    } else if (child.tag === 'db:query-collection') {
      collectQueryDefinitions(child, definitions);
    }
  }
}

// The only two ODF-level places a table's own NAME can appear without reading a real database engine's own binary/script storage -- see this module's own top-of-file note (point 3) on why a "tables/" manifest prefix, the design brief's own original assumption, does not exist in real output. db:table-representations/db:table-representation (a user's saved display customisation for a table they've already browsed) and db:schema-definition/db:table-definitions/db:table-definition (a flat-file data source's own inline schema, since it has no real engine to ask) are read for their own db:name only -- never db:table-representation's own db:order-statement/db:filter-statement/db:columns, and never db:table-definition's own db:column-definitions/db:keys/db:indices, all of which would be table CONTENT, not its name. Deduplicated (a table could plausibly appear in both places at once), preserving first-seen order.
function collectTableNames(databaseElement: XmlElement): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const pushName = (name: string | undefined): void => {
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  };

  const representations = findChildElement(databaseElement.children, 'db:table-representations');
  if (representations !== undefined) {
    for (const representation of childrenWithTag(representations, 'db:table-representation')) {
      pushName(attrValue(representation, 'db:name'));
    }
  }

  const schemaDefinition = findChildElement(databaseElement.children, 'db:schema-definition');
  const tableDefinitions = schemaDefinition === undefined ? undefined : findChildElement(schemaDefinition.children, 'db:table-definitions');
  if (tableDefinitions !== undefined) {
    for (const definition of childrenWithTag(tableDefinitions, 'db:table-definition')) {
      pushName(attrValue(definition, 'db:name'));
    }
  }

  return names;
}

// Every manifest entry whose own full path sits under `prefix` and ends in "/content.xml" -- db:forms/db:reports' own real sub-document shape, per this module's own top-of-file note -- AND whose own manifest:media-type is genuinely XML-classified (see isXmlMediaType), names the sub-document by the LAST path segment before "/content.xml" (its own form/report name, correctly ignoring any enclosing db:component-collection group folder the real path may be nested under). The media-type check is what keeps this from ever mistaking a same-path-shaped but non-XML part for a real sub-document -- see this reader's own test suite for the "misclassified part under forms/" regression this guards against, the forms/reports-side analogue of the database/script risk this module's own top-of-file note describes.
function subdocumentNamesUnderPrefix(entries: readonly ManifestEntry[], prefix: string): string[] {
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.fullPath.startsWith(prefix) || !entry.fullPath.endsWith(SUBDOCUMENT_CONTENT_SUFFIX) || !isXmlMediaType(entry.mediaType)) {
      continue;
    }
    const withoutSuffix = entry.fullPath.slice(0, entry.fullPath.length - SUBDOCUMENT_CONTENT_SUFFIX.length);
    const lastSlash = withoutSuffix.lastIndexOf('/');
    const name = lastSlash === -1 ? withoutSuffix.slice(prefix.length) : withoutSuffix.slice(lastSlash + 1);
    if (name.length > 0) {
      names.push(name);
    }
  }
  return names;
}

// Package -> OdbInventory. Throws only when content.xml itself, or its own office:body/office:database element, is missing -- a genuinely unusable package, mirroring every other odf.js typed reader's own "missing required structural element" throw convention (see e.g. readOdt, readOdm). Everything else -- no connection data, no queries, no forms/reports/tables -- degrades to undefined/an empty array rather than throwing, matching this reader's own general "malformed-but-salvageable input degrades gracefully" posture; readOdbInventory has no diagnostics channel to report a partial read through, the same shape readOdt/readOdm/readOdfFormula already establish.
export function readOdbInventory(pkg: Package): OdbInventory {
  const contentPart = pkg.parts[CONTENT_PART];
  if (contentPart?.kind !== 'xml') {
    throw new Error(`readOdbInventory: package has no ${CONTENT_PART} part`);
  }
  const contentRoot = rootElement(contentPart.nodes);
  const body = contentRoot === undefined ? undefined : findChildElement(contentRoot.children, 'office:body');
  const databaseElement = body === undefined ? undefined : findChildElement(body.children, 'office:database');
  if (databaseElement === undefined) {
    throw new Error(`readOdbInventory: ${CONTENT_PART} has no office:body/office:database element`);
  }

  const connection = readConnectionInfo(databaseElement);

  const queries: OdbQueryInfo[] = [];
  const queriesElement = findChildElement(databaseElement.children, 'db:queries');
  if (queriesElement !== undefined) {
    collectQueryDefinitions(queriesElement, queries);
  }

  const tables = collectTableNames(databaseElement);

  const manifest = readManifest(pkg);
  const forms = subdocumentNamesUnderPrefix(manifest.entries, 'forms/');
  const reports = subdocumentNamesUnderPrefix(manifest.entries, 'reports/');

  return { connection, tables, queries, forms, reports };
}
