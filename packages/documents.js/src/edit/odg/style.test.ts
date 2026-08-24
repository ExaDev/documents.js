import { describe, expect, it } from "vitest";
import { attr } from "ooxml.js";
import { assertAutomaticStylesOnlyAppended } from "../../test-support/odf-style-fidelity";
import { createEmptyOdgPackage } from "./scaffold";
import {
  buildGraphicStyle,
  readGraphicFill,
  readGraphicStroke,
  setGraphicFill,
  setGraphicStroke,
} from "./style";
import { el } from "../../xml/fragment";
import type { Package, XmlElement } from "odf.js";

const RED = { r: 1, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 1 };

describe("buildGraphicStyle / readGraphicFill / readGraphicStroke", () => {
  it("a style with both fill and stroke round-trips both back", () => {
    const pkg = createEmptyOdgPackage();
    const name = buildGraphicStyle(pkg, {
      fill: RED,
      stroke: { color: BLUE, widthPt: 2 },
    });
    const element = el("draw:rect", { "draw:style-name": name });
    expect(readGraphicFill(pkg, element)).toEqual(RED);
    expect(readGraphicStroke(pkg, element)).toEqual({
      color: BLUE,
      widthPt: 2,
    });
  });

  it('a style with neither reads back as no fill and no stroke (explicit draw:fill="none"/draw:stroke="none", matching real LibreOffice output)', () => {
    const pkg = createEmptyOdgPackage();
    const name = buildGraphicStyle(pkg, {});
    const element = el("draw:rect", { "draw:style-name": name });
    expect(readGraphicFill(pkg, element)).toBeUndefined();
    expect(readGraphicStroke(pkg, element)).toBeUndefined();
  });

  it("an element with no draw:style-name at all reads as no fill and no stroke", () => {
    const pkg = createEmptyOdgPackage();
    const element = el("draw:rect");
    expect(readGraphicFill(pkg, element)).toBeUndefined();
    expect(readGraphicStroke(pkg, element)).toBeUndefined();
  });

  it("mints a fresh style:style[family=graphic] entry in content.xml's office:automatic-styles", () => {
    const pkg = createEmptyOdgPackage();
    const name = buildGraphicStyle(pkg, { fill: RED });
    const part = pkg.parts["content.xml"];
    const root =
      part?.kind === "xml"
        ? part.nodes.find((n) => n.type === "element")
        : undefined;
    const body =
      root?.type === "element"
        ? root.children.find(
            (c) => c.type === "element" && c.tag === "office:automatic-styles",
          )
        : undefined;
    const style =
      body?.type === "element"
        ? body.children.find(
            (c) =>
              c.type === "element" &&
              c.tag === "style:style" &&
              attr(c, "style:name") === name,
          )
        : undefined;
    expect(style).toBeDefined();
    expect(
      style?.type === "element" ? attr(style, "style:family") : undefined,
    ).toBe("graphic");
  });
});

function graphicPropertiesFor(
  pkg: Package,
  styleName: string,
): XmlElement | undefined {
  const part = pkg.parts["content.xml"];
  const root =
    part?.kind === "xml"
      ? part.nodes.find((n): n is XmlElement => n.type === "element")
      : undefined;
  const automaticStyles = root?.children.find(
    (c): c is XmlElement =>
      c.type === "element" && c.tag === "office:automatic-styles",
  );
  const style = automaticStyles?.children.find(
    (c): c is XmlElement =>
      c.type === "element" &&
      c.tag === "style:style" &&
      attr(c, "style:name") === styleName,
  );
  return style?.children.find(
    (c): c is XmlElement =>
      c.type === "element" && c.tag === "style:graphic-properties",
  );
}

// Confirmed against real LibreOffice 26.2 rendering, not merely against this module's own reader: a draw:path with draw:fill-color but no draw:fill="solid" renders with NO fill at all in real LibreOffice, even though the identical omission on a draw:rect/draw:ellipse happens to render filled fine. Writing draw:fill="solid" explicitly whenever a fill colour is set removes that shape-type-dependent inconsistency, matching ODF's own draw:fill enumeration (none/solid/gradient/hatch/bitmap) instead of leaving the fill TYPE to be inferred from which other attributes happen to be present.
describe("buildGraphicStyle: draw:fill is always explicit, never inferred", () => {
  it('writes draw:fill="solid" alongside draw:fill-color when a fill colour is set', () => {
    const pkg = createEmptyOdgPackage();
    const name = buildGraphicStyle(pkg, { fill: RED });
    const props = graphicPropertiesFor(pkg, name);
    expect(props === undefined ? undefined : attr(props, "draw:fill")).toBe(
      "solid",
    );
    expect(
      props === undefined ? undefined : attr(props, "draw:fill-color"),
    ).toBe("#ff0000");
  });

  it('writes draw:fill="none" and no draw:fill-color at all when no fill is set', () => {
    const pkg = createEmptyOdgPackage();
    const name = buildGraphicStyle(pkg, {
      stroke: { color: BLUE, widthPt: 1 },
    });
    const props = graphicPropertiesFor(pkg, name);
    expect(props === undefined ? undefined : attr(props, "draw:fill")).toBe(
      "none",
    );
    expect(
      props === undefined ? undefined : attr(props, "draw:fill-color"),
    ).toBeUndefined();
  });
});

describe("setGraphicFill / setGraphicStroke", () => {
  it("setGraphicFill preserves the element's existing stroke", () => {
    const pkg = createEmptyOdgPackage();
    const name = buildGraphicStyle(pkg, {
      stroke: { color: BLUE, widthPt: 3 },
    });
    const element = el("draw:rect", { "draw:style-name": name });
    setGraphicFill(pkg, element, RED);
    expect(readGraphicFill(pkg, element)).toEqual(RED);
    expect(readGraphicStroke(pkg, element)).toEqual({
      color: BLUE,
      widthPt: 3,
    });
  });

  it("setGraphicStroke preserves the element's existing fill", () => {
    const pkg = createEmptyOdgPackage();
    const name = buildGraphicStyle(pkg, { fill: RED });
    const element = el("draw:rect", { "draw:style-name": name });
    setGraphicStroke(pkg, element, { color: BLUE, widthPt: 1 });
    expect(readGraphicFill(pkg, element)).toEqual(RED);
    expect(readGraphicStroke(pkg, element)).toEqual({
      color: BLUE,
      widthPt: 1,
    });
  });

  it("setting a value to undefined clears it without disturbing the other", () => {
    const pkg = createEmptyOdgPackage();
    const name = buildGraphicStyle(pkg, {
      fill: RED,
      stroke: { color: BLUE, widthPt: 1 },
    });
    const element = el("draw:rect", { "draw:style-name": name });
    setGraphicFill(pkg, element, undefined);
    expect(readGraphicFill(pkg, element)).toBeUndefined();
    expect(readGraphicStroke(pkg, element)).toEqual({
      color: BLUE,
      widthPt: 1,
    });
  });

  it("never mutates or removes a pre-existing automatic style entry -- only ever appends a new one", () => {
    const pkg = createEmptyOdgPackage();
    const name = buildGraphicStyle(pkg, { fill: RED });
    const element = el("draw:rect", { "draw:style-name": name });
    const before = structuredClone(pkg);
    setGraphicStroke(pkg, element, { color: BLUE, widthPt: 1 });
    assertAutomaticStylesOnlyAppended(before, pkg);
  });
});
