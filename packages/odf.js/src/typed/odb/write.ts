import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { ODF_MEDIA_TYPES } from "../../media-type";
import { syncManifest } from "../../manifest";
import { el } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import {
  createOdfPackage,
  DEFAULT_ODF_VERSION,
} from "../../package-io/scaffold";
import type {
  OdbComponentInfo,
  OdbConnectionInfo,
  OdbInventory,
  OdbQueryInfo,
} from "./read";

// OdbInventory -> a real .odb Package: the write-side inverse of readOdbInventory, and the seventh content writer in this package's typed layer. What it writes is exactly what that reader reads -- the package's FRONT-END definitions: the db: connection declaration, the forms/reports component registry, the queries with their SQL commands, and the table-name listings. It never writes and never invents the embedded database engine's own storage (database/firebird.fbk or an HSQLDB script): the reader deliberately treats that as opaque, and a writer cannot author genuine engine files, so the engine storage of a round-tripped .odb is whatever the caller carries over as a part -- exactly the reader's own stance in the other direction.
//
// The element shapes mirror the real LibreOffice output the reader's own UNO verification transcribed element-for-element (src/typed/odb/fixtures/form-and-report.odb): office:database directly inside the ordinary office:body, db:component entries carrying db:name/xlink:href/xlink:type="simple"/db:as-template, db:query carrying db:name/db:command, in the fixture's own child order (data-source, forms, reports, queries). Only the attributes the reader actually reads are written -- db:driver-settings and db:application-connection-settings (which the reader skips entirely, and real output always carries with empty defaults) are omitted rather than fabricated with invented values.
//
// CONNECTION BOUNDARY, stated rather than papered over: EVERY connection this writer accepts -- embedded or external -- is written as db:connection-resource carrying the inventory's own url verbatim, because that is the one spelling readOdbInventory classifies from the url itself ("sdbc:embedded:..." prefix => embedded, anything else => external with the same url). The reader's OTHER external sources (db:database-description/db:file-based-database with its real href, and db:server-database, whose host/port/socket parts the reader formats into a descriptive url its own comment states "is not a real connection URL any driver would accept verbatim") are not separately invertible: the inventory carries no field distinguishing which of the three an external url came from, and db:server-database's own summary cannot be decomposed back into its parts. Writing the url as the connection's one reference asserts exactly what the inventory asserts by carrying it, and nothing more. A connection of either type with NO url is refused by name -- there is no reference to write.
export interface OdbWriteOptions {
  // The ODF version stamped on content.xml and on the manifest. Defaults to the current standard, matching every other writer's own option.
  readonly version?: string;
}

function writeConnection(connection: OdbConnectionInfo): XmlElement {
  if (connection.url === undefined) {
    throw new Error(
      `writeOdb: a${connection.type === "embedded" ? "n embedded" : "n external"} connection carries no url -- there is no connection reference to write into db:connection-resource`,
    );
  }
  return el("db:data-source", {}, [
    el("db:connection-data", {}, [
      el("db:connection-resource", {
        "xlink:href": encodeXmlText(connection.url),
        "xlink:type": "simple",
      }),
    ]),
  ]);
}

function writeComponent(component: OdbComponentInfo): XmlElement {
  const attributes: Record<string, string> = {
    "db:name": encodeXmlText(component.name),
    "xlink:href": encodeXmlText(component.href),
    "xlink:type": "simple",
  };
  if (component.asTemplate !== undefined) {
    attributes["db:as-template"] = component.asTemplate ? "true" : "false";
  }
  return el("db:component", attributes);
}

function writeQuery(query: OdbQueryInfo): XmlElement {
  const attributes: Record<string, string> = {
    "db:name": encodeXmlText(query.name),
    "db:command": encodeXmlText(query.command),
  };
  if (query.escapeProcessing !== undefined) {
    attributes["db:escape-processing"] = query.escapeProcessing
      ? "true"
      : "false";
  }
  return el("db:query", attributes);
}

// A table NAME writes through the lighter of the two channels readTableNames reads: db:table-representations carries a user's saved display customisation for a table and nothing about its schema, so writing name-only entries there claims the least -- db:schema-definition would assert a flat-file schema definition for tables that may belong to a real engine.
function writeTables(tables: readonly string[]): XmlElement {
  return el(
    "db:table-representations",
    {},
    tables.map((name) =>
      el("db:table-representation", { "db:name": encodeXmlText(name) }),
    ),
  );
}

export function writeOdb(
  inventory: OdbInventory,
  options: OdbWriteOptions = {},
): Package {
  const version = options.version ?? DEFAULT_ODF_VERSION;
  const children: XmlElement[] = [];
  if (inventory.connection !== undefined) {
    children.push(writeConnection(inventory.connection));
  }
  if (inventory.forms.length > 0) {
    children.push(el("db:forms", {}, inventory.forms.map(writeComponent)));
  }
  if (inventory.reports.length > 0) {
    children.push(el("db:reports", {}, inventory.reports.map(writeComponent)));
  }
  if (inventory.queries.length > 0) {
    children.push(el("db:queries", {}, inventory.queries.map(writeQuery)));
  }
  if (inventory.tables.length > 0) {
    children.push(writeTables(inventory.tables));
  }
  const pkg = createOdfPackage(
    ODF_MEDIA_TYPES.odb,
    el("office:database", {}, children),
    version,
  );
  syncManifest(pkg, { version });
  return pkg;
}
