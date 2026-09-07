import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import {
  readOdfMetadata,
  hasOdfMetadata,
  patchOdfMetadata,
  META_PART,
} from "./metadata";

function metaPackage(
  metaChildren: Parameters<typeof el>[2] = [],
  rootAttributes: Parameters<typeof el>[1] = {},
): Package {
  const meta = el("office:meta", {}, metaChildren);
  return {
    parts: {
      [META_PART]: {
        kind: "xml",
        nodes: [el("office:document-meta", rootAttributes, [meta])],
      },
    },
  };
}

function documentMetaRootOf(pkg: Package): XmlElement {
  const part = pkg.parts[META_PART];
  if (part?.kind !== "xml") {
    throw new Error("expected an XML meta.xml part");
  }
  const root = part.nodes.find(
    (node): node is XmlElement => node.type === "element",
  );
  if (root === undefined) {
    throw new Error("expected an office:document-meta root element");
  }
  return root;
}

function officeMetaOf(pkg: Package): XmlElement {
  const meta = documentMetaRootOf(pkg).children.find(
    (child): child is XmlElement =>
      child.type === "element" && child.tag === "office:meta",
  );
  if (meta === undefined) {
    throw new Error("expected an office:meta element");
  }
  return meta;
}

describe("readOdfMetadata", () => {
  it("returns an empty object when the package has no meta.xml part at all", () => {
    expect(readOdfMetadata({ parts: {} })).toEqual({});
  });

  it("returns an empty object when meta.xml is not an XML part", () => {
    expect(
      readOdfMetadata({
        parts: { [META_PART]: { kind: "binary", base64: "" } },
      }),
    ).toEqual({});
  });

  it("returns an empty object when meta.xml has no office:document-meta root", () => {
    expect(
      readOdfMetadata({ parts: { [META_PART]: { kind: "xml", nodes: [] } } }),
    ).toEqual({});
  });

  it("returns an empty object when office:document-meta has no office:meta child", () => {
    const pkg: Package = {
      parts: {
        [META_PART]: { kind: "xml", nodes: [el("office:document-meta")] },
      },
    };
    expect(readOdfMetadata(pkg)).toEqual({});
  });

  it("returns an empty object for a well-formed but entirely empty office:meta -- an empty office:meta is valid ODF, not an error", () => {
    expect(readOdfMetadata(metaPackage([]))).toEqual({});
  });

  // dc:title / meta:initial-creator / dc:subject / dc:date / meta:generator values below are copied verbatim (real LibreOffice 26.2.5.2 output) from Modern_business_letter_serif.ott and CV.ott, two of LibreOffice's own bundled templates under /Applications/LibreOffice.app/Contents/Resources/template/**; meta:creation-date's value is likewise a real LibreOffice-produced timestamp copied from the same template. See this module's own top-of-file note on how meta:initial-creator vs. dc:creator, and meta:keyword's one-element-per-keyword shape, were confirmed against those real files.

  it("reads dc:title", () => {
    const pkg = metaPackage([
      el("dc:title", {}, [txt("Modern business letter serif")]),
    ]);
    expect(readOdfMetadata(pkg).title).toBe("Modern business letter serif");
  });

  it('reads meta:initial-creator as author -- NOT dc:creator, which ODF uses for "last modified by"', () => {
    const pkg = metaPackage([
      el("meta:initial-creator", {}, [txt("Alexander Wilms")]),
      el("dc:creator", {}, [txt("Someone Else Entirely")]),
    ]);
    expect(readOdfMetadata(pkg).author).toBe("Alexander Wilms");
  });

  it("reads dc:subject", () => {
    const pkg = metaPackage([el("dc:subject", {}, [txt("Quarterly roadmap")])]);
    expect(readOdfMetadata(pkg).subject).toBe("Quarterly roadmap");
  });

  it("does not read dc:description into subject -- Comments and Subject are distinct ODF fields", () => {
    const pkg = metaPackage([
      el("dc:description", {}, [txt("This is a comment, not the subject")]),
    ]);
    expect(readOdfMetadata(pkg).subject).toBeUndefined();
  });

  it("reads meta:keyword as an array, one element per keyword (confirmed different from OOXML's single comma-separated cp:keywords)", () => {
    const pkg = metaPackage([
      el("meta:keyword", {}, [txt("alpha")]),
      el("meta:keyword", {}, [txt("beta")]),
      el("meta:keyword", {}, [txt("gamma")]),
    ]);
    expect(readOdfMetadata(pkg).keywords).toEqual(["alpha", "beta", "gamma"]);
  });

  it("reads meta:generator as creator -- the originating application, not a person, matching ooxml.js's own DocumentMetadata.creator convention", () => {
    const pkg = metaPackage([
      el("meta:generator", {}, [
        txt(
          "LibreOffice/26.2.5.2$MacOSX_AARCH64 LibreOffice_project/cd7284b4cbbfeb507e630c1aac019f4157393acb",
        ),
      ]),
    ]);
    expect(readOdfMetadata(pkg).creator).toBe(
      "LibreOffice/26.2.5.2$MacOSX_AARCH64 LibreOffice_project/cd7284b4cbbfeb507e630c1aac019f4157393acb",
    );
  });

  it("reads meta:creation-date as createdIso", () => {
    const pkg = metaPackage([
      el("meta:creation-date", {}, [txt("2014-12-28T11:41:10.830000000")]),
    ]);
    expect(readOdfMetadata(pkg).createdIso).toBe(
      "2014-12-28T11:41:10.830000000",
    );
  });

  it('reads dc:date as modifiedIso -- ODF\'s own "last modified" timestamp, distinct from meta:creation-date', () => {
    const pkg = metaPackage([
      el("dc:date", {}, [txt("2014-12-28T11:58:55.267000000")]),
    ]);
    expect(readOdfMetadata(pkg).modifiedIso).toBe(
      "2014-12-28T11:58:55.267000000",
    );
  });

  it("never sets producer -- a PDF-only concept with no ODF equivalent, matching ooxml.js's own docx/pptx readers", () => {
    const pkg = metaPackage([el("dc:title", {}, [txt("Anything")])]);
    expect(readOdfMetadata(pkg).producer).toBeUndefined();
    expect("producer" in readOdfMetadata(pkg)).toBe(false);
  });

  it("ignores a non-text child node when reading a simple element's text content (e.g. a stray comment)", () => {
    const pkg = metaPackage([
      el("dc:title", {}, [
        txt("Real "),
        { type: "comment", value: "stray" },
        txt("Title"),
      ]),
    ]);
    expect(readOdfMetadata(pkg).title).toBe("Real Title");
  });

  it("reads every field together from one realistic office:meta, matching real LibreOffice output shape", () => {
    const pkg = metaPackage([
      el("meta:creation-date", {}, [txt("2014-12-28T11:41:10.830000000")]),
      el("meta:generator", {}, [
        txt(
          "LibreOffice/26.2.5.2$MacOSX_AARCH64 LibreOffice_project/cd7284b4cbbfeb507e630c1aac019f4157393acb",
        ),
      ]),
      el("dc:description", {}, [txt("Modern business letter with serif font")]),
      el("dc:title", {}, [txt("Modern business letter serif")]),
      el("meta:initial-creator", {}, [txt("Eric Lavarde")]),
      el("dc:creator", {}, [txt("Eric Lavarde")]),
      el("dc:date", {}, [txt("2014-12-28T11:58:55.267000000")]),
    ]);
    expect(readOdfMetadata(pkg)).toEqual({
      title: "Modern business letter serif",
      author: "Eric Lavarde",
      creator:
        "LibreOffice/26.2.5.2$MacOSX_AARCH64 LibreOffice_project/cd7284b4cbbfeb507e630c1aac019f4157393acb",
      createdIso: "2014-12-28T11:41:10.830000000",
      modifiedIso: "2014-12-28T11:58:55.267000000",
    });
  });

  it("decodes XML entities in a title (e.g. an ampersand)", () => {
    const pkg = metaPackage([el("dc:title", {}, [txt("Smith &amp; Sons")])]);
    expect(readOdfMetadata(pkg).title).toBe("Smith & Sons");
  });

  it("treats an empty element as absent rather than an empty string", () => {
    const pkg = metaPackage([el("dc:title", {}, [])]);
    expect(readOdfMetadata(pkg).title).toBeUndefined();
  });

  it("ignores an empty meta:keyword when building the keywords array", () => {
    const pkg = metaPackage([
      el("meta:keyword", {}, [txt("alpha")]),
      el("meta:keyword", {}, []),
    ]);
    expect(readOdfMetadata(pkg).keywords).toEqual(["alpha"]);
  });

  it("omits keywords entirely when there are no meta:keyword elements", () => {
    const pkg = metaPackage([el("dc:title", {}, [txt("No keywords here")])]);
    expect(readOdfMetadata(pkg).keywords).toBeUndefined();
  });
});

describe("hasOdfMetadata", () => {
  it("is true for a package carrying a real meta.xml XML part", () => {
    expect(hasOdfMetadata(metaPackage())).toBe(true);
  });

  it("is false when the package has no meta.xml part at all", () => {
    expect(hasOdfMetadata({ parts: {} })).toBe(false);
  });

  it("is false when meta.xml is not an XML part", () => {
    expect(
      hasOdfMetadata({
        parts: { [META_PART]: { kind: "binary", base64: "" } },
      }),
    ).toBe(false);
  });
});

describe("patchOdfMetadata", () => {
  it("creates dc:title on an office:meta that had none, reading back through readOdfMetadata", () => {
    const pkg = metaPackage([]);
    patchOdfMetadata(pkg, { title: "New title" });
    expect(readOdfMetadata(pkg).title).toBe("New title");
  });

  it("replaces an existing dc:title's text in place, rather than appending a second element", () => {
    const pkg = metaPackage([el("dc:title", {}, [txt("Old title")])]);
    patchOdfMetadata(pkg, { title: "New title" });
    expect(readOdfMetadata(pkg).title).toBe("New title");
    expect(
      officeMetaOf(pkg).children.filter(
        (c) => c.type === "element" && c.tag === "dc:title",
      ),
    ).toHaveLength(1);
  });

  it("patches author onto meta:initial-creator, never dc:creator", () => {
    const pkg = metaPackage([]);
    patchOdfMetadata(pkg, { author: "New author" });
    expect(readOdfMetadata(pkg).author).toBe("New author");
  });

  it("patches subject onto dc:subject", () => {
    const pkg = metaPackage([]);
    patchOdfMetadata(pkg, { subject: "New subject" });
    expect(readOdfMetadata(pkg).subject).toBe("New subject");
  });

  it("leaves every element the patch does not name completely untouched -- meta:generator, meta:creation-date, dc:date, and an unrecognised producer field alike", () => {
    const pkg = metaPackage([
      el("meta:generator", {}, [txt("Some Producer 1.0")]),
      el("meta:creation-date", {}, [txt("2020-01-01T00:00:00")]),
      el("dc:date", {}, [txt("2020-06-01T00:00:00")]),
      el("meta:document-statistic", { "meta:page-count": "3" }),
    ]);
    patchOdfMetadata(pkg, { title: "Only the title changes" });
    const meta = readOdfMetadata(pkg);
    expect(meta.title).toBe("Only the title changes");
    expect(meta.creator).toBe("Some Producer 1.0");
    expect(meta.createdIso).toBe("2020-01-01T00:00:00");
    expect(meta.modifiedIso).toBe("2020-06-01T00:00:00");
    expect(
      officeMetaOf(pkg).children.some(
        (c) => c.type === "element" && c.tag === "meta:document-statistic",
      ),
    ).toBe(true);
  });

  it("replaces every existing meta:keyword with one element per new keyword", () => {
    const pkg = metaPackage([
      el("meta:keyword", {}, [txt("old-alpha")]),
      el("meta:keyword", {}, [txt("old-beta")]),
    ]);
    patchOdfMetadata(pkg, { keywords: ["new-alpha", "new-beta", "new-gamma"] });
    expect(readOdfMetadata(pkg).keywords).toEqual([
      "new-alpha",
      "new-beta",
      "new-gamma",
    ]);
  });

  it("removes every meta:keyword element when patched with an empty array, rather than leaving a stale one", () => {
    const pkg = metaPackage([
      el("meta:keyword", {}, [txt("alpha")]),
      el("meta:keyword", {}, [txt("beta")]),
    ]);
    patchOdfMetadata(pkg, { keywords: [] });
    expect(readOdfMetadata(pkg).keywords).toBeUndefined();
    expect(
      officeMetaOf(pkg).children.some(
        (c) => c.type === "element" && c.tag === "meta:keyword",
      ),
    ).toBe(false);
  });

  it("leaves keywords entirely alone when the override omits the field", () => {
    const pkg = metaPackage([el("meta:keyword", {}, [txt("alpha")])]);
    patchOdfMetadata(pkg, { title: "New title" });
    expect(readOdfMetadata(pkg).keywords).toEqual(["alpha"]);
  });

  it("declares xmlns:meta on office:document-meta when patching author into a meta.xml that only ever declared dc:, rather than emitting an unbound prefix", () => {
    const pkg = metaPackage([el("dc:title", {}, [txt("Existing title")])], {
      "xmlns:office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
      "xmlns:dc": "http://purl.org/dc/elements/1.1/",
    });
    patchOdfMetadata(pkg, { author: "New author" });
    const root = documentMetaRootOf(pkg);
    expect(root.attributes.find((a) => a.name === "xmlns:meta")?.value).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
    );
    expect(readOdfMetadata(pkg).author).toBe("New author");
  });

  it("does not duplicate an xmlns declaration the root already carries", () => {
    const pkg = metaPackage([], {
      "xmlns:office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
      "xmlns:meta": "urn:oasis:names:tc:opendocument:xmlns:meta:1.0",
    });
    patchOdfMetadata(pkg, { author: "New author" });
    const root = documentMetaRootOf(pkg);
    expect(root.attributes.filter((a) => a.name === "xmlns:meta")).toHaveLength(
      1,
    );
  });

  it("throws when the package has no meta.xml part at all", () => {
    expect(() => {
      patchOdfMetadata({ parts: {} }, { title: "x" });
    }).toThrow(/has no 'meta\.xml' XML part/);
  });

  it("throws when meta.xml has no office:meta element", () => {
    const pkg: Package = {
      parts: {
        [META_PART]: { kind: "xml", nodes: [el("office:document-meta")] },
      },
    };
    expect(() => {
      patchOdfMetadata(pkg, { title: "x" });
    }).toThrow(/has no office:meta element/);
  });

  it("writes even an empty-string title/author/subject, matching buildOdfMetaNodes' own field-presence convention", () => {
    const pkg = metaPackage([el("dc:title", {}, [txt("Something")])]);
    patchOdfMetadata(pkg, { title: "" });
    expect(
      officeMetaOf(pkg).children.some(
        (c) => c.type === "element" && c.tag === "dc:title",
      ),
    ).toBe(true);
  });
});
