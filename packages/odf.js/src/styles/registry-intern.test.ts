import { describe, expect, it } from "vitest";
import type { Package } from "../model/package";
import type { XmlElement } from "../model/node";
import { el, txt } from "../xml/fragment";
import { StyleRegistry, type InternRequest } from "./registry";

function contentPackage(rootChildren: readonly XmlElement[] = []): Package {
  return {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [el("office:document-content", {}, rootChildren)],
      },
    },
  };
}

function stylesPackage(rootChildren: readonly XmlElement[] = []): Package {
  return {
    parts: {
      "styles.xml": {
        kind: "xml",
        nodes: [el("office:document-styles", {}, rootChildren)],
      },
    },
  };
}

function rootElementOf(pkg: Package, partPath: string): XmlElement {
  const part = pkg.parts[partPath];
  if (part?.kind !== "xml") {
    throw new Error("expected an xml part");
  }
  const root = part.nodes.find((n): n is XmlElement => n.type === "element");
  if (root === undefined) {
    throw new Error("expected a root element");
  }
  return root;
}

function automaticStylesOf(pkg: Package, partPath: string): XmlElement {
  const root = rootElementOf(pkg, partPath);
  const automaticStyles = root.children.find(
    (n): n is XmlElement =>
      n.type === "element" && n.tag === "office:automatic-styles",
  );
  if (automaticStyles === undefined) {
    throw new Error("expected an office:automatic-styles element");
  }
  return automaticStyles;
}

function styleNameOf(element: XmlElement): string | undefined {
  return element.attributes.find((a) => a.name === "style:name")?.value;
}

const BOLD: InternRequest = { properties: { bold: true }, family: "text" };
const CENTER_PARAGRAPH: InternRequest = {
  properties: { alignment: "center" },
  family: "paragraph",
};

describe("rule (c): fingerprint includes parentStyleName, kept separate from properties", () => {
  it("two requests with identical properties but different parentStyleName never reuse each other's style", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    const a = registry.intern({
      properties: { alignment: "center" },
      family: "paragraph",
      parentStyleName: "Standard",
    });
    const b = registry.intern({
      properties: { alignment: "center" },
      family: "paragraph",
      parentStyleName: "Text_20_body",
    });
    const c = registry.intern({
      properties: { alignment: "center" },
      family: "paragraph",
    }); // no parent at all
    const expectedUniqueCount = 3;
    expect(new Set([a, b, c]).size).toBe(expectedUniqueCount);
  });

  it("fingerprint() reflects the parentStyleName distinction directly, without needing intern()", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    const withParent = registry.fingerprint({
      properties: { bold: true },
      family: "text",
      parentStyleName: "Standard",
    });
    const withoutParent = registry.fingerprint({
      properties: { bold: true },
      family: "text",
    });
    expect(withParent).not.toBe(withoutParent);
  });

  it("two requests with identical properties and parentStyleName but different families never reuse each other's style", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    const paragraphFp = registry.fingerprint({
      properties: {},
      family: "paragraph",
    });
    const textFp = registry.fingerprint({ properties: {}, family: "text" });
    expect(paragraphFp).not.toBe(textFp);
  });

  it("reusing the same (properties, family, parentStyleName) triple returns the same name every time", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    const request: InternRequest = {
      properties: { italic: true },
      family: "text",
      parentStyleName: "Standard",
    };
    const first = registry.intern(request);
    const second = registry.intern({
      ...request,
      properties: { ...request.properties },
    });
    expect(second).toBe(first);
  });
});

describe("rule (d): name minting is collision-checked across all four containers", () => {
  it("never mints a name already present in this part's own office:styles", () => {
    const namedStyle = el("style:style", {
      "style:name": "P1",
      "style:family": "paragraph",
    });
    const pkg = contentPackage([
      el("office:styles", {}, [namedStyle]),
      el("office:automatic-styles"),
    ]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(registry.intern(CENTER_PARAGRAPH)).toBe("P2");
  });

  it("never mints a name already present in the other part's office:automatic-styles, when given via otherPart", () => {
    const contentPkg = contentPackage();
    const stylesPkg: Package = {
      parts: {
        "styles.xml": {
          kind: "xml",
          nodes: [
            el("office:document-styles", {}, [
              el("office:automatic-styles", {}, [
                el("style:style", {
                  "style:name": "P1",
                  "style:family": "paragraph",
                }),
              ]),
            ]),
          ],
        },
      },
    };
    const merged: Package = {
      parts: { ...contentPkg.parts, ...stylesPkg.parts },
    };

    const registry = StyleRegistry.forPart(merged, "content.xml", {
      otherPart: { pkg: merged, partPath: "styles.xml" },
    });
    expect(registry.intern(CENTER_PARAGRAPH)).toBe("P2");
  });

  it("never mints a name already present in the other part's office:styles, when given via otherPart", () => {
    const merged: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            el("office:document-content", {}, [el("office:automatic-styles")]),
          ],
        },
        "styles.xml": {
          kind: "xml",
          nodes: [
            el("office:document-styles", {}, [
              el("office:styles", {}, [
                el("style:style", {
                  "style:name": "P1",
                  "style:family": "paragraph",
                }),
              ]),
            ]),
          ],
        },
      },
    };
    const registry = StyleRegistry.forPart(merged, "content.xml", {
      otherPart: { pkg: merged, partPath: "styles.xml" },
    });
    expect(registry.intern(CENTER_PARAGRAPH)).toBe("P2");
  });

  it("does not treat a name reserved in a DIFFERENT family as blocking that same name in the family actually being minted", () => {
    // "P1" reserved only under style:family="table" must not stop "P1" from being available to the paragraph family, since ODF's own name uniqueness is per-family.
    const otherFamilyName = el("style:style", {
      "style:name": "P1",
      "style:family": "table",
    });
    const pkg = contentPackage([
      el("office:automatic-styles", {}, [otherFamilyName]),
    ]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(registry.intern(CENTER_PARAGRAPH)).toBe("P1");
  });

  it("skips non-style:style children and entries missing style:name/style:family when scanning office:styles for reservations", () => {
    const namedStyle = el("style:style", {
      "style:name": "P1",
      "style:family": "paragraph",
    });
    const pageLayout = el("style:page-layout", { "style:name": "Mpm1" }); // a real element, but not style:style — must not crash the scan
    const nameless = el("style:style", { "style:family": "paragraph" });
    const pkg = contentPackage([
      el("office:styles", {}, [txt("\n"), pageLayout, nameless, namedStyle]),
      el("office:automatic-styles"),
    ]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(registry.intern(CENTER_PARAGRAPH)).toBe("P2"); // "P1" reserved by the named style; "Mpm1" and the nameless entry are simply ignored, not reserved anywhere relevant
  });

  it("respects additionalReservedNames regardless of family", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml", {
      additionalReservedNames: ["P1"],
    });
    expect(registry.intern(CENTER_PARAGRAPH)).toBe("P2");
  });

  it("does not reserve a name/family carried by a differently-tagged element when scanning office:styles for reservations", () => {
    const impostor = el("style:default-style", {
      "style:name": "P1",
      "style:family": "paragraph",
    });
    const pkg = contentPackage([
      el("office:styles", {}, [impostor]),
      el("office:automatic-styles"),
    ]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    // "P1" was never actually reserved — a name/family check without the tag check would wrongly reserve it, forcing this mint to skip to "P2".
    expect(registry.intern(CENTER_PARAGRAPH)).toBe("P1");
  });
});

describe("rule (e): content.xml and styles.xml registries use distinct name-minting prefixes", () => {
  it("minted names never collide between the two registries, even with no cross-part option supplied at all", () => {
    const contentRegistry = StyleRegistry.forPart(
      contentPackage(),
      "content.xml",
    );
    const stylesRegistry = StyleRegistry.forPart(stylesPackage(), "styles.xml");

    const contentNames = new Set<string>();
    const stylesNames = new Set<string>();
    const iterationCount = 4;
    for (let i = 0; i < iterationCount; i += 1) {
      contentNames.add(
        contentRegistry.intern({
          properties: { indentFirstLinePt: i },
          family: "paragraph",
        }),
      );
      stylesNames.add(
        stylesRegistry.intern({
          properties: { indentFirstLinePt: i },
          family: "paragraph",
        }),
      );
    }

    expect(
      [...contentNames].every((n) => n.startsWith("P") && !n.startsWith("PS")),
    ).toBe(true);
    expect([...stylesNames].every((n) => n.startsWith("PS"))).toBe(true);
    expect([...contentNames].some((n) => stylesNames.has(n))).toBe(false);
  });

  it("every family gets its own distinct prefix pair across the two parts", () => {
    const contentRegistry = StyleRegistry.forPart(
      contentPackage(),
      "content.xml",
    );
    const stylesRegistry = StyleRegistry.forPart(stylesPackage(), "styles.xml");
    const families = [
      "paragraph",
      "text",
      "table",
      "table-column",
      "table-row",
      "table-cell",
      "graphic",
    ] as const;
    const contentPrefixes = families.map((family) =>
      contentRegistry.intern({ properties: {}, family }).replace(/\d+$/, ""),
    );
    const stylesPrefixes = families.map((family) =>
      stylesRegistry.intern({ properties: {}, family }).replace(/\d+$/, ""),
    );
    expect(new Set([...contentPrefixes, ...stylesPrefixes]).size).toBe(
      families.length * 2,
    );
  });
});

describe("intern: general behaviour", () => {
  it("actually writes a real style:style element into the part's automatic-styles, with a style:parent-style-name when given", () => {
    const pkg = contentPackage();
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    const name = registry.intern({
      properties: { bold: true },
      family: "text",
      parentStyleName: "Standard",
    });

    const automaticStyles = automaticStylesOf(pkg, "content.xml");
    expect(automaticStyles.children).toHaveLength(1);
    const styleNode = automaticStyles.children[0]!;
    if (styleNode.type !== "element") {
      throw new Error("expected an element");
    }
    expect(styleNode.tag).toBe("style:style");
    expect(styleNode.attributes).toEqual([
      { name: "style:name", value: name },
      { name: "style:family", value: "text" },
      { name: "style:parent-style-name", value: "Standard" },
    ]);
    expect(styleNode.children).toHaveLength(1);
    expect(styleNode.children[0]).toMatchObject({
      tag: "style:text-properties",
    });
  });

  it("omits style:parent-style-name entirely when the request has none", () => {
    const pkg = contentPackage();
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    registry.intern({ properties: { bold: true }, family: "text" });
    const styleNode = automaticStylesOf(pkg, "content.xml").children[0]!;
    if (styleNode.type !== "element") {
      throw new Error("expected an element");
    }
    expect(
      styleNode.attributes.some((a) => a.name === "style:parent-style-name"),
    ).toBe(false);
  });

  it("different property bags mint different names", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    const a = registry.intern({ properties: { bold: true }, family: "text" });
    const b = registry.intern({ properties: { italic: true }, family: "text" });
    expect(a).not.toBe(b);
  });
});

describe("names()", () => {
  it("reflects both adopted and newly minted names, and nothing from an unrelated part", () => {
    const existing = el(
      "style:style",
      { "style:name": "T9", "style:family": "text" },
      [el("style:text-properties", { "fo:font-weight": "bold" })],
    );
    const pkg = contentPackage([el("office:automatic-styles", {}, [existing])]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    const minted = registry.intern({
      properties: { italic: true },
      family: "text",
    });
    expect(new Set(registry.names())).toEqual(new Set(["T9", minted]));
  });
});

describe("gc()", () => {
  it("is never invoked implicitly: repeated intern() calls never shrink names()", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    registry.intern({ properties: { bold: true }, family: "text" });
    registry.intern({ properties: { italic: true }, family: "text" });
    expect(registry.names()).toHaveLength(2);
  });

  it("removes exactly the styles absent from the referenced set, from both names() and the real XML tree, and returns the removed count", () => {
    const pkg = contentPackage();
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    const kept = registry.intern({
      properties: { bold: true },
      family: "text",
    });
    const dropped = registry.intern({
      properties: { italic: true },
      family: "text",
    });

    const removed = registry.gc(new Set([kept]));

    expect(removed).toBe(1);
    expect(registry.names()).toEqual([kept]);
    expect(registry.names()).not.toContain(dropped);
    const automaticStyles = automaticStylesOf(pkg, "content.xml");
    expect(automaticStyles.children).toHaveLength(1);
    const survivor = automaticStyles.children[0]!;
    if (survivor.type !== "element") {
      throw new Error("expected an element");
    }
    expect(styleNameOf(survivor)).toBe(kept);
  });

  it("a gc'd name is never re-minted, even though it is no longer in names()", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    const first = registry.intern({
      properties: { bold: true },
      family: "text",
    });
    expect(first).toBe("T1");
    registry.gc(new Set());
    expect(registry.names()).toEqual([]);

    const next = registry.intern({
      properties: { italic: true },
      family: "text",
    });
    expect(next).toBe("T2"); // not "T1" again
  });

  it("removes an adopted style that was never fingerprint-matchable (unmodelled attribute), which has no fingerprint entry to clean up", () => {
    const unmodelled = el(
      "style:style",
      { "style:name": "P1", "style:family": "paragraph" },
      [el("style:paragraph-properties", { "fo:margin-right": "2cm" })],
    );
    const pkg = contentPackage([
      el("office:automatic-styles", {}, [unmodelled]),
    ]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(registry.names()).toEqual(["P1"]);

    const removed = registry.gc(new Set());
    expect(removed).toBe(1);
    expect(registry.names()).toEqual([]);
    expect(automaticStylesOf(pkg, "content.xml").children).toEqual([]);
  });

  it("returns 0 and changes nothing when every known style is referenced", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    const name = registry.intern({
      properties: { bold: true },
      family: "text",
    });
    expect(registry.gc(new Set([name]))).toBe(0);
    expect(registry.names()).toEqual([name]);
  });

  it("gc'ing a minted, fingerprint-matchable style also forgets its own fingerprint entry, so a later identical request mints fresh rather than returning the now-removed name", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    const minted = registry.intern(BOLD);
    expect(minted).toBe("T1");

    expect(registry.gc(new Set())).toBe(1);
    expect(registry.names()).toEqual([]);

    const next = registry.intern(BOLD); // identical fingerprint to the gc'd style
    expect(next).not.toBe("T1"); // T1 no longer exists; reusing it would be a dangling reference
    expect(next).toBe("T2");
  });

  it("gc'ing an adopted, fingerprint-matchable style also forgets its own fingerprint entry, the same as a minted one", () => {
    const existing = el(
      "style:style",
      { "style:name": "T1", "style:family": "text" },
      [el("style:text-properties", { "fo:font-weight": "bold" })],
    );
    const pkg = contentPackage([el("office:automatic-styles", {}, [existing])]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(registry.names()).toEqual(["T1"]);

    expect(registry.gc(new Set())).toBe(1);
    expect(registry.names()).toEqual([]);

    const next = registry.intern(BOLD);
    expect(next).not.toBe("T1");
    expect(next).toBe("T2");
  });
});

// The seam a writer reaches the table and graphic families through: property elements this module's own StyleProperties vocabulary has no field for, supplied already built. It exists so the table-family styles ODF requires (a column width, a row height, a cell fill and borders) are minted by THIS registry rather than by a second, parallel name-minting mechanism beside it — widening StyleProperties instead would change what the reader treats as unmodelled, which is load-bearing for the adoption rules above and for the residue channel.
describe("caller-supplied property elements", () => {
  const columnProperties = el("style:table-column-properties", {
    "style:column-width": "60pt",
  });

  it("appends them to the minted style, after whatever the property bag itself builds", () => {
    const pkg = contentPackage();
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    const name = registry.intern({
      properties: {},
      family: "table-column",
      propertyElements: [columnProperties],
    });
    expect(name).toBe("co1");
    const minted = automaticStylesOf(pkg, "content.xml").children[0];
    expect(minted).toEqual(
      el(
        "style:style",
        { "style:name": "co1", "style:family": "table-column" },
        [columnProperties],
      ),
    );
  });

  it("folds them into the fingerprint, so two element-identical requests intern to one style", () => {
    const pkg = contentPackage();
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    const request: InternRequest = {
      properties: {},
      family: "table-column",
      propertyElements: [
        el("style:table-column-properties", { "style:column-width": "60pt" }),
      ],
    };
    const first = registry.intern(request);
    const second = registry.intern({
      properties: {},
      family: "table-column",
      propertyElements: [
        el("style:table-column-properties", { "style:column-width": "60pt" }),
      ],
    });
    expect(second).toBe(first);
    expect(automaticStylesOf(pkg, "content.xml").children).toHaveLength(1);
  });

  it("distinguishes two requests whose elements differ, even when their property bags are identical", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    const narrow = registry.intern({
      properties: {},
      family: "table-column",
      propertyElements: [
        el("style:table-column-properties", { "style:column-width": "60pt" }),
      ],
    });
    const wide = registry.intern({
      properties: {},
      family: "table-column",
      propertyElements: [
        el("style:table-column-properties", { "style:column-width": "90pt" }),
      ],
    });
    expect(wide).not.toBe(narrow);
  });

  it("fingerprints an absent bag and an empty one identically, since they describe the same style", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    expect(
      registry.fingerprint({
        properties: { bold: true },
        family: "text",
        propertyElements: [],
      }),
    ).toBe(
      registry.fingerprint({ properties: { bold: true }, family: "text" }),
    );
  });
});
