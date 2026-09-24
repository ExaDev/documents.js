import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { parsePackage } from "../../package-io/read";
import { readOdbInventory, resolveOdbComponent } from "./read";
import type { OdbInventory } from "./read";

// This suite reads TWO real, unmodified LibreOffice 26.2-generated .odb fixtures for its genuine-producer-shape assertions, mirroring readOdtContent's and readOdm's own established convention: src/typed/odb/fixtures/embedded-firebird.odb (an embedded-Firebird database document with two live SQL tables and one real query, and deliberately no forms or reports), and src/typed/odb/fixtures/form-and-report.odb (the same engine, plus a real bound form and a real Report Builder report — see read.ts's own top-of-file note for how it was generated and for the two findings about real form/report registration it produced). A handful of synthetic, hand-built packages (via el/txt) cover shapes neither real fixture exercises — an external connection, the two defensive db:database-description variants (never empirically observed), and the db:component-collection grouping and malformed-component paths.

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

function databaseContentPart(databaseChildren: readonly XmlNode[]) {
  return {
    kind: "xml" as const,
    nodes: [
      el("office:document-content", {}, [
        el("office:body", {}, [el("office:database", {}, databaseChildren)]),
      ]),
    ],
  };
}

function manifestPart(
  entries: readonly { fullPath: string; mediaType: string }[],
) {
  const fileEntries = entries.map((entry) =>
    el("manifest:file-entry", {
      "manifest:full-path": entry.fullPath,
      "manifest:media-type": entry.mediaType,
    }),
  );
  return {
    kind: "xml" as const,
    nodes: [
      el("manifest:manifest", { "manifest:version": "1.3" }, fileEntries),
    ],
  };
}

const BASE_MANIFEST_ENTRIES = [
  { fullPath: "/", mediaType: "application/vnd.oasis.opendocument.base" },
  { fullPath: "content.xml", mediaType: "text/xml" },
];

describe("readOdbInventory: embedded-firebird.odb (real LibreOffice output)", () => {
  // Recomputed in beforeEach, not read once at describe-body scope: a describe-body call runs exactly once during Vitest's collection phase, before any individual test executes, which makes Stryker's per-test coverage analysis treat readOdbInventory's own mutants as "static" (unkillable by any single it()) rather than attributing them to the test that actually exercises the resulting assertion.
  let inventory: OdbInventory;
  beforeEach(() => {
    inventory = readOdbInventory(loadFixture("embedded-firebird.odb"));
  });

  it('reads the real embedded connection info — an "sdbc:embedded:" href classifies as embedded', () => {
    expect(inventory.connection).toEqual({
      type: "embedded",
      url: "sdbc:embedded:firebird",
    });
  });

  it("never populates driverClass — ODF has no driver-class-equivalent attribute anywhere in its db: schema", () => {
    expect("driverClass" in (inventory.connection ?? {})).toBe(false);
  });

  it("reads the one real query, including its db:command SQL text", () => {
    expect(inventory.queries).toEqual([
      { name: "CustomerList", command: 'SELECT * FROM "Customers"' },
    ]);
  });

  it("reads an honestly empty tables array — the two real tables (Customers, Orders) exist only inside the live Firebird engine, invisible to the ODF package itself", () => {
    expect(inventory.tables).toEqual([]);
  });

  it("reads empty forms/reports — none were created in this fixture", () => {
    expect(inventory.forms).toEqual([]);
    expect(inventory.reports).toEqual([]);
  });
});

describe("readOdbInventory: form-and-report.odb (real LibreOffice output)", () => {
  // See the identical beforeEach note on the embedded-firebird.odb describe above.
  let inventory: OdbInventory;
  beforeEach(() => {
    inventory = readOdbInventory(loadFixture("form-and-report.odb"));
  });

  it("reads the form's real user-visible name alongside its opaque persistent storage path — the two genuinely differ in real output", () => {
    expect(inventory.forms).toEqual([
      { name: "SalesForm", href: "forms/Obj11", asTemplate: false },
    ]);
  });

  it("reads the report the same way, whose persistent name collides with the form's because the counter is per-container", () => {
    expect(inventory.reports).toEqual([
      { name: "SalesByRegion", href: "reports/Obj11", asTemplate: false },
    ]);
  });

  it("reads the real saved query with its full WHERE/ORDER BY SQL text", () => {
    expect(inventory.queries).toEqual([
      {
        name: "HighValueSales",
        command:
          'SELECT "SALES"."REGION", "SALES"."QUARTER", "SALES"."CUSTOMER", "SALES"."AMOUNT" FROM "SALES" WHERE "SALES"."AMOUNT" >= 100 ORDER BY "SALES"."REGION" ASC, "SALES"."QUARTER" ASC, "SALES"."AMOUNT" DESC',
      },
    ]);
  });

  it("still reads an honestly empty tables array — the real SALES table lives only inside the Firebird engine", () => {
    expect(inventory.tables).toEqual([]);
  });
});

describe("resolveOdbComponent", () => {
  const pkg = loadFixture("form-and-report.odb");

  it("resolves a form and a report by their own user-visible names", () => {
    expect(resolveOdbComponent(pkg, "form", "SalesForm").href).toBe(
      "forms/Obj11",
    );
    expect(resolveOdbComponent(pkg, "report", "SalesByRegion").href).toBe(
      "reports/Obj11",
    );
  });

  it("throws naming every available component when the name does not resolve", () => {
    expect(() => resolveOdbComponent(pkg, "form", "Nope")).toThrow(
      /no form named "Nope".*SalesForm/,
    );
  });

  it("never resolves a form name through the reports container, or the reverse", () => {
    expect(() => resolveOdbComponent(pkg, "report", "SalesForm")).toThrow(
      /no report named "SalesForm"/,
    );
  });

  it('names the available list as "(none)" rather than a bare empty string when the .odb declares no component of that kind at all', () => {
    const emptyPkg: Package = {
      parts: {
        "content.xml": databaseContentPart([]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => resolveOdbComponent(emptyPkg, "form", "Anything")).toThrow(
      /no form named "Anything" — available: \(none\)/,
    );
  });

  it("joins two or more available names with a comma and a space, not concatenated bare", () => {
    const twoFormsPkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:forms", {}, [
            el("db:component", {
              "db:name": "First",
              "xlink:href": "forms/Obj1",
            }),
            el("db:component", {
              "db:name": "Second",
              "xlink:href": "forms/Obj2",
            }),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(() => resolveOdbComponent(twoFormsPkg, "form", "Nope")).toThrow(
      'no form named "Nope" — available: First, Second',
    );
  });
});

describe("readOdbInventory: synthetic fully-populated embedded package", () => {
  const pkg: Package = {
    parts: {
      "content.xml": databaseContentPart([
        el("db:data-source", {}, [
          el("db:connection-data", {}, [
            el("db:connection-resource", {
              "xlink:href": "sdbc:embedded:hsqldb",
              "xlink:type": "simple",
            }),
          ]),
        ]),
        el("db:queries", {}, [
          el("db:query", {
            "db:name": "Q1",
            "db:command": 'SELECT * FROM "Customers"',
          }),
          el("db:query-collection", { "db:name": "Group1" }, [
            el("db:query", {
              "db:name": "Q2",
              "db:command": 'SELECT * FROM "Orders"',
            }),
          ]),
        ]),
        el("db:table-representations", {}, [
          el("db:table-representation", { "db:name": "Customers" }),
          el("db:table-representation", { "db:name": "Orders" }),
        ]),
        el("db:forms", {}, [
          el("db:component", {
            "db:name": "Form1",
            "xlink:href": "forms/Obj12",
            "xlink:type": "simple",
            "db:as-template": "false",
          }),
          el("db:component-collection", { "db:name": "Admin" }, [
            el("db:component", {
              "db:name": "Form2",
              "xlink:href": "forms/Obj15",
            }),
          ]),
        ]),
        el("db:reports", {}, [
          el("db:component", {
            "db:name": "Report1",
            "xlink:href": "reports/Obj9",
            "db:as-template": "true",
          }),
        ]),
      ]),
      "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
    },
  };
  // See the identical beforeEach note on the embedded-firebird.odb describe above.
  let inventory: OdbInventory;
  beforeEach(() => {
    inventory = readOdbInventory(pkg);
  });

  it("reads db:connection-resource", () => {
    expect(inventory.connection).toEqual({
      type: "embedded",
      url: "sdbc:embedded:hsqldb",
    });
  });

  it("reads both top-level and nested db:query-collection query definitions, in document order, without including the collection's own name", () => {
    expect(inventory.queries).toEqual([
      { name: "Q1", command: 'SELECT * FROM "Customers"' },
      { name: "Q2", command: 'SELECT * FROM "Orders"' },
    ]);
  });

  it("reads table names from db:table-representations, deduplicated and in document order", () => {
    expect(inventory.tables).toEqual(["Customers", "Orders"]);
  });

  it("reads both top-level and db:component-collection-nested form components, in document order, without including the collection's own name", () => {
    expect(inventory.forms).toEqual([
      { name: "Form1", href: "forms/Obj12", asTemplate: false },
      { name: "Form2", href: "forms/Obj15" },
    ]);
  });

  it("reads db:as-template as a real boolean, and omits the field entirely when the component declares none", () => {
    expect(inventory.reports).toEqual([
      { name: "Report1", href: "reports/Obj9", asTemplate: true },
    ]);
    expect("asTemplate" in (inventory.forms[1] ?? {})).toBe(false);
  });
});

describe("readOdbInventory: table names from db:schema-definition", () => {
  it("reads db:schema-definition/db:table-definitions table names alongside db:table-representations, deduplicating a name the two sources share", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:table-representations", {}, [
            el("db:table-representation", { "db:name": "Customers" }),
            el("db:table-representation", { "db:name": "Orders" }),
          ]),
          el("db:schema-definition", {}, [
            el("db:table-definitions", {}, [
              // "Orders" is the same table db:table-representations already named above — it must appear once in the result, proving the reader actually deduplicates across the two sources rather than merely happening not to repeat within one of them.
              el("db:table-definition", { "db:name": "Orders" }),
              el("db:table-definition", { "db:name": "Invoices" }),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).tables).toEqual([
      "Customers",
      "Orders",
      "Invoices",
    ]);
  });

  it("reads no table names when office:database has a db:schema-definition with no db:table-definitions child", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:schema-definition", {}, []),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).tables).toEqual([]);
  });
});

describe("readOdbInventory: query definitions", () => {
  it("reads db:escape-processing when present, as a real boolean, and omits the field entirely when absent", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:queries", {}, [
            el("db:query", {
              "db:name": "WithFlag",
              "db:command": "SELECT 1",
              "db:escape-processing": "true",
            }),
            el("db:query", { "db:name": "NoFlag", "db:command": "SELECT 2" }),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    const inventory = readOdbInventory(pkg);
    expect(inventory.queries).toEqual([
      { name: "WithFlag", command: "SELECT 1", escapeProcessing: true },
      { name: "NoFlag", command: "SELECT 2" },
    ]);
    expect("escapeProcessing" in (inventory.queries[1] ?? {})).toBe(false);
  });

  it('reads db:escape-processing="false" as a real false, distinguishing it from a bare string comparison against the wrong literal', () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:queries", {}, [
            el("db:query", {
              "db:name": "Disabled",
              "db:command": "SELECT 1",
              "db:escape-processing": "false",
            }),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).queries).toEqual([
      { name: "Disabled", command: "SELECT 1", escapeProcessing: false },
    ]);
  });

  it("skips a db:query missing its mandatory db:command rather than returning it half-populated", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:queries", {}, [el("db:query", { "db:name": "Broken" })]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).queries).toEqual([]);
  });

  it("never descends into a stray child that is neither db:query nor db:query-collection, even when it happens to carry a nested db:query of its own", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:queries", {}, [
            el("db:not-a-collection", {}, [
              el("db:query", {
                "db:name": "Hidden",
                "db:command": "SELECT 1",
              }),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).queries).toEqual([]);
  });
});

describe("readOdbInventory: external datasource", () => {
  it('classifies a non-"sdbc:embedded:" db:connection-resource href as external, with empty tables/queries/forms/reports', () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:connection-resource", {
                "xlink:href":
                  "sdbc:mysql:jdbc://dbhost.example.com:3306/salesdb",
                "xlink:type": "simple",
              }),
              el("db:login", {
                "db:user-name": "sales_reader",
                "db:is-password-required": "true",
              }),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    const inventory = readOdbInventory(pkg);
    expect(inventory.connection).toEqual({
      type: "external",
      url: "sdbc:mysql:jdbc://dbhost.example.com:3306/salesdb",
    });
    expect(inventory.tables).toEqual([]);
    expect(inventory.queries).toEqual([]);
    expect(inventory.forms).toEqual([]);
    expect(inventory.reports).toEqual([]);
  });

  it("never surfaces db:login credentials — OdbInventory has no field for them", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:connection-resource", {
                "xlink:href":
                  "sdbc:mysql:jdbc://dbhost.example.com:3306/salesdb",
                "xlink:type": "simple",
              }),
              el("db:login", { "db:user-name": "sales_reader" }),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    const inventory = readOdbInventory(pkg);
    expect(inventory).not.toHaveProperty("login");
    expect(inventory.connection).not.toHaveProperty("userName");
  });
});

describe("readOdbInventory: db:database-description variants (RNG-derived, never empirically observed — see read.ts's own top-of-file note)", () => {
  it("formats a db:server-database (hostname+port) into a descriptive url", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:database-description", {}, [
                el("db:server-database", {
                  "db:type": "mysql",
                  "db:hostname": "db.example.com",
                  "db:port": "3306",
                  "db:database-name": "salesdb",
                }),
              ]),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toEqual({
      type: "external",
      url: "mysql://db.example.com:3306/salesdb",
    });
  });

  it("formats a db:server-database (local socket, no database name) into a descriptive url", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:database-description", {}, [
                el("db:server-database", {
                  "db:type": "postgresql",
                  "db:local-socket-name": "/var/run/postgresql/.s.PGSQL.5432",
                }),
              ]),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toEqual({
      type: "external",
      url: "postgresql:///var/run/postgresql/.s.PGSQL.5432",
    });
  });

  it("treats a db:server-database with no db:type as a bare external connection with no url", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:database-description", {}, [
                el("db:server-database", {
                  "db:hostname": "db.example.com",
                  "db:port": "3306",
                  "db:database-name": "salesdb",
                }),
              ]),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    // toStrictEqual, not toEqual: readConnectionInfo's own ternary either omits `url` entirely or sets it to a real string — it never sets the key to a literal `undefined`. toEqual treats an `undefined`-valued property as equivalent to an absent one, so it cannot tell those two shapes apart; toStrictEqual can, and is what actually proves the key is genuinely missing.
    expect(readOdbInventory(pkg).connection).toStrictEqual({
      type: "external",
    });
  });

  it("formats a db:server-database (hostname, no port) into a descriptive url with no port suffix", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:database-description", {}, [
                el("db:server-database", {
                  "db:type": "mysql",
                  "db:hostname": "db.example.com",
                  "db:database-name": "salesdb",
                }),
              ]),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toEqual({
      type: "external",
      url: "mysql://db.example.com/salesdb",
    });
  });

  it("formats a db:server-database with neither a hostname nor a local socket name (only a database name) into a bare scheme-and-name url", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:database-description", {}, [
                el("db:server-database", {
                  "db:type": "mysql",
                  "db:database-name": "salesdb",
                }),
              ]),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toEqual({
      type: "external",
      url: "mysql:///salesdb",
    });
  });

  it("formats a db:server-database with neither a hostname/local-socket-name nor a database name into a bare scheme url", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:database-description", {}, [
                el("db:server-database", { "db:type": "mysql" }),
              ]),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toEqual({
      type: "external",
      url: "mysql://",
    });
  });

  it("reads a db:file-based-database href as an external connection", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:database-description", {}, [
                el("db:file-based-database", {
                  "xlink:href": "../data/",
                  "xlink:type": "simple",
                  "db:media-type":
                    "application/vnd.oasis.opendocument.spreadsheet",
                }),
              ]),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toEqual({
      type: "external",
      url: "../data/",
    });
  });

  it("treats a db:file-based-database with no xlink:href as a bare external connection with no url", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [
            el("db:connection-data", {}, [
              el("db:database-description", {}, [
                el("db:file-based-database", {
                  "db:media-type":
                    "application/vnd.oasis.opendocument.spreadsheet",
                }),
              ]),
            ]),
          ]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    // toStrictEqual: see the "no db:type" test above for why toEqual cannot prove `url` is absent rather than merely undefined.
    expect(readOdbInventory(pkg).connection).toStrictEqual({
      type: "external",
    });
  });
});

describe("readOdbInventory: malformed db:component handling", () => {
  function formsInventory(children: readonly XmlNode[]) {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([el("db:forms", {}, children)]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    return readOdbInventory(pkg).forms;
  }

  it("skips a db:component missing either of its mandatory db:name / xlink:href attributes rather than returning it half-populated", () => {
    expect(
      formsInventory([
        el("db:component", { "db:name": "NoHref" }),
        el("db:component", { "xlink:href": "forms/Obj1" }),
        el("db:component", { "db:name": "Good", "xlink:href": "forms/Obj2" }),
      ]),
    ).toEqual([{ name: "Good", href: "forms/Obj2" }]);
  });

  it("trims a trailing slash from an href so a caller always sees one canonical path shape", () => {
    expect(
      formsInventory([
        el("db:component", {
          "db:name": "Slashed",
          "xlink:href": "forms/Obj3/",
        }),
      ]),
    ).toEqual([{ name: "Slashed", href: "forms/Obj3" }]);
  });

  it("skips a db:component whose href is empty (or nothing but a slash)", () => {
    expect(
      formsInventory([
        el("db:component", { "db:name": "Empty", "xlink:href": "/" }),
      ]),
    ).toEqual([]);
  });

  it("entity-decodes a component name and href, matching how db:command is already treated", () => {
    expect(
      formsInventory([
        el("db:component", {
          "db:name": "Sales &amp; Marketing",
          "xlink:href": "forms/A&amp;B",
        }),
      ]),
    ).toEqual([{ name: "Sales & Marketing", href: "forms/A&B" }]);
  });

  it("skips a stray child that is neither db:component nor db:component-collection, rather than misreading it as one", () => {
    expect(
      formsInventory([
        el("db:desc", {}, [txt("Not a real component.")]),
        el("db:component", { "db:name": "Good", "xlink:href": "forms/Obj4" }),
      ]),
    ).toEqual([{ name: "Good", href: "forms/Obj4" }]);
  });

  it("skips a stray child tag even when it coincidentally carries a well-formed db:name and xlink:href of its own", () => {
    expect(
      formsInventory([
        el("db:not-a-component", {
          "db:name": "Sneaky",
          "xlink:href": "forms/ObjSneaky",
        }),
        el("db:component", { "db:name": "Good", "xlink:href": "forms/Obj5" }),
      ]),
    ).toEqual([{ name: "Good", href: "forms/Obj5" }]);
  });
});

describe("readOdbInventory: scope boundaries and error paths", () => {
  it("throws when the package has no content.xml part at all", () => {
    expect(() => readOdbInventory({ parts: {} })).toThrow(/content\.xml/);
  });

  it("throws when content.xml is not an XML part", () => {
    const pkg: Package = {
      parts: { "content.xml": { kind: "binary", base64: "" } },
    };
    expect(() => readOdbInventory(pkg)).toThrow(/content\.xml/);
  });

  it("throws when content.xml has no office:body/office:database element — e.g. an odt-shaped content.xml", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [
              el("office:body", {}, [el("office:text")]),
            ]),
          ],
        },
      },
    };
    expect(() => readOdbInventory(pkg)).toThrow(/office:database/);
  });

  it("reads connection as undefined when office:database has no db:data-source/db:connection-data at all, without throwing", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    const inventory = readOdbInventory(pkg);
    expect(inventory.connection).toBeUndefined();
    expect(inventory.tables).toEqual([]);
    expect(inventory.queries).toEqual([]);
    expect(inventory.forms).toEqual([]);
    expect(inventory.reports).toEqual([]);
  });

  it("reads connection as undefined when db:connection-data has neither db:connection-resource nor db:database-description", () => {
    const pkg: Package = {
      parts: {
        "content.xml": databaseContentPart([
          el("db:data-source", {}, [el("db:connection-data", {}, [txt("")])]),
        ]),
        "META-INF/manifest.xml": manifestPart(BASE_MANIFEST_ENTRIES),
      },
    };
    expect(readOdbInventory(pkg).connection).toBeUndefined();
  });
});
