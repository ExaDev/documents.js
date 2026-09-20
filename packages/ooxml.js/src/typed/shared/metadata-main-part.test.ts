import { describe, expect, it } from "vitest";
import type { Package, Part } from "../../model/package";
import { el, txt } from "../../xml/fragment";
import { rootElement } from "../util";
import {
  hasCoreProperties,
  patchCoreProperties,
  readCoreProperties,
} from "./metadata";

// A package whose metadata parts are not at docProps/core.xml and docProps/app.xml. OPC names both through relationships the package root declares, and the conventional paths are what every mainstream producer happens to use rather than what the format requires -- the same rule the main part follows (ExaDev/documents.js#1314, #1340).

const RELATIONSHIPS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const CORE_PROPERTIES_REL =
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";
const EXTENDED_PROPERTIES_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties";

interface RelationshipSpec {
  readonly id: string;
  readonly type: string;
  readonly target: string;
}

function relsPart(relationships: readonly RelationshipSpec[]): Part {
  return {
    kind: "xml",
    nodes: [
      el(
        "Relationships",
        { xmlns: RELATIONSHIPS_NS },
        relationships.map((rel) =>
          el("Relationship", {
            Id: rel.id,
            Type: rel.type,
            Target: rel.target,
          }),
        ),
      ),
    ],
  };
}

function corePart(title: string): Part {
  return {
    kind: "xml",
    nodes: [
      el(
        "cp:coreProperties",
        { "xmlns:dc": "http://purl.org/dc/elements/1.1/" },
        [
          el("dc:title", {}, [txt(title)]),
          el("dc:creator", {}, [txt("A Writer")]),
        ],
      ),
    ],
  };
}

function appPart(application: string): Part {
  return {
    kind: "xml",
    nodes: [el("Properties", {}, [el("Application", {}, [txt(application)])])],
  };
}

function renamedMetadataPackage(): Package {
  return {
    parts: {
      "_rels/.rels": relsPart([
        { id: "rId1", type: CORE_PROPERTIES_REL, target: "meta/core2.xml" },
        { id: "rId2", type: EXTENDED_PROPERTIES_REL, target: "/meta/app2.xml" },
      ]),
      "meta/core2.xml": corePart("Renamed properties"),
      "meta/app2.xml": appPart("Some Producer"),
    },
  };
}

describe("core properties named by the package's own root relationships", () => {
  it("reads core properties from the part the root relationship names", () => {
    expect(readCoreProperties(renamedMetadataPackage()).title).toBe(
      "Renamed properties",
    );
  });

  it("reads the originating application from the extended-properties part, resolved from the package root", () => {
    expect(readCoreProperties(renamedMetadataPackage()).creator).toBe(
      "Some Producer",
    );
  });

  it("reports the renamed part as present rather than looking only at the conventional path", () => {
    expect(hasCoreProperties(renamedMetadataPackage())).toBe(true);
  });

  it("patches the renamed part in place, leaving the conventional path uncreated", () => {
    const pkg = renamedMetadataPackage();
    patchCoreProperties(pkg, { title: "Patched" });
    expect(readCoreProperties(pkg).title).toBe("Patched");
    expect(Object.hasOwn(pkg.parts, "docProps/core.xml")).toBe(false);
    // The patch must land on the resolved part's own root element, not on a fresh part built beside it.
    const core = rootElement(pkg.parts["meta/core2.xml"]);
    expect(core?.children.length).toBeGreaterThan(0);
  });

  it("leaves everything else on the renamed part untouched while patching one field", () => {
    const pkg = renamedMetadataPackage();
    patchCoreProperties(pkg, { title: "Patched" });
    expect(readCoreProperties(pkg).author).toBe("A Writer");
  });

  it("names the resolved part when there is nothing there to patch", () => {
    const pkg: Package = {
      parts: {
        "_rels/.rels": relsPart([
          { id: "rId1", type: CORE_PROPERTIES_REL, target: "meta/core2.xml" },
        ]),
      },
    };
    // The relationship names a part the package does not hold, so resolution falls through to the conventional path, and the error says which part was actually looked for.
    expect(() => {
      patchCoreProperties(pkg, { title: "Patched" });
    }).toThrow(/docProps\/core\.xml/);
  });

  it("still reads the conventional paths for a package that declares no root relationships", () => {
    const pkg: Package = {
      parts: {
        "docProps/core.xml": corePart("Conventional"),
        "docProps/app.xml": appPart("Conventional Producer"),
      },
    };
    const metadata = readCoreProperties(pkg);
    expect(metadata.title).toBe("Conventional");
    expect(metadata.creator).toBe("Conventional Producer");
    expect(hasCoreProperties(pkg)).toBe(true);
  });
});
