import type { Package } from "ooxml.js";
import {
  attr,
  childrenWithTag,
  resolveRelationships,
  rootElement,
} from "ooxml.js";
import { describe, expect, it } from "vitest";
import { addRelationship, addRootRelationship } from "./rels";

const IMAGE_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

function emptyPackage(): Package {
  return { parts: {} };
}

describe("addRelationship", () => {
  it("creates the .rels part when none exists and allocates rId1", () => {
    const pkg = emptyPackage();
    const id = addRelationship(pkg, "word/document.xml", {
      type: IMAGE_TYPE,
      target: "media/image1.png",
    });
    expect(id).toBe("rId1");
    const resolved = resolveRelationships(pkg, "word/document.xml");
    expect(resolved.get("rId1")).toEqual({
      type: IMAGE_TYPE,
      target: "word/media/image1.png",
      targetMode: undefined,
    });
  });

  it("allocates the next id above the highest existing numeric suffix", () => {
    const pkg = emptyPackage();
    addRelationship(pkg, "word/document.xml", {
      type: IMAGE_TYPE,
      target: "media/image1.png",
    });
    addRelationship(pkg, "word/document.xml", {
      type: IMAGE_TYPE,
      target: "media/image2.png",
    });
    const third = addRelationship(pkg, "word/document.xml", {
      type: IMAGE_TYPE,
      target: "media/image3.png",
    });
    expect(third).toBe("rId3");
  });

  it("preserves an existing relationship when adding a new one", () => {
    const pkg = emptyPackage();
    addRelationship(pkg, "word/document.xml", {
      type: IMAGE_TYPE,
      target: "media/image1.png",
    });
    addRelationship(pkg, "word/document.xml", {
      type: IMAGE_TYPE,
      target: "media/image2.png",
    });
    const resolved = resolveRelationships(pkg, "word/document.xml");
    expect(resolved.size).toBe(2);
    expect(resolved.get("rId1")?.target).toBe("word/media/image1.png");
    expect(resolved.get("rId2")?.target).toBe("word/media/image2.png");
  });

  it("keeps an External targetMode when set", () => {
    const pkg = emptyPackage();
    const HYPERLINK_TYPE =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
    addRelationship(pkg, "word/document.xml", {
      type: HYPERLINK_TYPE,
      target: "https://example.com",
      targetMode: "External",
    });
    const resolved = resolveRelationships(pkg, "word/document.xml");
    expect(resolved.get("rId1")).toEqual({
      type: HYPERLINK_TYPE,
      target: "https://example.com",
      targetMode: "External",
    });
  });
});

const CORE_PROPERTIES_TYPE =
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";

// addRelationship(pkg, '', rel) -- the only way to add a root relationship before addRootRelationship existed -- derives its .rels path via relsPathFor(''), which produces "/_rels/.rels" (a leading slash): a different Package.parts key from "_rels/.rels", the one every scaffold in this codebase and every real OOXML package writer actually uses. resolveRelationships(pkg, '') has the identical bug (it calls the same relsPathFor('') internally), so these tests read the raw "_rels/.rels" part directly via rootElement/childrenWithTag/attr, mirroring src/fonts/ooxml.ts's own officeDocumentPartPath -- rather than through resolveRelationships, which cannot see the correct root path either.
describe("addRootRelationship", () => {
  it('writes the relationship into "_rels/.rels", not "/_rels/.rels"', () => {
    const pkg: Package = { parts: {} };
    const id = addRootRelationship(pkg, {
      type: CORE_PROPERTIES_TYPE,
      target: "docProps/core.xml",
    });
    expect(id).toBe("rId1");
    expect(Object.keys(pkg.parts)).toEqual(["_rels/.rels"]);

    const rels = rootElement(pkg.parts["_rels/.rels"]);
    expect(rels).toBeDefined();
    const [relationship] =
      rels === undefined ? [] : childrenWithTag(rels, "Relationship");
    expect(relationship).toBeDefined();
    expect(
      relationship === undefined ? undefined : attr(relationship, "Id"),
    ).toBe("rId1");
    expect(
      relationship === undefined ? undefined : attr(relationship, "Type"),
    ).toBe(CORE_PROPERTIES_TYPE);
    expect(
      relationship === undefined ? undefined : attr(relationship, "Target"),
    ).toBe("docProps/core.xml");
  });

  it('shares the same "_rels/.rels" part a scaffold\'s own hardcoded root relationship already wrote, rather than creating an orphaned duplicate', () => {
    // Mirrors exactly what createEmptyDocxPackage/createEmptyPptxPackage hardcode: a root relationship to the main document part, present before addRootRelationship is ever called.
    const pkg: Package = {
      parts: {
        "_rels/.rels": {
          kind: "xml",
          nodes: [
            {
              type: "element",
              tag: "Relationships",
              attributes: [
                {
                  name: "xmlns",
                  value:
                    "http://schemas.openxmlformats.org/package/2006/relationships",
                },
              ],
              children: [
                {
                  type: "element",
                  tag: "Relationship",
                  attributes: [
                    { name: "Id", value: "rId1" },
                    {
                      name: "Type",
                      value:
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
                    },
                    { name: "Target", value: "word/document.xml" },
                  ],
                  children: [],
                },
              ],
            },
          ],
        },
      },
    };
    const id = addRootRelationship(pkg, {
      type: CORE_PROPERTIES_TYPE,
      target: "docProps/core.xml",
    });
    expect(id).toBe("rId2");
    expect(Object.keys(pkg.parts)).toEqual(["_rels/.rels"]);

    const rels = rootElement(pkg.parts["_rels/.rels"]);
    const relationships =
      rels === undefined ? [] : childrenWithTag(rels, "Relationship");
    expect(relationships).toHaveLength(2);
    expect(
      relationships.map((relationship) => attr(relationship, "Id")),
    ).toEqual(["rId1", "rId2"]);
  });
});
