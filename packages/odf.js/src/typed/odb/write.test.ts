import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { decodePackage, encodePackage } from "../../codec";
import { readMimetype } from "../../mimetype";
import { validateManifest } from "../../manifest";
import { parsePackage } from "../../package-io/read";
import { rootElement, childrenWithTag } from "../../xml/query";
import { attrValue } from "../../xml/query";
import { readManifest } from "../../manifest";
import { readOdbInventory } from "./read";
import type { OdbInventory } from "./read";
import { writeOdb } from "./write";

// Direct, one-sided structural checks against the raw written XML, alongside the round-trip suite below: a round trip (write then read back, compare to the original inventory) cannot observe a mutation that changes what gets WRITTEN in a way the reader's own inverse tolerates or a fixture never exercises (see typed/shared/canonicalise.ts's own top-of-file note on this exact failure mode) -- e.g. a fixture whose components all share one asTemplate value can't distinguish "always writes true" from "writes the real value".
function databaseElement(pkg: Package): XmlElement {
  const part = pkg.parts["content.xml"];
  if (part?.kind !== "xml") {
    throw new Error("expected an xml content.xml part");
  }
  const root = rootElement(part.nodes);
  if (root === undefined) {
    throw new Error("expected a root element");
  }
  const body = childrenWithTag(root, "office:body")[0];
  if (body === undefined) {
    throw new Error("expected an office:body element");
  }
  const database = childrenWithTag(body, "office:database")[0];
  if (database === undefined) {
    throw new Error("expected an office:database element");
  }
  return database;
}

function emptyInventory(): OdbInventory {
  return {
    connection: undefined,
    tables: [],
    queries: [],
    forms: [],
    reports: [],
  };
}

// attrValue itself requires a real XmlElement; every caller here reads an attribute off a `[n]` array-index result that is legitimately `XmlElement | undefined` under noUncheckedIndexedAccess, so this short-circuits the same way optional chaining does rather than asserting the element is present.
function attr(
  element: XmlElement | undefined,
  name: string,
): string | undefined {
  return element === undefined ? undefined : attrValue(element, name);
}

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): Package {
  return parsePackage(new Uint8Array(readFileSync(join(FIXTURES_DIR, name))));
}

describe("writeOdb", () => {
  it("round-trips the real form-and-report fixture's inventory through real bytes", () => {
    const source = loadFixture("form-and-report.odb");
    const inventory = readOdbInventory(source);
    expect(
      readOdbInventory(decodePackage(encodePackage(writeOdb(inventory)))),
    ).toEqual(inventory);
  });

  it("round-trips the real embedded-firebird fixture's inventory", () => {
    const source = loadFixture("embedded-firebird.odb");
    const inventory = readOdbInventory(source);
    expect(readOdbInventory(writeOdb(inventory))).toEqual(inventory);
  });

  it("writes the base media type and a manifest that validates clean", () => {
    const pkg = writeOdb(readOdbInventory(loadFixture("form-and-report.odb")));
    expect(readMimetype(pkg)).toBe("application/vnd.oasis.opendocument.base");
    expect(validateManifest(pkg)).toEqual([]);
  });

  it("round-trips an inventory with no connection, no components, and no queries at all", () => {
    const inventory = {
      connection: undefined,
      tables: ["Customers", "Orders"],
      queries: [],
      forms: [],
      reports: [],
    };
    expect(readOdbInventory(writeOdb(inventory))).toEqual(inventory);
  });

  it("round-trips an external connection through db:connection-resource, the one spelling the reader classifies from the url itself", () => {
    const inventory: OdbInventory = {
      connection: { type: "external", url: "../data/customers.ods" },
      tables: [],
      queries: [],
      forms: [],
      reports: [],
    };
    expect(readOdbInventory(writeOdb(inventory))).toEqual(inventory);
  });

  it("refuses a connection of either type with no url, by name", () => {
    expect(() =>
      writeOdb({
        connection: { type: "embedded" },
        tables: [],
        queries: [],
        forms: [],
        reports: [],
      }),
    ).toThrow(/no url/);
    expect(() =>
      writeOdb({
        connection: { type: "external" },
        tables: [],
        queries: [],
        forms: [],
        reports: [],
      }),
    ).toThrow(/no url/);
  });

  it("names the connection kind that carries no url in the thrown message", () => {
    expect(() =>
      writeOdb({
        ...emptyInventory(),
        connection: { type: "embedded" },
      }),
    ).toThrow(/an embedded connection/);
    expect(() =>
      writeOdb({
        ...emptyInventory(),
        connection: { type: "external" },
      }),
    ).toThrow(/an external connection/);
  });

  it("writes no db:forms/db:reports/db:queries/db:table-representations element at all when every list is empty", () => {
    const database = databaseElement(writeOdb(emptyInventory()));
    expect(childrenWithTag(database, "db:forms")).toHaveLength(0);
    expect(childrenWithTag(database, "db:reports")).toHaveLength(0);
    expect(childrenWithTag(database, "db:queries")).toHaveLength(0);
    expect(childrenWithTag(database, "db:table-representations")).toHaveLength(
      0,
    );
    expect(childrenWithTag(database, "db:data-source")).toHaveLength(0);
  });

  it("writes db:as-template only when the component actually states it, verbatim true or false", () => {
    const database = databaseElement(
      writeOdb({
        ...emptyInventory(),
        forms: [
          { name: "NoFlag", href: "forms/Obj1" },
          { name: "FlagTrue", href: "forms/Obj2", asTemplate: true },
          { name: "FlagFalse", href: "forms/Obj3", asTemplate: false },
        ],
      }),
    );
    const forms = childrenWithTag(database, "db:forms")[0];
    const components =
      forms === undefined ? [] : childrenWithTag(forms, "db:component");
    expect(attr(components[0], "db:as-template")).toBeUndefined();
    expect(attr(components[1], "db:as-template")).toBe("true");
    expect(attr(components[2], "db:as-template")).toBe("false");
  });

  it("writes db:escape-processing only when the query actually states it, verbatim true or false", () => {
    const database = databaseElement(
      writeOdb({
        ...emptyInventory(),
        queries: [
          { name: "NoFlag", command: "SELECT 1" },
          { name: "FlagTrue", command: "SELECT 1", escapeProcessing: true },
          { name: "FlagFalse", command: "SELECT 1", escapeProcessing: false },
        ],
      }),
    );
    const queries = childrenWithTag(database, "db:queries")[0];
    if (queries === undefined) {
      throw new Error("expected a db:queries element");
    }
    const writtenQueries = childrenWithTag(queries, "db:query");
    expect(attr(writtenQueries[0], "db:escape-processing")).toBeUndefined();
    expect(attr(writtenQueries[1], "db:escape-processing")).toBe("true");
    expect(attr(writtenQueries[2], "db:escape-processing")).toBe("false");
  });

  it("writes each table name as its own db:table-representation, in order", () => {
    const database = databaseElement(
      writeOdb({ ...emptyInventory(), tables: ["Customers", "Orders"] }),
    );
    const representations = childrenWithTag(
      database,
      "db:table-representations",
    )[0];
    if (representations === undefined) {
      throw new Error("expected a db:table-representations element");
    }
    const rows = childrenWithTag(representations, "db:table-representation");
    expect(rows.map((row) => attrValue(row, "db:name"))).toEqual([
      "Customers",
      "Orders",
    ]);
  });

  it("writes the connection's own url verbatim into db:connection-resource, regardless of connection type", () => {
    const database = databaseElement(
      writeOdb({
        ...emptyInventory(),
        connection: { type: "embedded", url: "sdbc:embedded:hsqldb" },
      }),
    );
    const dataSource = childrenWithTag(database, "db:data-source")[0];
    if (dataSource === undefined) {
      throw new Error("expected a db:data-source element");
    }
    const connectionData = childrenWithTag(dataSource, "db:connection-data")[0];
    const resource =
      connectionData === undefined
        ? undefined
        : childrenWithTag(connectionData, "db:connection-resource")[0];
    expect(attr(resource, "xlink:href")).toBe("sdbc:embedded:hsqldb");
  });

  it('writes xlink:type="simple" on both the connection resource and a component, not an empty string', () => {
    const database = databaseElement(
      writeOdb({
        ...emptyInventory(),
        connection: { type: "embedded", url: "sdbc:embedded:hsqldb" },
        forms: [{ name: "Form1", href: "forms/Obj1" }],
      }),
    );
    const dataSource = childrenWithTag(database, "db:data-source")[0];
    const connectionData =
      dataSource === undefined
        ? undefined
        : childrenWithTag(dataSource, "db:connection-data")[0];
    const resource =
      connectionData === undefined
        ? undefined
        : childrenWithTag(connectionData, "db:connection-resource")[0];
    expect(attr(resource, "xlink:type")).toBe("simple");
    const forms = childrenWithTag(database, "db:forms")[0];
    const component =
      forms === undefined
        ? undefined
        : childrenWithTag(forms, "db:component")[0];
    expect(attr(component, "xlink:type")).toBe("simple");
  });

  it("stamps a caller-supplied non-default version onto both content.xml's office:version and the manifest's own manifest:version, not silently falling back to the default for either", () => {
    const pkg = writeOdb(emptyInventory(), { version: "1.2" });
    const part = pkg.parts["content.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml content.xml part");
    }
    const root = rootElement(part.nodes);
    expect(attr(root, "office:version")).toBe("1.2");
    expect(readManifest(pkg).version).toBe("1.2");
  });
});
