import type { Package, XmlNode } from "odf.js";
import { bytesToBase64, decodePackage, el } from "odf.js";
import { describe, expect, it } from "vitest";
import { HsqldbScriptParseError } from "../hsqldb/script";
import { RICH_FIXTURE_FBK_BASE64 } from "../test-support/firebird";
import {
  embeddedHsqldbBinaryScriptOdbBytes,
  embeddedHsqldbCompressedScriptOdbBytes,
  embeddedHsqldbMultiIndexOdbBytes,
} from "../test-support/odb";
import {
  OdbNoEmbeddedDataSourceError,
  OdbUnsupportedFormatError,
  readOdbTables,
} from "./read";

// Mirrors odf.js's own src/typed/odb/read.test.ts fixture-building style (databaseContentPart/manifestPart) -- readOdbTables sits directly on top of readOdbInventory, so its own tests build the identical minimal Package shape rather than a real .odb file. src/convert/odb.test.ts covers the genuine byte-level odbToXlsx/odbToCsv round trip separately.

function databaseContentPart(
  databaseChildren: XmlNode[],
): Package["parts"][string] {
  return {
    kind: "xml",
    nodes: [
      el("office:document-content", {}, [
        el("office:body", {}, [el("office:database", {}, databaseChildren)]),
      ]),
    ],
  };
}

function manifestPart(
  entries: readonly { readonly fullPath: string; readonly mediaType: string }[],
): Package["parts"][string] {
  const fileEntries = entries.map((entry) =>
    el("manifest:file-entry", {
      "manifest:full-path": entry.fullPath,
      "manifest:media-type": entry.mediaType,
    }),
  );
  return {
    kind: "xml",
    nodes: [
      el("manifest:manifest", { "manifest:version": "1.3" }, fileEntries),
    ],
  };
}

const BASE_MANIFEST_ENTRIES = [
  { fullPath: "/", mediaType: "application/vnd.oasis.opendocument.base" },
  { fullPath: "content.xml", mediaType: "text/xml" },
];

function connectionResource(href: string): XmlNode {
  return el("db:data-source", {}, [
    el("db:connection-data", {}, [
      el("db:connection-resource", {
        "xlink:href": href,
        "xlink:type": "simple",
      }),
    ]),
  ]);
}

const HSQLDB_SCRIPT = [
  "CREATE MEMORY TABLE T(A INTEGER,B VARCHAR(10))",
  "INSERT INTO T VALUES(1,'x')",
].join("\n");

function binaryPart(text: string): Package["parts"][string] {
  return {
    kind: "binary",
    base64: bytesToBase64(new TextEncoder().encode(text)),
  };
}

// Narrows a thrown OdbUnsupportedFormatError's own `format` field without a type assertion -- `instanceof` inside a catch block is a genuine type guard, unlike casting whatever expect().toBeInstanceOf() was given.
function formatOfThrownError(
  fn: () => unknown,
): OdbUnsupportedFormatError["format"] {
  try {
    fn();
  } catch (error) {
    if (error instanceof OdbUnsupportedFormatError) {
      return error.format;
    }
    throw error;
  }
  throw new Error("expected fn() to throw");
}

describe("readOdbTables: embedded HSQLDB text script (happy path)", () => {
  it("routes to the Tier 1 parser and returns its tables", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource("sdbc:embedded:hsqldb"),
        ]),
        "META-INF/manifest.xml": manifestPart([
          ...BASE_MANIFEST_ENTRIES,
          { fullPath: "database/script", mediaType: "" },
        ]),
        "database/script": binaryPart(HSQLDB_SCRIPT),
      },
    };
    const tables = readOdbTables(pkg);
    expect(tables).toEqual([
      {
        tableName: "T",
        columns: [
          { name: "A", type: "INTEGER" },
          { name: "B", type: "VARCHAR(10)" },
        ],
        rows: [
          [
            { kind: "number", value: 1 },
            { kind: "string", value: "x" },
          ],
        ],
      },
    ]);
  });
});

describe("readOdbTables: no embedded data source", () => {
  it("throws OdbNoEmbeddedDataSourceError for an external MySQL connection", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource(
            "sdbc:mysql:jdbc://dbhost.example.com:3306/salesdb",
          ),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(OdbNoEmbeddedDataSourceError);
    expect(() => readOdbTables(pkg)).toThrow(/external datasource/);
  });

  it("throws OdbNoEmbeddedDataSourceError when office:database has no db:data-source at all", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(OdbNoEmbeddedDataSourceError);
  });
});

describe("readOdbTables: embedded Firebird gbak backup (Tier 3, happy path)", () => {
  it("routes to the Tier 3 Firebird reader and returns its tables, matching the real fixture field-by-field", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource("sdbc:embedded:firebird"),
        ]),
        "META-INF/manifest.xml": manifestPart([
          ...BASE_MANIFEST_ENTRIES,
          { fullPath: "database/firebird.fbk", mediaType: "" },
        ]),
        "database/firebird.fbk": {
          kind: "binary",
          base64: RICH_FIXTURE_FBK_BASE64,
        },
      },
    };
    const tables = readOdbTables(pkg);
    expect(tables.map((table) => table.tableName)).toEqual([
      "EMPLOYEES",
      "DEPARTMENTS",
    ]);
    const employees = tables.find((table) => table.tableName === "EMPLOYEES");
    expect(employees?.rows).toHaveLength(4);
  });
});

describe("readOdbTables: unsupported embedded formats -- named, never silent", () => {
  it("throws OdbUnsupportedFormatError naming an unrecognised embedded storage shape for an embedded Firebird connection with no database/firebird.fbk part at all", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource("sdbc:embedded:firebird"),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(OdbUnsupportedFormatError);
    expect(formatOfThrownError(() => readOdbTables(pkg))).toBe(
      "unrecognised-engine",
    );
  });

  it("throws OdbUnsupportedFormatError for an unrecognised embedded engine name", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource("sdbc:embedded:derby"),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(
      /embedded "derby" database engine/,
    );
  });

  it("throws OdbUnsupportedFormatError when an embedded HSQLDB connection has no database/script part at all", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource("sdbc:embedded:hsqldb"),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(/no database\/script part/);
  });
});

describe("readOdbTables: whole-script BINARY/COMPRESSED routing (Tier 4)", () => {
  // The same tables and rows in both, since the two fixtures are the same database written at hsqldb.script_format=1 and =3 -- see src/test-support/odb.ts.
  const EXPECTED_ROW_COUNTS = new Map([
    ["EMPLOYEES", 4],
    ["TYPE_TEST", 3],
    ["EMPTY_TABLE", 0],
  ]);

  it("decodes a real BINARY-format database/script end to end", () => {
    const tables = readOdbTables(
      decodePackage(embeddedHsqldbBinaryScriptOdbBytes()),
      { timeZone: "Europe/London" },
    );
    expect(
      new Map(tables.map((table) => [table.tableName, table.rows.length])),
    ).toEqual(EXPECTED_ROW_COUNTS);
    expect(
      tables.find((table) => table.tableName === "EMPLOYEES")?.rows[3],
    ).toEqual([
      { kind: "number", value: 4 },
      { kind: "string", value: "Carol O'Brien" },
      { kind: "number", value: 91000.1 },
      { kind: "date", value: "2021-11-30" },
      { kind: "boolean", value: true },
      { kind: "number", value: 3000.75 },
    ]);
  });

  it("decodes a real COMPRESSED-format database/script to exactly the same tables", () => {
    const options = { timeZone: "Europe/London" };
    expect(
      readOdbTables(
        decodePackage(embeddedHsqldbCompressedScriptOdbBytes()),
        options,
      ),
    ).toEqual(
      readOdbTables(
        decodePackage(embeddedHsqldbBinaryScriptOdbBytes()),
        options,
      ),
    );
  });
});

describe("readOdbTables: part-classification guard", () => {
  it("throws a distinct error when database/script is declared as an XML sub-document in the manifest", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource("sdbc:embedded:hsqldb"),
        ]),
        "META-INF/manifest.xml": manifestPart([
          ...BASE_MANIFEST_ENTRIES,
          { fullPath: "database/script", mediaType: "text/xml" },
        ]),
        "database/script": binaryPart(HSQLDB_SCRIPT),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(/declared as an XML sub-document/);
  });
});

describe("readOdbTables: propagates HsqldbScriptParseError for a genuinely malformed text script", () => {
  it("throws HsqldbScriptParseError, not a generic error, for an unrecognised statement", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource("sdbc:embedded:hsqldb"),
        ]),
        "META-INF/manifest.xml": manifestPart([
          ...BASE_MANIFEST_ENTRIES,
          { fullPath: "database/script", mediaType: "" },
        ]),
        "database/script": binaryPart("SELECT * FROM T"),
      },
    };
    expect(() => readOdbTables(pkg)).toThrow(HsqldbScriptParseError);
  });
});

// Tier 2 routing: readOdbTables' own database/data-triggered CACHED-table decoding, exercised here against a small, hand-built synthetic row -- src/hsqldb/cache.test.ts and src/convert/odb.test.ts cover the genuine byte-level round trip against a real HSQLDB 1.8.0.10-produced fixture; this describe block is purely about readOdbTables' own routing/error-handling around that decoder, matching this file's existing minimal-synthetic-package style.
describe("readOdbTables: CACHED-table routing (database/data present)", () => {
  // One CACHED table T(A INTEGER, B VARCHAR(5)), one row (A=42, B='hi'), root at file position 32 (right after a zero-filled 32-byte header this decoder never itself inspects) -- byte layout verified against real HSQLDB 1.8.0.10 output (see src/hsqldb/cache.ts's own module comment): [4-byte storageSize=32][16-byte AVL node, all zero][1-byte present-flag][4-byte int32 A=42][1-byte present-flag][4-byte int32 B-length=2]['h','i'].
  function syntheticCachedTableDataBytes(): Uint8Array<ArrayBuffer> {
    const bytes = new Uint8Array(64);
    const view = new DataView(bytes.buffer);
    view.setInt32(32, 32, false); // storageSize
    // bytes[36..51] (iBalance/iLeft/iRight/iParent) already zero.
    view.setUint8(52, 1);
    view.setInt32(53, 42, false);
    view.setUint8(57, 1);
    view.setInt32(58, 2, false);
    bytes[62] = "h".charCodeAt(0);
    bytes[63] = "i".charCodeAt(0);
    return bytes;
  }

  const SCRIPT = [
    "CREATE CACHED TABLE T(A INTEGER,B VARCHAR(5))",
    "SET TABLE T INDEX'32 0'",
  ].join("\n");
  const PROPERTIES = [
    "hsqldb.compatible_version=1.8.0",
    "hsqldb.cache_file_scale=1",
  ].join("\n");

  function pkgWithParts(parts: Package["parts"]): Package {
    return {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource("sdbc:embedded:hsqldb"),
        ]),
        "META-INF/manifest.xml": manifestPart([
          ...BASE_MANIFEST_ENTRIES,
          { fullPath: "database/script", mediaType: "" },
          { fullPath: "database/data", mediaType: "" },
          { fullPath: "database/properties", mediaType: "" },
        ]),
        "database/script": binaryPart(SCRIPT),
        ...parts,
      },
    };
  }

  it("decodes the CACHED table row from database/data when database/data and database/properties are both present", () => {
    const pkg = pkgWithParts({
      "database/data": {
        kind: "binary",
        base64: bytesToBase64(syntheticCachedTableDataBytes()),
      },
      "database/properties": binaryPart(PROPERTIES),
    });
    expect(readOdbTables(pkg)).toEqual([
      {
        tableName: "T",
        columns: [
          { name: "A", type: "INTEGER" },
          { name: "B", type: "VARCHAR(5)" },
        ],
        rows: [
          [
            { kind: "number", value: 42 },
            { kind: "string", value: "hi" },
          ],
        ],
      },
    ]);
  });

  it("leaves parseHsqldbScript's own result untouched when database/data is absent entirely", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          connectionResource("sdbc:embedded:hsqldb"),
        ]),
        "META-INF/manifest.xml": manifestPart([
          ...BASE_MANIFEST_ENTRIES,
          { fullPath: "database/script", mediaType: "" },
        ]),
        "database/script": binaryPart("CREATE MEMORY TABLE T(A INTEGER)"),
      },
    };
    expect(readOdbTables(pkg)).toEqual([
      { tableName: "T", columns: [{ name: "A", type: "INTEGER" }], rows: [] },
    ]);
  });

  it("throws a malformed-package Error when database/data is present but database/properties is not", () => {
    const pkg = pkgWithParts({
      "database/data": {
        kind: "binary",
        base64: bytesToBase64(syntheticCachedTableDataBytes()),
      },
    });
    expect(() => readOdbTables(pkg)).toThrow(/database\/properties/);
  });

  it("decodes a real multi-index CACHED-table .odb end to end (three-, two-, and single-index tables in one package)", () => {
    const tables = readOdbTables(
      decodePackage(embeddedHsqldbMultiIndexOdbBytes()),
    );
    const rowCounts = new Map(
      tables.map((table) => [table.tableName, table.rows.length]),
    );
    expect(rowCounts.get("ORDERS")).toBe(5);
    expect(rowCounts.get("SINGLE_IDX")).toBe(2);
    expect(rowCounts.get("NO_PK")).toBe(3);
    expect(
      tables.find((table) => table.tableName === "ORDERS")?.rows[3],
    ).toEqual([
      { kind: "number", value: 4 },
      { kind: "string", value: "A-004" },
      { kind: "string", value: "O'Connor Region" },
      { kind: "number", value: 0 },
      { kind: "date", value: "2023-12-25" },
      { kind: "boolean", value: true },
    ]);
  });
});
