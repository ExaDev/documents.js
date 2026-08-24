import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import { el } from "../../xml/fragment";
import { parsePackage } from "../../package-io/read";
import { readOdtContent } from "../odt/read";
import { subDocumentPackage } from "./subdocument";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadFixture(name: string): Package {
  const bytes = new Uint8Array(readFileSync(join(FIXTURES_DIR, name)));
  return parsePackage(bytes);
}

describe("subDocumentPackage", () => {
  it("re-keys a real .odb form sub-document into a Package readOdtContent accepts unmodified", () => {
    const sub = subDocumentPackage(
      loadFixture("form-and-report.odb"),
      "forms/Obj11",
    );
    // "Configurations2/" is a genuine zero-length zip DIRECTORY entry real LibreOffice writes into a form sub-document, surfaced as a part like any other -- re-keyed here rather than filtered out, since deciding what is "really" a part is the package reader's own concern, not this helper's.
    expect(Object.keys(sub.parts).sort()).toEqual([
      "Configurations2/",
      "content.xml",
      "manifest.rdf",
      "settings.xml",
      "styles.xml",
    ]);
    expect(readOdtContent(sub).sections).toHaveLength(1);
  });

  it("accepts a prefix with or without a trailing slash, producing the identical result", () => {
    const pkg = loadFixture("form-and-report.odb");
    expect(
      Object.keys(subDocumentPackage(pkg, "reports/Obj11").parts).sort(),
    ).toEqual(
      Object.keys(subDocumentPackage(pkg, "reports/Obj11/").parts).sort(),
    );
  });

  it("carries over nothing outside the prefix -- most of all NOT the outer package's own manifest, whose paths are outer-relative", () => {
    const sub = subDocumentPackage(
      loadFixture("form-and-report.odb"),
      "reports/Obj11",
    );
    expect(sub.parts["META-INF/manifest.xml"]).toBeUndefined();
    expect(sub.parts["database/firebird.fbk"]).toBeUndefined();
    expect(sub.parts["forms/Obj11/content.xml"]).toBeUndefined();
  });

  it("preserves nested paths beneath the prefix, relative to it", () => {
    const pkg: Package = {
      parts: {
        "forms/Obj1/content.xml": {
          kind: "xml",
          nodes: [el("office:document-content")],
        },
        "forms/Obj1/Pictures/logo.png": { kind: "binary", base64: "AA==" },
      },
    };
    expect(
      Object.keys(subDocumentPackage(pkg, "forms/Obj1").parts).sort(),
    ).toEqual(["Pictures/logo.png", "content.xml"]);
  });

  it("shares the same Part values rather than deep-copying them", () => {
    const part = { kind: "binary" as const, base64: "AA==" };
    const pkg: Package = {
      parts: {
        "forms/Obj1/content.xml": { kind: "xml", nodes: [] },
        "forms/Obj1/data.bin": part,
      },
    };
    expect(subDocumentPackage(pkg, "forms/Obj1").parts["data.bin"]).toBe(part);
  });

  it("throws when the prefix holds no content.xml, since a sub-document reference with no content is broken rather than salvageable", () => {
    const pkg: Package = {
      parts: { "forms/Obj1/styles.xml": { kind: "xml", nodes: [] } },
    };
    expect(() => subDocumentPackage(pkg, "forms/Obj1")).toThrow(
      /forms\/Obj1\/content\.xml/,
    );
  });

  it("returns the (possibly empty) package anyway when allowMissingContent is set", () => {
    const pkg: Package = {
      parts: { "forms/Obj1/styles.xml": { kind: "xml", nodes: [] } },
    };
    expect(
      Object.keys(
        subDocumentPackage(pkg, "forms/Obj1", { allowMissingContent: true })
          .parts,
      ),
    ).toEqual(["styles.xml"]);
    expect(
      subDocumentPackage(pkg, "nothing/here", { allowMissingContent: true })
        .parts,
    ).toEqual({});
  });

  it("never mistakes a sibling path that merely shares a name prefix for part of the sub-document", () => {
    const pkg: Package = {
      parts: {
        "forms/Obj1/content.xml": { kind: "xml", nodes: [] },
        "forms/Obj10/content.xml": { kind: "xml", nodes: [] },
      },
    };
    expect(Object.keys(subDocumentPackage(pkg, "forms/Obj1").parts)).toEqual([
      "content.xml",
    ]);
  });
});
