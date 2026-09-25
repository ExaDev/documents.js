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

const BOLD: InternRequest = { properties: { bold: true }, family: "text" };
const CENTER_PARAGRAPH: InternRequest = {
  properties: { alignment: "center" },
  family: "paragraph",
};

describe("StyleRegistry.forPart: construction", () => {
  it("throws for a part that is not XML", () => {
    const pkg: Package = {
      parts: { "content.xml": { kind: "binary", base64: "" } },
    };
    expect(() => StyleRegistry.forPart(pkg, "content.xml")).toThrow(
      /not an XML part/,
    );
  });

  it("throws for a part with no root XML element at all", () => {
    const pkg: Package = {
      parts: { "content.xml": { kind: "xml", nodes: [] } },
    };
    expect(() => StyleRegistry.forPart(pkg, "content.xml")).toThrow(
      /no root XML element/,
    );
  });

  it("throws for a part path that is neither content.xml nor styles.xml by base name", () => {
    const pkg = contentPackage();
    pkg.parts["settings.xml"] = pkg.parts["content.xml"]!;
    expect(() => StyleRegistry.forPart(pkg, "settings.xml")).toThrow(
      /content\.xml.*styles\.xml/,
    );
  });

  it("creates office:automatic-styles when the part has none yet, inserted before office:body", () => {
    const body = el("office:body");
    const pkg = contentPackage([body]);
    StyleRegistry.forPart(pkg, "content.xml");
    const root = rootElementOf(pkg, "content.xml");
    const tags = root.children.map((c) =>
      c.type === "element" ? c.tag : c.type,
    );
    expect(tags).toEqual(["office:automatic-styles", "office:body"]);
  });

  it("appends office:automatic-styles at the end when there is nothing that must come after it", () => {
    const fontFaceDecls = el("office:font-face-decls");
    const pkg = contentPackage([fontFaceDecls]);
    StyleRegistry.forPart(pkg, "content.xml");
    const root = rootElementOf(pkg, "content.xml");
    const tags = root.children.map((c) =>
      c.type === "element" ? c.tag : c.type,
    );
    expect(tags).toEqual(["office:font-face-decls", "office:automatic-styles"]);
  });

  it("starts with no known names for a blank document", () => {
    const registry = StyleRegistry.forPart(contentPackage(), "content.xml");
    expect(registry.names()).toEqual([]);
  });

  it("resolves a part path with a directory prefix by its own base name, not the full path", () => {
    const pkg: Package = {
      parts: {
        "objects/1/content.xml": {
          kind: "xml",
          nodes: [el("office:document-content")],
        },
      },
    };
    // If the base-name extraction were ever skipped, the full path "objects/1/content.xml" would match neither "content.xml" nor "styles.xml" by strict equality and forPart would throw instead of recognising this as a content part.
    expect(() =>
      StyleRegistry.forPart(pkg, "objects/1/content.xml"),
    ).not.toThrow();
  });

  it("inserts office:automatic-styles before office:master-styles when there is no office:body", () => {
    const masterStyles = el("office:master-styles");
    const pkg = stylesPackage([masterStyles]);
    StyleRegistry.forPart(pkg, "styles.xml");
    const root = rootElementOf(pkg, "styles.xml");
    const tags = root.children.map((c) =>
      c.type === "element" ? c.tag : c.type,
    );
    expect(tags).toEqual(["office:automatic-styles", "office:master-styles"]);
  });

  it("inserts office:automatic-styles before office:settings when there is no office:body or office:master-styles", () => {
    const settings = el("office:settings");
    const pkg = stylesPackage([settings]);
    StyleRegistry.forPart(pkg, "styles.xml");
    const root = rootElementOf(pkg, "styles.xml");
    const tags = root.children.map((c) =>
      c.type === "element" ? c.tag : c.type,
    );
    expect(tags).toEqual(["office:automatic-styles", "office:settings"]);
  });
});

describe("rule (a): adoption on construction", () => {
  it("a fresh registry over a document with an existing, fully-modelled automatic style reuses that style for a matching intern() request, rather than minting a duplicate", () => {
    const existing = el(
      "style:style",
      { "style:name": "T7", "style:family": "text" },
      [el("style:text-properties", { "fo:font-weight": "bold" })],
    );
    const pkg = contentPackage([el("office:automatic-styles", {}, [existing])]);

    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(registry.names()).toContain("T7");
    expect(registry.intern(BOLD)).toBe("T7");

    // No duplicate style:style was created.
    const automaticStyles = automaticStylesOf(pkg, "content.xml");
    expect(automaticStyles.children).toHaveLength(1);
  });

  it("survives a repeated open/edit/save cycle: a style minted in one StyleRegistry instance is adopted and reused by a fresh instance constructed over the same (now-saved) part afterwards", () => {
    const pkg = contentPackage();
    const first = StyleRegistry.forPart(pkg, "content.xml");
    const mintedName = first.intern(CENTER_PARAGRAPH);

    // Simulate closing and reopening the document: construct an entirely new StyleRegistry over the same, now-mutated package.
    const second = StyleRegistry.forPart(pkg, "content.xml");
    expect(second.names()).toContain(mintedName);
    expect(second.intern(CENTER_PARAGRAPH)).toBe(mintedName);

    // And a third cycle, for good measure — this has to keep working, not just work once.
    const third = StyleRegistry.forPart(pkg, "content.xml");
    expect(third.intern(CENTER_PARAGRAPH)).toBe(mintedName);
    expect(automaticStylesOf(pkg, "content.xml").children).toHaveLength(1);
  });

  it("skips non-element children and a style:style missing style:name/style:family/a recognised family, without erroring, during adoption", () => {
    const goodStyle = el(
      "style:style",
      { "style:name": "T1", "style:family": "text" },
      [el("style:text-properties", { "fo:font-weight": "bold" })],
    );
    const noName = el("style:style", { "style:family": "text" });
    const noFamily = el("style:style", { "style:name": "T2" });
    const unrecognisedFamily = el("style:style", {
      "style:name": "T3",
      "style:family": "ruby",
    }); // a real ODF family this registry does not manage
    const pkg = contentPackage([
      el("office:automatic-styles", {}, [
        txt("\n  "),
        goodStyle,
        noName,
        noFamily,
        unrecognisedFamily,
      ]),
    ]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(registry.names()).toEqual(["T1"]);
    expect(
      registry.intern({ properties: { bold: true }, family: "text" }),
    ).toBe("T1");
  });

  it("when two adopted styles coincidentally share an identical fingerprint, the first one in document order wins the fingerprint match, deterministically", () => {
    const first = el(
      "style:style",
      { "style:name": "T1", "style:family": "text" },
      [el("style:text-properties", { "fo:font-weight": "bold" })],
    );
    const second = el(
      "style:style",
      { "style:name": "T2", "style:family": "text" },
      [el("style:text-properties", { "fo:font-weight": "bold" })],
    );
    const pkg = contentPackage([
      el("office:automatic-styles", {}, [first, second]),
    ]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(registry.intern(BOLD)).toBe("T1");
  });

  it("gracefully ignores an otherPart reference whose part does not exist (or is not XML) in the given package, rather than erroring", () => {
    const pkg = contentPackage();
    const registryMissing = StyleRegistry.forPart(pkg, "content.xml", {
      otherPart: { pkg, partPath: "styles.xml" },
    });
    expect(registryMissing.intern(CENTER_PARAGRAPH)).toBe("P1");

    pkg.parts["styles.xml"] = { kind: "binary", base64: "" };
    const registryBinary = StyleRegistry.forPart(
      contentPackage(),
      "content.xml",
      { otherPart: { pkg, partPath: "styles.xml" } },
    );
    expect(registryBinary.intern(CENTER_PARAGRAPH)).toBe("P1");
  });

  it("adopts styles.xml's own automatic-styles when constructed for styles.xml", () => {
    const existing = el(
      "style:style",
      { "style:name": "PS3", "style:family": "paragraph" },
      [el("style:paragraph-properties", { "fo:text-align": "right" })],
    );
    const pkg = stylesPackage([el("office:automatic-styles", {}, [existing])]);
    const registry = StyleRegistry.forPart(pkg, "styles.xml");
    expect(
      registry.intern({
        properties: { alignment: "right" },
        family: "paragraph",
      }),
    ).toBe("PS3");
  });

  it("does not adopt or reserve a differently-tagged element carrying style:name/style:family attributes shaped just like a real style:style", () => {
    const impostor = el("style:default-style", {
      "style:name": "T1",
      "style:family": "text",
    });
    const pkg = contentPackage([el("office:automatic-styles", {}, [impostor])]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(registry.names()).toEqual([]);
    // If the impostor's own tag were never checked, "T1" would already be reserved and this mint would have to skip straight to "T2".
    expect(registry.intern(BOLD)).toBe("T1");
  });

  it("adopts an existing style's own style:parent-style-name into its fingerprint, distinguishing a matching request from one with no parent", () => {
    const existing = el(
      "style:style",
      {
        "style:name": "P5",
        "style:family": "paragraph",
        "style:parent-style-name": "Heading1",
      },
      [el("style:paragraph-properties", { "fo:text-align": "center" })],
    );
    const pkg = contentPackage([el("office:automatic-styles", {}, [existing])]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");
    expect(
      registry.intern({
        properties: { alignment: "center" },
        family: "paragraph",
        parentStyleName: "Heading1",
      }),
    ).toBe("P5");
    expect(
      registry.intern({
        properties: { alignment: "center" },
        family: "paragraph",
      }),
    ).not.toBe("P5");
  });
});

describe("rule (b): unknown attributes opt a style out of reuse, not out of existence", () => {
  it("reserves the name of an adopted style with an unmodelled attribute, but mints a genuinely different name for a matching intern() request", () => {
    // fo:margin-right is real, valid ODF — and entirely unmodelled by properties.ts.
    const unmodelled = el(
      "style:style",
      { "style:name": "P1", "style:family": "paragraph" },
      [
        el("style:paragraph-properties", {
          "fo:text-align": "center",
          "fo:margin-right": "2cm",
        }),
      ],
    );
    const pkg = contentPackage([
      el("office:automatic-styles", {}, [unmodelled]),
    ]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");

    expect(registry.names()).toContain("P1");

    // A request whose properties match everything parseable on P1 (alignment: center) must NOT reuse P1's name — P1's fingerprint was never registered, precisely because of the unmodelled fo:margin-right.
    const mintedName = registry.intern(CENTER_PARAGRAPH);
    expect(mintedName).not.toBe("P1");
    expect(mintedName).toBe("P2"); // "P1" is reserved, so minting skips straight to "P2".

    const automaticStyles = automaticStylesOf(pkg, "content.xml");
    expect(automaticStyles.children).toHaveLength(2);
    const names = automaticStyles.children.map((c) =>
      c.type === "element"
        ? c.attributes.find((a) => a.name === "style:name")?.value
        : undefined,
    );
    expect(names).toEqual(["P1", "P2"]);
  });

  it("never re-mints the reserved name itself, even across many intern() calls for the same family", () => {
    const unmodelled = el(
      "style:style",
      { "style:name": "P1", "style:family": "paragraph" },
      [
        el("style:paragraph-properties", {
          "fo:text-align": "left",
          "style:auto-text-indent": "false",
        }),
      ],
    );
    const pkg = contentPackage([
      el("office:automatic-styles", {}, [unmodelled]),
    ]);
    const registry = StyleRegistry.forPart(pkg, "content.xml");

    const iterationCount = 5;
    const names = new Set<string>();
    for (let i = 0; i < iterationCount; i += 1) {
      names.add(
        registry.intern({
          properties: { indentFirstLinePt: i + 1 },
          family: "paragraph",
        }),
      );
    }
    expect(names.has("P1")).toBe(false);
    expect([...names].sort()).toEqual(["P2", "P3", "P4", "P5", "P6"]);
  });
});
