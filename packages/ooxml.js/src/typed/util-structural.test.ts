import { describe, expect, it } from "vitest";
import type { Package } from "../model/package";
import { el, txt } from "../xml/fragment";
import {
  attr,
  childrenWithTag,
  elementsWithTag,
  resolveRelationships,
  rootElement,
  walk,
} from "./util";

// Direct structural coverage for util.ts's tree-walk and relationship-resolution primitives, which relsPathFor/resolveRelTarget/textContent's own util.test.ts leaves untouched.

describe("walk", () => {
  it("yields a flat list of nodes in document order with no descent", () => {
    const nodes = [txt("a"), txt("b")];
    expect([...walk(nodes)]).toEqual(nodes);
  });

  it("descends depth-first into element children, yielding parent before its children", () => {
    const child = el("child", {}, [txt("leaf")]);
    const parent = el("parent", {}, [child]);
    const visited = [...walk([parent])];
    expect(visited).toEqual([parent, child, txt("leaf")]);
  });

  it("does not descend into a text or cdata node", () => {
    const node = { type: "cdata" as const, value: "raw" };
    expect([...walk([node])]).toEqual([node]);
  });
});

describe("elementsWithTag", () => {
  it("finds a matching element at any depth, not just direct children", () => {
    const target = el("target", {}, []);
    const tree = el("root", {}, [el("wrapper", {}, [target])]);
    expect(elementsWithTag([tree], "target")).toEqual([target]);
  });

  it("returns every match in document order when several share the tag", () => {
    const first = el("item", { id: "1" });
    const second = el("item", { id: "2" });
    const tree = el("root", {}, [first, el("wrapper", {}, [second])]);
    expect(elementsWithTag([tree], "item")).toEqual([first, second]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(elementsWithTag([el("root", {}, [])], "missing")).toEqual([]);
  });

  it("does not match a text node even if it shares no tag concept", () => {
    expect(elementsWithTag([txt("root")], "root")).toEqual([]);
  });
});

describe("childrenWithTag", () => {
  it("finds only DIRECT children with the tag, not a nested descendant", () => {
    const nested = el("item");
    const tree = el("root", {}, [el("wrapper", {}, [nested])]);
    expect(childrenWithTag(tree, "item")).toEqual([]);
  });

  it("returns every direct child sharing the tag, in order", () => {
    const first = el("item", { id: "1" });
    const second = el("item", { id: "2" });
    const other = el("other");
    const tree = el("root", {}, [first, other, second]);
    expect(childrenWithTag(tree, "item")).toEqual([first, second]);
  });

  it("skips a text child when searching by tag", () => {
    const tree = el("root", {}, [txt("stray text"), el("item")]);
    expect(childrenWithTag(tree, "item")).toEqual([el("item")]);
  });
});

describe("attr", () => {
  it("returns the value of a matching attribute", () => {
    expect(attr(el("e", { id: "42" }), "id")).toBe("42");
  });

  it("returns undefined when the attribute is absent", () => {
    expect(attr(el("e", {}), "id")).toBeUndefined();
  });

  it("finds the correct attribute among several", () => {
    expect(attr(el("e", { a: "1", b: "2", c: "3" }), "b")).toBe("2");
  });
});

describe("rootElement", () => {
  it("returns undefined for an undefined part", () => {
    expect(rootElement(undefined)).toBeUndefined();
  });

  it("returns undefined for a binary part", () => {
    expect(rootElement({ kind: "binary", base64: "" })).toBeUndefined();
  });

  it("skips a leading non-element node (an <?xml?> declaration) to find the root element", () => {
    const root = el("root");
    expect(
      rootElement({
        kind: "xml",
        nodes: [{ type: "text", value: "" }, root],
      }),
    ).toBe(root);
  });

  it("returns undefined when an xml part has no element node at all", () => {
    expect(
      rootElement({ kind: "xml", nodes: [{ type: "text", value: "x" }] }),
    ).toBeUndefined();
  });
});

describe("resolveRelationships", () => {
  function pkgWithRels(relsXml: ReturnType<typeof el>[]): Package {
    return {
      parts: {
        "word/_rels/document.xml.rels": {
          kind: "xml",
          nodes: [el("Relationships", {}, relsXml)],
        },
      },
    };
  }

  it("returns an empty map when the .rels part is absent", () => {
    expect(resolveRelationships({ parts: {} }, "word/document.xml")).toEqual(
      new Map(),
    );
  });

  it("resolves an internal relationship target relative to the subject part's directory", () => {
    const pkg = pkgWithRels([
      el("Relationship", {
        Id: "rId1",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        Target: "media/image1.png",
      }),
    ]);
    const map = resolveRelationships(pkg, "word/document.xml");
    expect(map.get("rId1")).toEqual({
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      target: "word/media/image1.png",
      targetMode: undefined,
    });
  });

  it("keeps an External target verbatim rather than resolving it as a package path", () => {
    const pkg = pkgWithRels([
      el("Relationship", {
        Id: "rId1",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        Target: "https://example.com/",
        TargetMode: "External",
      }),
    ]);
    const map = resolveRelationships(pkg, "word/document.xml");
    expect(map.get("rId1")).toEqual({
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
      target: "https://example.com/",
      targetMode: "External",
    });
  });

  it("skips a Relationship element missing Id, Type, or Target", () => {
    const pkg = pkgWithRels([
      el("Relationship", { Type: "t", Target: "x" }),
      el("Relationship", { Id: "rId1", Target: "x" }),
      el("Relationship", { Id: "rId2", Type: "t" }),
    ]);
    expect(resolveRelationships(pkg, "word/document.xml")).toEqual(new Map());
  });

  it("entity-decodes an internal target before resolving it, so an '&' in the path matches the real package key", () => {
    const pkg = pkgWithRels([
      el("Relationship", {
        Id: "rId1",
        Type: "t",
        Target: "media/A&amp;B.png",
      }),
    ]);
    const map = resolveRelationships(pkg, "word/document.xml");
    expect(map.get("rId1")?.target).toBe("word/media/A&B.png");
  });

  it("entity-decodes the relationship Type attribute too", () => {
    const pkg = pkgWithRels([
      el("Relationship", {
        Id: "rId1",
        Type: "http://example.com/A&amp;B",
        Target: "x",
      }),
    ]);
    const map = resolveRelationships(pkg, "word/document.xml");
    expect(map.get("rId1")?.type).toBe("http://example.com/A&B");
  });
});
