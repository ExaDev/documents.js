import {
  decodePackage,
  encodePackage,
  rootElement,
  validateManifest,
} from "odf.js";
import { describe, expect, it } from "vitest";
import { createEmptyOdpPackage } from "./scaffold";

describe("createEmptyOdpPackage", () => {
  it("has every part a minimal odp needs", () => {
    const pkg = createEmptyOdpPackage();
    expect(Object.keys(pkg.parts).sort()).toEqual(
      [
        "META-INF/manifest.xml",
        "content.xml",
        "meta.xml",
        "mimetype",
        "styles.xml",
      ].sort(),
    );
  });

  it("round-trips through encodePackage/decodePackage unchanged", () => {
    const pkg = createEmptyOdpPackage();
    expect(decodePackage(encodePackage(pkg))).toEqual(pkg);
  });

  it("declares the odp media type and a manifest with no validation problems", () => {
    const pkg = createEmptyOdpPackage();
    const mimetype = pkg.parts.mimetype;
    expect(mimetype?.kind).toBe("binary");
    expect(validateManifest(pkg)).toEqual([]);
  });

  it("has an office:body/office:presentation element in content.xml, with no slides yet", () => {
    const pkg = createEmptyOdpPackage();
    const root = rootElement(
      pkg.parts["content.xml"]?.kind === "xml"
        ? pkg.parts["content.xml"].nodes
        : [],
    );
    expect(root?.tag).toBe("office:document-content");
    const body = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:body",
    );
    const presentation =
      body?.type === "element"
        ? body.children.find(
            (c) => c.type === "element" && c.tag === "office:presentation",
          )
        : undefined;
    expect(presentation).toBeDefined();
    expect(
      presentation?.type === "element" ? presentation.children : undefined,
    ).toEqual([]);
  });

  it("defines the Heading_20_N paragraph styles in styles.xml office:styles, so a text-box heading's style reference resolves", () => {
    const pkg = createEmptyOdpPackage();
    const root = rootElement(
      pkg.parts["styles.xml"]?.kind === "xml"
        ? pkg.parts["styles.xml"].nodes
        : [],
    );
    const officeStyles = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:styles",
    );
    const heading2 =
      officeStyles?.type === "element"
        ? officeStyles.children.find(
            (c) =>
              c.type === "element" &&
              c.tag === "style:style" &&
              c.attributes.some(
                (a) => a.name === "style:name" && a.value === "Heading_20_2",
              ),
          )
        : undefined;
    expect(heading2).toBeDefined();
    const textProperties =
      heading2?.type === "element"
        ? heading2.children.find(
            (c) => c.type === "element" && c.tag === "style:text-properties",
          )
        : undefined;
    expect(
      textProperties?.type === "element"
        ? textProperties.attributes
        : undefined,
    ).toContainEqual({ name: "fo:font-size", value: "22pt" });
    expect(
      textProperties?.type === "element"
        ? textProperties.attributes
        : undefined,
    ).toContainEqual({ name: "fo:font-weight", value: "bold" });
  });

  it("has a page-layout -> master-page chain in styles.xml, declaring the standard 16:9 widescreen size", () => {
    const pkg = createEmptyOdpPackage();
    const root = rootElement(
      pkg.parts["styles.xml"]?.kind === "xml"
        ? pkg.parts["styles.xml"].nodes
        : [],
    );
    const automaticStyles = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:automatic-styles",
    );
    const pageLayout =
      automaticStyles?.type === "element"
        ? automaticStyles.children.find(
            (c) => c.type === "element" && c.tag === "style:page-layout",
          )
        : undefined;
    expect(pageLayout).toBeDefined();
    const properties =
      pageLayout?.type === "element"
        ? pageLayout.children.find(
            (c) =>
              c.type === "element" && c.tag === "style:page-layout-properties",
          )
        : undefined;
    expect(
      properties?.type === "element" ? properties.attributes : undefined,
    ).toContainEqual({ name: "fo:page-width", value: "960pt" });
    expect(
      properties?.type === "element" ? properties.attributes : undefined,
    ).toContainEqual({ name: "fo:page-height", value: "540pt" });
    const masterStyles = root?.children.find(
      (c) => c.type === "element" && c.tag === "office:master-styles",
    );
    const masterPage =
      masterStyles?.type === "element"
        ? masterStyles.children.find(
            (c) => c.type === "element" && c.tag === "style:master-page",
          )
        : undefined;
    expect(masterPage).toBeDefined();
  });
});
