import type { Package, XmlElement } from "odf.js";
import { readMimetype, rootElement } from "odf.js";
import { attr } from "ooxml.js";
import { describe, expect, it } from "vitest";
import { createEmptyOdsPackage } from "./scaffold";

function xmlRoot(pkg: Package, partName: string): XmlElement {
  const part = pkg.parts[partName];
  if (part?.kind !== "xml") {
    throw new Error(`expected ${partName} to be an xml part`);
  }
  const root = rootElement(part.nodes);
  if (root === undefined) {
    throw new Error(`expected a root element in ${partName}`);
  }
  return root;
}

function elementChildren(
  node: XmlElement | undefined,
  tag: string,
): XmlElement[] {
  if (node === undefined) {
    return [];
  }
  return node.children.filter(
    (c): c is XmlElement => c.type === "element" && c.tag === tag,
  );
}

function elementChild(node: XmlElement | undefined, tag: string): XmlElement {
  const found = elementChildren(node, tag)[0];
  if (found === undefined) {
    throw new Error(`expected a <${tag}> child`);
  }
  return found;
}

describe("createEmptyOdsPackage", () => {
  it("has every part a minimal ods needs, plus mimetype and manifest", () => {
    const pkg = createEmptyOdsPackage();
    expect(Object.keys(pkg.parts).sort()).toEqual(
      [
        "content.xml",
        "styles.xml",
        "meta.xml",
        "mimetype",
        "META-INF/manifest.xml",
      ].sort(),
    );
  });

  it("declares the vnd.oasis.opendocument.spreadsheet media type in both mimetype and the manifest's root entry", () => {
    const pkg = createEmptyOdsPackage();
    expect(readMimetype(pkg)).toBe(
      "application/vnd.oasis.opendocument.spreadsheet",
    );

    const manifestRoot = xmlRoot(pkg, "META-INF/manifest.xml");
    const rootEntry = elementChildren(manifestRoot, "manifest:file-entry").find(
      (entry) => attr(entry, "manifest:full-path") === "/",
    );
    if (rootEntry === undefined) {
      throw new Error("expected a root manifest:file-entry");
    }
    expect(attr(rootEntry, "manifest:media-type")).toBe(
      "application/vnd.oasis.opendocument.spreadsheet",
    );
  });

  it("every XML part starts with the standard version/encoding/standalone declaration", () => {
    const pkg = createEmptyOdsPackage();
    for (const partName of ["content.xml", "styles.xml", "meta.xml"] as const) {
      const part = pkg.parts[partName];
      if (part?.kind !== "xml") {
        throw new Error(`expected ${partName} to be an xml part`);
      }
      expect(part.nodes[0]).toEqual({
        type: "declaration",
        attributes: [
          { name: "version", value: "1.0" },
          { name: "encoding", value: "UTF-8" },
          { name: "standalone", value: "yes" },
        ],
      });
    }
  });

  it("content.xml declares the of: namespace (required for table:formula's OpenFormula grammar to recalculate on open) alongside version 1.3 and one empty, named default sheet", () => {
    const pkg = createEmptyOdsPackage();
    const root = xmlRoot(pkg, "content.xml");
    expect(attr(root, "xmlns:of")).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:of:1.2",
    );
    expect(attr(root, "office:version")).toBe("1.3");

    const automaticStyles = elementChild(root, "office:automatic-styles");
    const sheetStyle = elementChild(automaticStyles, "style:style");
    expect(attr(sheetStyle, "style:name")).toBe("OdsTable");
    expect(attr(sheetStyle, "style:family")).toBe("table");
    expect(attr(sheetStyle, "style:master-page-name")).toBe("Standard");

    const body = elementChild(root, "office:body");
    const spreadsheet = elementChild(body, "office:spreadsheet");
    const calcSettings = elementChild(
      spreadsheet,
      "table:calculation-settings",
    );
    expect(attr(calcSettings, "table:automatic-find-labels")).toBe("false");
    expect(attr(calcSettings, "table:use-regular-expressions")).toBe("false");
    expect(attr(calcSettings, "table:use-wildcards")).toBe("true");
    expect(attr(calcSettings, "table:null-year")).toBe("1950");

    const table = elementChild(spreadsheet, "table:table");
    expect(attr(table, "table:name")).toBe("Sheet1");
    expect(attr(table, "table:style-name")).toBe("OdsTable");
  });

  it("styles.xml declares version 1.3, a PAGE_SIZE_A4/2cm-margin page layout, and the Standard master page referencing it", () => {
    const pkg = createEmptyOdsPackage();
    const root = xmlRoot(pkg, "styles.xml");
    expect(attr(root, "office:version")).toBe("1.3");

    const automaticStyles = elementChild(root, "office:automatic-styles");
    const pageLayout = elementChild(automaticStyles, "style:page-layout");
    expect(attr(pageLayout, "style:name")).toBe("PM1");
    const properties = elementChild(pageLayout, "style:page-layout-properties");
    expect(attr(properties, "fo:page-width")).toBe("595.28pt");
    expect(attr(properties, "fo:page-height")).toBe("841.89pt");
    expect(attr(properties, "fo:margin-top")).toBe("2cm");
    expect(attr(properties, "fo:margin-right")).toBe("2cm");
    expect(attr(properties, "fo:margin-bottom")).toBe("2cm");
    expect(attr(properties, "fo:margin-left")).toBe("2cm");

    const masterStyles = elementChild(root, "office:master-styles");
    const masterPage = elementChild(masterStyles, "style:master-page");
    expect(attr(masterPage, "style:name")).toBe("Standard");
    expect(attr(masterPage, "style:page-layout-name")).toBe("PM1");
  });

  it("meta.xml has an empty office:meta when no metadata is given", () => {
    const pkg = createEmptyOdsPackage();
    const root = xmlRoot(pkg, "meta.xml");
    expect(attr(root, "office:version")).toBe("1.3");
    const meta = elementChild(root, "office:meta");
    expect(meta.children).toHaveLength(0);
  });

  it("meta.xml carries every given metadata field, XML-encoded, with keywords repeated once per entry", () => {
    const pkg = createEmptyOdsPackage({
      metadata: {
        title: "A <Title> & More",
        author: "Ada",
        subject: "A Subject",
        keywords: ["alpha", "beta"],
        creator: "documents.js",
        createdIso: "2024-01-01T00:00:00.000Z",
        modifiedIso: "2024-06-01T00:00:00.000Z",
      },
    });
    const root = xmlRoot(pkg, "meta.xml");
    const meta = elementChild(root, "office:meta");

    const title = elementChild(meta, "dc:title");
    expect(title.children).toEqual([
      { type: "text", value: "A &lt;Title&gt; &amp; More" },
    ]);
    const creator = elementChild(meta, "meta:initial-creator");
    expect(creator.children).toEqual([{ type: "text", value: "Ada" }]);
    const subject = elementChild(meta, "dc:subject");
    expect(subject.children).toEqual([{ type: "text", value: "A Subject" }]);
    const keywords = elementChildren(meta, "meta:keyword");
    expect(keywords).toHaveLength(2);
    expect(keywords[0]?.children).toEqual([{ type: "text", value: "alpha" }]);
    expect(keywords[1]?.children).toEqual([{ type: "text", value: "beta" }]);
    const generator = elementChild(meta, "meta:generator");
    expect(generator.children).toEqual([
      { type: "text", value: "documents.js" },
    ]);
    const creationDate = elementChild(meta, "meta:creation-date");
    expect(creationDate.children).toEqual([
      { type: "text", value: "2024-01-01T00:00:00.000Z" },
    ]);
    const date = elementChild(meta, "dc:date");
    expect(date.children).toEqual([
      { type: "text", value: "2024-06-01T00:00:00.000Z" },
    ]);
  });

  it("meta.xml omits each metadata field individually when it is absent, rather than writing an empty element", () => {
    const pkg = createEmptyOdsPackage({ metadata: { title: "Only Title" } });
    const root = xmlRoot(pkg, "meta.xml");
    const meta = elementChild(root, "office:meta");
    expect(elementChildren(meta, "dc:title")).toHaveLength(1);
    expect(elementChildren(meta, "meta:initial-creator")).toHaveLength(0);
    expect(elementChildren(meta, "dc:subject")).toHaveLength(0);
    expect(elementChildren(meta, "meta:keyword")).toHaveLength(0);
    expect(elementChildren(meta, "meta:generator")).toHaveLength(0);
    expect(elementChildren(meta, "meta:creation-date")).toHaveLength(0);
    expect(elementChildren(meta, "dc:date")).toHaveLength(0);
  });
});
