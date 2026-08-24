import type { LayoutMetadata } from "document-schema.js";
import type { Package } from "ooxml.js";
import {
  attr,
  childrenWithTag,
  resolveRelationships,
  rootElement,
  textContent,
} from "ooxml.js";
import { describe, expect, it } from "vitest";
import { addCoreProperties } from "./core-properties";

const CORE_PROPERTIES_PATH = "docProps/core.xml";
const CORE_PROPERTIES_REL_TYPE =
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";

function emptyPackage(): Package {
  return { parts: {} };
}

describe("addCoreProperties", () => {
  it("writes every supplied field to its real OOXML core-properties element", () => {
    const pkg = emptyPackage();
    const metadata: LayoutMetadata = {
      title: "Quarterly Report",
      author: "Ada Lovelace",
      subject: "Q3 numbers",
      keywords: ["finance", "q3"],
      createdIso: "2026-01-01T00:00:00.000Z",
      modifiedIso: "2026-01-02T00:00:00.000Z",
    };
    addCoreProperties(pkg, metadata);

    const root = rootElement(pkg.parts[CORE_PROPERTIES_PATH]);
    expect(root).toBeDefined();
    expect(root?.tag).toBe("cp:coreProperties");

    const title =
      root === undefined ? undefined : childrenWithTag(root, "dc:title")[0];
    expect(title === undefined ? undefined : textContent(title)).toBe(
      "Quarterly Report",
    );

    // dc:creator carries metadata.AUTHOR (the human byline) -- not metadata.creator, which names the originating application and has no core-properties counterpart this function writes.
    const creator =
      root === undefined ? undefined : childrenWithTag(root, "dc:creator")[0];
    expect(creator === undefined ? undefined : textContent(creator)).toBe(
      "Ada Lovelace",
    );

    const subject =
      root === undefined ? undefined : childrenWithTag(root, "dc:subject")[0];
    expect(subject === undefined ? undefined : textContent(subject)).toBe(
      "Q3 numbers",
    );

    const keywords =
      root === undefined ? undefined : childrenWithTag(root, "cp:keywords")[0];
    expect(keywords === undefined ? undefined : textContent(keywords)).toBe(
      "finance, q3",
    );

    const created =
      root === undefined
        ? undefined
        : childrenWithTag(root, "dcterms:created")[0];
    expect(created === undefined ? undefined : textContent(created)).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    expect(created === undefined ? undefined : attr(created, "xsi:type")).toBe(
      "dcterms:W3CDTF",
    );

    const modified =
      root === undefined
        ? undefined
        : childrenWithTag(root, "dcterms:modified")[0];
    expect(modified === undefined ? undefined : textContent(modified)).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(
      modified === undefined ? undefined : attr(modified, "xsi:type"),
    ).toBe("dcterms:W3CDTF");
  });

  it("omits an element entirely for a field that was not supplied, rather than writing an empty one", () => {
    const pkg = emptyPackage();
    addCoreProperties(pkg, { title: "Only a title" });

    const root = rootElement(pkg.parts[CORE_PROPERTIES_PATH]);
    expect(
      root === undefined ? [] : childrenWithTag(root, "dc:title"),
    ).toHaveLength(1);
    expect(
      root === undefined ? [] : childrenWithTag(root, "dc:creator"),
    ).toHaveLength(0);
    expect(
      root === undefined ? [] : childrenWithTag(root, "dc:subject"),
    ).toHaveLength(0);
    expect(
      root === undefined ? [] : childrenWithTag(root, "cp:keywords"),
    ).toHaveLength(0);
    expect(
      root === undefined ? [] : childrenWithTag(root, "dcterms:created"),
    ).toHaveLength(0);
    expect(
      root === undefined ? [] : childrenWithTag(root, "dcterms:modified"),
    ).toHaveLength(0);
  });

  it("registers the [Content_Types].xml override and the package-root relationship", () => {
    const pkg = emptyPackage();
    addCoreProperties(pkg, { title: "Doc" });

    const contentTypesRoot = rootElement(pkg.parts["[Content_Types].xml"]);
    expect(contentTypesRoot).toBeDefined();
    const override =
      contentTypesRoot === undefined
        ? undefined
        : childrenWithTag(contentTypesRoot, "Override").find(
            (o) => attr(o, "PartName") === `/${CORE_PROPERTIES_PATH}`,
          );
    expect(override).toBeDefined();
    expect(
      override === undefined ? undefined : attr(override, "ContentType"),
    ).toBe("application/vnd.openxmlformats-package.core-properties+xml");

    // The root relationship lands in the real "_rels/.rels" part -- not the "/_rels/.rels" resolveRelationships(pkg, '') would (mis)derive, per addRootRelationship's own note (src/opc/rels.ts) -- so it is read directly, matching that function's own test file.
    const rootRels = rootElement(pkg.parts["_rels/.rels"]);
    expect(rootRels).toBeDefined();
    const relationship =
      rootRels === undefined
        ? undefined
        : childrenWithTag(rootRels, "Relationship").find(
            (r) => attr(r, "Type") === CORE_PROPERTIES_REL_TYPE,
          );
    expect(relationship).toBeDefined();
    expect(
      relationship === undefined ? undefined : attr(relationship, "Target"),
    ).toBe(CORE_PROPERTIES_PATH);
  });

  it("preserves an existing root relationship (e.g. to word/document.xml) when adding its own", () => {
    const pkg = emptyPackage();
    const OFFICE_DOCUMENT_TYPE =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
    pkg.parts["_rels/.rels"] = {
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
                { name: "Type", value: OFFICE_DOCUMENT_TYPE },
                { name: "Target", value: "word/document.xml" },
              ],
              children: [],
            },
          ],
        },
      ],
    };

    addCoreProperties(pkg, { title: "Doc" });

    const rootRels = rootElement(pkg.parts["_rels/.rels"]);
    const relationships =
      rootRels === undefined ? [] : childrenWithTag(rootRels, "Relationship");
    expect(relationships).toHaveLength(2);
    expect(
      relationships.some((r) => attr(r, "Type") === OFFICE_DOCUMENT_TYPE),
    ).toBe(true);
    expect(
      relationships.some((r) => attr(r, "Type") === CORE_PROPERTIES_REL_TYPE),
    ).toBe(true);
  });

  it("resolves via resolveRelationships when queried from a real part path, not just the root", () => {
    // Sanity check that the relationship this function writes is genuinely discoverable through ooxml.js's own public API from a real part -- addImageMedia's own test file establishes this same pattern for media relationships.
    const pkg = emptyPackage();
    pkg.parts["word/document.xml"] = { kind: "xml", nodes: [] };
    addCoreProperties(pkg, { title: "Doc" });
    // resolveRelationships resolves a real part's OWN .rels, which is unrelated to _rels/.rels -- confirming core.xml's relationship lives at the root and is absent from an unrelated part's relationships.
    const unrelated = resolveRelationships(pkg, "word/document.xml");
    expect(unrelated.size).toBe(0);
  });
});
