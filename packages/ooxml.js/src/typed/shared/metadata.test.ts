import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { describe, expect, it } from "vitest";
import { buildXml } from "../../xml/build";
import { el, txt } from "../../xml/fragment";
import { rootElement } from "../util";
import {
  hasCoreProperties,
  patchCoreProperties,
  readCoreProperties,
} from "./metadata";

// Ported verbatim from documents.js's src/ooxml/core-properties.test.ts.

function packageWith(
  core: XmlElement | undefined,
  app: XmlElement | undefined,
): Package {
  const parts: Package["parts"] = {};
  if (core !== undefined) {
    parts["docProps/core.xml"] = { kind: "xml", nodes: [core] };
  }
  if (app !== undefined) {
    parts["docProps/app.xml"] = { kind: "xml", nodes: [app] };
  }
  return { parts };
}

describe("readCoreProperties", () => {
  it("reads title, subject, author, keywords, and dates from docProps/core.xml", () => {
    const core = el("cp:coreProperties", {}, [
      el("dc:title", {}, [txt("Quarterly Report")]),
      el("dc:subject", {}, [txt("Q3 Results")]),
      el("dc:creator", {}, [txt("Jane Doe")]),
      el("cp:keywords", {}, [txt("finance, quarterly, results")]),
      el("dcterms:created", {}, [txt("2024-01-01T00:00:00Z")]),
      el("dcterms:modified", {}, [txt("2024-02-01T00:00:00Z")]),
    ]);
    const metadata = readCoreProperties(packageWith(core, undefined));
    expect(metadata.title).toBe("Quarterly Report");
    expect(metadata.subject).toBe("Q3 Results");
    expect(metadata.author).toBe("Jane Doe");
    expect(metadata.keywords).toEqual(["finance", "quarterly", "results"]);
    expect(metadata.createdIso).toBe("2024-01-01T00:00:00Z");
    expect(metadata.modifiedIso).toBe("2024-02-01T00:00:00Z");
  });

  it("reads the originating application from docProps/app.xml into `creator`, distinct from dc:creator", () => {
    const core = el("cp:coreProperties", {}, [
      el("dc:creator", {}, [txt("Jane Doe")]),
    ]);
    const app = el("Properties", {}, [
      el("Application", {}, [txt("Microsoft Office PowerPoint")]),
    ]);
    const metadata = readCoreProperties(packageWith(core, app));
    expect(metadata.author).toBe("Jane Doe");
    expect(metadata.creator).toBe("Microsoft Office PowerPoint");
  });

  it("leaves fields undefined when the source parts or elements are missing, and never sets producer", () => {
    const metadata = readCoreProperties(packageWith(undefined, undefined));
    expect(metadata.title).toBeUndefined();
    expect(metadata.author).toBeUndefined();
    expect(metadata.creator).toBeUndefined();
    expect(metadata.keywords).toBeUndefined();
    expect("producer" in metadata).toBe(false);
  });

  it("treats an empty keywords element as no keywords rather than an array with one blank entry", () => {
    const core = el("cp:coreProperties", {}, [el("cp:keywords")]);
    const metadata = readCoreProperties(packageWith(core, undefined));
    expect(metadata.keywords).toBeUndefined();
  });
});

describe("hasCoreProperties", () => {
  it("is true once a real docProps/core.xml XML part exists", () => {
    const pkg = packageWith(el("cp:coreProperties"), undefined);
    expect(hasCoreProperties(pkg)).toBe(true);
  });

  it("is false when the package carries no docProps/core.xml part at all", () => {
    expect(hasCoreProperties(packageWith(undefined, undefined))).toBe(false);
  });

  it("is false when the path exists but is a binary part, not XML", () => {
    const pkg: Package = {
      parts: { "docProps/core.xml": { kind: "binary", base64: "" } },
    };
    expect(hasCoreProperties(pkg)).toBe(false);
  });
});

describe("patchCoreProperties", () => {
  function packageWithCore(children: XmlElement[]): Package {
    return packageWith(el("cp:coreProperties", {}, children), undefined);
  }

  it("replaces an existing element's text and leaves every other element untouched", () => {
    const pkg = packageWithCore([
      el("dc:title", {}, [txt("Old Title")]),
      el("dc:creator", {}, [txt("Jane Doe")]),
      el("dcterms:created", { "xsi:type": "dcterms:W3CDTF" }, [
        txt("2024-01-01T00:00:00Z"),
      ]),
    ]);

    patchCoreProperties(pkg, { title: "New Title" });

    const metadata = readCoreProperties(pkg);
    expect(metadata.title).toBe("New Title");
    // Untouched fields survive exactly as they were.
    expect(metadata.author).toBe("Jane Doe");
    expect(metadata.createdIso).toBe("2024-01-01T00:00:00Z");
  });

  it("creates an element that did not previously exist", () => {
    const pkg = packageWithCore([el("dc:creator", {}, [txt("Jane Doe")])]);

    patchCoreProperties(pkg, { title: "Brand New Title" });

    expect(readCoreProperties(pkg).title).toBe("Brand New Title");
    expect(readCoreProperties(pkg).author).toBe("Jane Doe");
  });

  it("XML-encodes a value written into a new or existing element", () => {
    const pkg = packageWithCore([]);
    patchCoreProperties(pkg, { title: "Q&A <draft>" });
    // Asserted against the raw serialized XML, not readCoreProperties: that reader decodes entities on the way back out, so raw and encoded storage are indistinguishable to it -- deleting the encoding call entirely would still leave readCoreProperties reporting "Q&A <draft>" and every test green. The serialized text is the only place a missing encoding call would actually show up (as unescaped '&'/'<'/'>' corrupting the XML).
    const part = pkg.parts["docProps/core.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const xml = buildXml(part.nodes);
    expect(xml).toContain("<dc:title>Q&amp;A &lt;draft&gt;</dc:title>");
    expect(xml).not.toContain("Q&A <draft>");
  });

  it("joins keywords with a comma and removes the element entirely for an empty array", () => {
    const pkg = packageWithCore([]);
    patchCoreProperties(pkg, { keywords: ["alpha", "beta"] });
    expect(readCoreProperties(pkg).keywords).toEqual(["alpha", "beta"]);

    patchCoreProperties(pkg, { keywords: [] });
    expect(readCoreProperties(pkg).keywords).toBeUndefined();
  });

  it("leaves every field untouched when overrides names none of them", () => {
    const pkg = packageWithCore([
      el("dc:title", {}, [txt("Untouched")]),
      el("dc:creator", {}, [txt("Jane Doe")]),
    ]);
    patchCoreProperties(pkg, {});
    expect(readCoreProperties(pkg).title).toBe("Untouched");
    expect(readCoreProperties(pkg).author).toBe("Jane Doe");
  });

  it("throws when the package has no docProps/core.xml part to patch", () => {
    const pkg = packageWith(undefined, undefined);
    expect(() => {
      patchCoreProperties(pkg, { title: "x" });
    }).toThrow(/no 'docProps\/core\.xml' XML part/);
  });

  // ExaDev/documents.js#1007 round 2: every core-properties child is optional, so a real producer writing only cp:keywords has no reason to ever declare the dc namespace -- a legally-minimal core.xml. Creating a dc-prefixed element into it without also declaring xmlns:dc would be a fatal namespace well-formedness error real consumers (Word, LibreOffice) reject outright.
  it("declares the dc namespace on the root when a patch creates the first dc-prefixed element in a core.xml that only ever bound cp", () => {
    const core = el(
      "cp:coreProperties",
      {
        "xmlns:cp":
          "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
      },
      [el("cp:keywords", {}, [txt("existing")])],
    );
    const pkg = packageWith(core, undefined);

    patchCoreProperties(pkg, { title: "New Title" });

    const part = pkg.parts["docProps/core.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const root = rootElement(part);
    if (root === undefined) {
      throw new Error("expected a root element");
    }
    expect(root.attributes).toContainEqual({
      name: "xmlns:dc",
      value: "http://purl.org/dc/elements/1.1/",
    });
    const xml = buildXml(part.nodes);
    expect(xml).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(xml).toContain("<dc:title>New Title</dc:title>");
  });

  // The mirror-image gap: a core.xml declaring only dc, patched with keywords (cp:), needs xmlns:cp declared.
  it("declares the cp namespace on the root when a patch creates the first cp-prefixed element in a core.xml that only ever bound dc", () => {
    const core = el(
      "cp:coreProperties",
      { "xmlns:dc": "http://purl.org/dc/elements/1.1/" },
      [el("dc:title", {}, [txt("Existing Title")])],
    );
    const pkg = packageWith(core, undefined);

    patchCoreProperties(pkg, { keywords: ["alpha", "beta"] });

    const part = pkg.parts["docProps/core.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const root = rootElement(part);
    if (root === undefined) {
      throw new Error("expected a root element");
    }
    expect(root.attributes).toContainEqual({
      name: "xmlns:cp",
      value:
        "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    });
    const xml = buildXml(part.nodes);
    expect(xml).toContain(
      'xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"',
    );
  });

  it("declares xmlns:dc only once when a patch creates two new dc-prefixed elements in the same call", () => {
    const pkg = packageWithCore([]);

    patchCoreProperties(pkg, { title: "A Title", author: "An Author" });

    const part = pkg.parts["docProps/core.xml"];
    if (part?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    const root = rootElement(part);
    if (root === undefined) {
      throw new Error("expected a root element");
    }
    expect(root.attributes.filter((a) => a.name === "xmlns:dc")).toHaveLength(
      1,
    );
  });

  it("does not add a namespace declaration when only replacing an existing element's text", () => {
    const core = el(
      "cp:coreProperties",
      {
        "xmlns:cp":
          "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
        "xmlns:dc": "http://purl.org/dc/elements/1.1/",
      },
      [el("dc:title", {}, [txt("Old Title")])],
    );
    const pkg = packageWith(core, undefined);
    const attributeCountBefore = (
      rootElement(pkg.parts["docProps/core.xml"])?.attributes ?? []
    ).length;

    patchCoreProperties(pkg, { title: "New Title" });

    const attributeCountAfter = (
      rootElement(pkg.parts["docProps/core.xml"])?.attributes ?? []
    ).length;
    expect(attributeCountAfter).toBe(attributeCountBefore);
  });
});
