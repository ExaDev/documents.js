import { describe, expect, it } from "vitest";
import type { Package, XmlElement } from "odf.js";
import { attr } from "ooxml.js";
import { el } from "../../xml/fragment";
import { createOdt } from "./editor";
import {
  ensureAutomaticStyles,
  ensurePageBreakStyleName,
  nextStyleName,
} from "./automatic-styles";

// The whole module at unit level: the three refusals and two creation positions of ensureAutomaticStyles, the strict numeric scan of nextStyleName, and the idempotent page-break style.

function packageWithRoot(root: XmlElement): Package {
  return {
    parts: { "content.xml": { kind: "xml", nodes: [root] } },
  };
}

describe("ensureAutomaticStyles", () => {
  it("a package without a content.xml part refuses", () => {
    expect(() => ensureAutomaticStyles({ parts: {} })).toThrow(
      "ensureAutomaticStyles: package has no content.xml part",
    );
  });

  it("a content part with no root element refuses", () => {
    expect(() =>
      ensureAutomaticStyles({
        parts: { "content.xml": { kind: "xml", nodes: [] } },
      }),
    ).toThrow("ensureAutomaticStyles: content.xml has no root element");
  });

  it("an existing office:automatic-styles is returned, not duplicated", () => {
    const existing = el("office:automatic-styles");
    const root = el("office:document-content", {}, [existing]);
    const pkg = packageWithRoot(root);
    expect(ensureAutomaticStyles(pkg)).toBe(existing);
    expect(
      root.children.filter(
        (c) => c.type === "element" && c.tag === "office:automatic-styles",
      ),
    ).toHaveLength(1);
  });

  it("a missing element is inserted before office:body, keeping the document order ODF requires", () => {
    const root = el("office:document-content", {}, [
      el("office:font-face-decls"),
      el("office:body"),
    ]);
    const created = ensureAutomaticStyles(packageWithRoot(root));
    expect(created.tag).toBe("office:automatic-styles");
    const tags = root.children
      .filter((c): c is XmlElement => c.type === "element")
      .map((c) => c.tag);
    expect(tags).toEqual([
      "office:font-face-decls",
      "office:automatic-styles",
      "office:body",
    ]);
  });

  it("with no element to insert before, it is appended", () => {
    const root = el("office:document-content", {}, [
      el("office:font-face-decls"),
    ]);
    const created = ensureAutomaticStyles(packageWithRoot(root));
    const last = [...root.children]
      .reverse()
      .find((c): c is XmlElement => c.type === "element");
    expect(last).toBe(created);
  });

  it("a real editor package already carries the element", () => {
    const editor = createOdt();
    const styles = ensureAutomaticStyles(editor.toPackage());
    expect(styles.tag).toBe("office:automatic-styles");
  });
});

describe("nextStyleName", () => {
  it("one past the highest strict-numeric name, ignoring look-alikes", () => {
    const styles = el("office:automatic-styles", {}, [
      el("style:style", { "style:name": "P1" }),
      el("style:style", { "style:name": "P3" }),
      el("style:style", { "style:name": "Pother" }),
      el("style:style", { "style:name": "P01" }),
      el("style:style", { "style:name": "P2x" }),
      el("style:paragraph-properties", { "style:name": "P9" }),
    ]);
    expect(nextStyleName(styles, "style:style", "P")).toBe("P4");
  });

  it("no matching names at all starts at one", () => {
    expect(
      nextStyleName(el("office:automatic-styles"), "style:style", "P"),
    ).toBe("P1");
  });
});

describe("ensurePageBreakStyleName", () => {
  it("creates the style once, with the break-before property, and returns the same name after", () => {
    const editor = createOdt();
    const pkg = editor.toPackage();
    const first = ensurePageBreakStyleName(pkg);
    expect(first).toBe("OdtPageBreak");
    const styles = ensureAutomaticStyles(pkg);
    const styleElements = styles.children.filter(
      (c): c is XmlElement =>
        c.type === "element" &&
        c.tag === "style:style" &&
        attr(c, "style:name") === "OdtPageBreak",
    );
    expect(styleElements).toHaveLength(1);
    expect(attr(styleElements[0]!, "style:family")).toBe("paragraph");
    const properties = styleElements[0]?.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:paragraph-properties",
    );
    expect(attr(properties!, "fo:break-before")).toBe("page");

    const second = ensurePageBreakStyleName(pkg);
    expect(second).toBe("OdtPageBreak");
    expect(
      styles.children.filter(
        (c): c is XmlElement =>
          c.type === "element" &&
          c.tag === "style:style" &&
          attr(c, "style:name") === "OdtPageBreak",
      ),
    ).toHaveLength(1);
  });
});
