import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import { decodePackage, encodePackage } from "../../codec";
import { readMimetype } from "../../mimetype";
import { validateManifest } from "../../manifest";
import { parsePackage } from "../../package-io/read";
import { readOdbInventory } from "./read";
import type { OdbInventory } from "./read";
import { writeOdb } from "./write";

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
});
