import { describe, expect, it } from "vitest";
import type { XmlElement } from "../model/node";
import { el, txt } from "../xml/fragment";
import {
  propertyTypesForContainer,
  splitStyleProperties,
  mergeStyleProperties,
} from "./properties";

// This module had no direct unit tests at all -- every reader/writer that touches it only exercises it indirectly through a whole-document round trip. Direct coverage below targets propertyTypesForContainer's own routing branches, splitStyleProperties' first-match-wins/fallback-to-first-candidate routing (including the two OpenOffice.org compound-attribute expansions), and mergeStyleProperties' found/not-found and multi-child concatenation behaviour.

describe("propertyTypesForContainer", () => {
  it("resolves a container tag with no style:family attribute at all, e.g. style:page-master", () => {
    expect(propertyTypesForContainer(el("style:page-master"))).toEqual([
      "page-layout",
    ]);
  });

  it("resolves a number:*-style container tag to ['text']", () => {
    expect(propertyTypesForContainer(el("number:date-style"))).toEqual([
      "text",
    ]);
  });

  it("resolves style:style by its own style:family attribute", () => {
    expect(
      propertyTypesForContainer(
        el("style:style", { "style:family": "table-cell" }),
      ),
    ).toEqual(["table-cell", "paragraph", "text"]);
  });

  it("resolves style:default-style by its own style:family attribute exactly like style:style", () => {
    expect(
      propertyTypesForContainer(
        el("style:default-style", { "style:family": "paragraph" }),
      ),
    ).toEqual(["paragraph", "text"]);
  });

  it("returns undefined for style:style with no style:family attribute at all", () => {
    expect(propertyTypesForContainer(el("style:style"))).toBeUndefined();
  });

  it("returns undefined for style:style whose style:family this module does not recognise", () => {
    expect(
      propertyTypesForContainer(
        el("style:style", { "style:family": "unknown-family" }),
      ),
    ).toBeUndefined();
  });

  it("returns undefined for a container tag this module recognises neither by tag nor as a family-bearing style element", () => {
    expect(propertyTypesForContainer(el("office:styles"))).toBeUndefined();
  });

  it("returns undefined for a non-style:style/default-style tag even when it happens to carry a recognised style:family attribute, since only style:style/default-style consult it", () => {
    expect(
      propertyTypesForContainer(
        el("office:styles", { "style:family": "paragraph" }),
      ),
    ).toBeUndefined();
  });
});

describe("splitStyleProperties: attribute routing", () => {
  it("routes an attribute to the first candidate whose vocabulary claims it", () => {
    // fo:background-color is claimed by table-cell, paragraph, and graphic alike; with table-cell first in the candidate list it must win, not paragraph.
    const properties = el("style:properties", {
      "fo:background-color": "#ff0000",
    });
    const split = splitStyleProperties(properties, [
      "table-cell",
      "paragraph",
      "text",
    ]);
    expect(split).toHaveLength(1);
    expect(split[0]?.tag).toBe("style:table-cell-properties");
  });

  it("routes the identical attribute to paragraph instead, when paragraph is first in the candidate list", () => {
    const properties = el("style:properties", {
      "fo:background-color": "#ff0000",
    });
    const split = splitStyleProperties(properties, ["paragraph", "text"]);
    expect(split).toHaveLength(1);
    expect(split[0]?.tag).toBe("style:paragraph-properties");
  });

  it("falls back to the first candidate for an attribute no candidate's vocabulary claims", () => {
    const properties = el("style:properties", {
      "draw:some-unlisted-attribute": "x",
    });
    const split = splitStyleProperties(properties, ["graphic", "paragraph"]);
    expect(split).toHaveLength(1);
    expect(split[0]?.tag).toBe("style:graphic-properties");
  });

  it("emits one typed element per candidate that actually received something, in candidate order, and none for a candidate that received nothing", () => {
    const properties = el("style:properties", {
      "fo:font-family": "Arial", // text-only
      "fo:margin-top": "2pt", // paragraph-only
    });
    const split = splitStyleProperties(properties, [
      "table-cell",
      "paragraph",
      "text",
    ]);
    expect(split.map((s) => s.tag)).toEqual([
      "style:paragraph-properties",
      "style:text-properties",
    ]);
  });

  it("skips non-element children (whitespace/comment text nodes) without filing them into any family", () => {
    const properties = el("style:properties", {}, [txt("   ")]);
    const split = splitStyleProperties(properties, ["paragraph", "text"]);
    expect(split).toHaveLength(0);
  });

  it("routes a style:properties child element the identical first-match way attributes are routed", () => {
    const tabStops = el("style:tab-stops");
    const properties = el("style:properties", {}, [tabStops]);
    const split = splitStyleProperties(properties, ["paragraph", "text"]);
    expect(split).toHaveLength(1);
    expect(split[0]?.tag).toBe("style:paragraph-properties");
    expect(split[0]?.children).toEqual([tabStops]);
  });

  it("throws rather than silently dropping an attribute when the candidate list is empty, since a family with zero property types is a caller programming error, not a routable input", () => {
    const properties = el("style:properties", { "fo:color": "#000000" });
    expect(() => splitStyleProperties(properties, [])).toThrow(
      "a style family must have at least one property type",
    );
  });
});

describe("splitStyleProperties: style:text-underline expansion", () => {
  function underlineStyleOf(value: string): XmlElement | undefined {
    const properties = el("style:properties", {
      "style:text-underline": value,
    });
    const split = splitStyleProperties(properties, ["text"]);
    return split[0];
  }

  it('"single" expands to style: "solid" alone, no width or type attribute', () => {
    const result = underlineStyleOf("single");
    expect(result?.attributes).toEqual([
      { name: "style:text-underline-style", value: "solid" },
    ]);
  });

  it('"double" expands to style: "solid" plus type: "double"', () => {
    const result = underlineStyleOf("double");
    expect(result?.attributes).toEqual([
      { name: "style:text-underline-style", value: "solid" },
      { name: "style:text-underline-type", value: "double" },
    ]);
  });

  it('"bold" expands to style: "solid" plus width: "bold"', () => {
    const result = underlineStyleOf("bold");
    expect(result?.attributes).toEqual([
      { name: "style:text-underline-style", value: "solid" },
      { name: "style:text-underline-width", value: "bold" },
    ]);
  });

  it("a value with no listed expansion passes straight through as the style itself", () => {
    const result = underlineStyleOf("dotted");
    expect(result?.attributes).toEqual([
      { name: "style:text-underline-style", value: "dotted" },
    ]);
  });
});

describe("splitStyleProperties: style:text-crossing-out expansion", () => {
  function lineThroughStyleOf(value: string): XmlElement | undefined {
    const properties = el("style:properties", {
      "style:text-crossing-out": value,
    });
    const split = splitStyleProperties(properties, ["text"]);
    return split[0];
  }

  it('"single-line" expands to style: "solid" alone', () => {
    expect(lineThroughStyleOf("single-line")?.attributes).toEqual([
      { name: "style:text-line-through-style", value: "solid" },
    ]);
  });

  it('"slash" expands to style: "solid" plus text: "/"', () => {
    expect(lineThroughStyleOf("slash")?.attributes).toEqual([
      { name: "style:text-line-through-style", value: "solid" },
      { name: "style:text-line-through-text", value: "/" },
    ]);
  });

  it('"X" expands to style: "solid" plus text: "X"', () => {
    expect(lineThroughStyleOf("X")?.attributes).toEqual([
      { name: "style:text-line-through-style", value: "solid" },
      { name: "style:text-line-through-text", value: "X" },
    ]);
  });

  it('"double-line" expands to style: "solid" plus type: "double"', () => {
    expect(lineThroughStyleOf("double-line")?.attributes).toEqual([
      { name: "style:text-line-through-style", value: "solid" },
      { name: "style:text-line-through-type", value: "double" },
    ]);
  });

  it('"thick-line" expands to style: "solid" plus width: "bold"', () => {
    expect(lineThroughStyleOf("thick-line")?.attributes).toEqual([
      { name: "style:text-line-through-style", value: "solid" },
      { name: "style:text-line-through-width", value: "bold" },
    ]);
  });

  it("a value with no listed expansion passes straight through as the style itself", () => {
    expect(lineThroughStyleOf("dash")?.attributes).toEqual([
      { name: "style:text-line-through-style", value: "dash" },
    ]);
  });
});

describe("splitStyleProperties: fo:keep-with-next boolean-to-keyword rewrite", () => {
  it('"true" becomes "always"', () => {
    const properties = el("style:properties", { "fo:keep-with-next": "true" });
    const split = splitStyleProperties(properties, ["paragraph"]);
    expect(split[0]?.attributes).toEqual([
      { name: "fo:keep-with-next", value: "always" },
    ]);
  });

  it('anything other than "true" (e.g. "false") becomes "auto"', () => {
    const properties = el("style:properties", {
      "fo:keep-with-next": "false",
    });
    const split = splitStyleProperties(properties, ["paragraph"]);
    expect(split[0]?.attributes).toEqual([
      { name: "fo:keep-with-next", value: "auto" },
    ]);
  });
});

describe("mergeStyleProperties", () => {
  it("returns merged: undefined and the input untouched when no typed properties child is present", () => {
    const other = el("style:map");
    const result = mergeStyleProperties([other]);
    expect(result.merged).toBeUndefined();
    expect(result.rest).toEqual([other]);
  });

  it("concatenates a single typed properties element's own attributes and children into one style:properties", () => {
    const textProps = el("style:text-properties", { "fo:color": "#000000" }, [
      el("style:some-child"),
    ]);
    const result = mergeStyleProperties([textProps]);
    expect(result.merged).toMatchObject({
      tag: "style:properties",
      attributes: [{ name: "fo:color", value: "#000000" }],
    });
    expect(result.merged?.children).toEqual([el("style:some-child")]);
  });

  it("concatenates MULTIPLE typed properties elements' own attributes/children together, in encounter order", () => {
    const textProps = el("style:text-properties", { "fo:color": "#000000" });
    const paraProps = el("style:paragraph-properties", {
      "fo:text-align": "center",
    });
    const result = mergeStyleProperties([textProps, paraProps]);
    expect(result.merged?.attributes).toEqual([
      { name: "fo:color", value: "#000000" },
      { name: "fo:text-align", value: "center" },
    ]);
  });

  it("keeps a non-properties child in rest, in its original relative position", () => {
    const textProps = el("style:text-properties", { "fo:color": "#000000" });
    const map = el("style:map");
    const result = mergeStyleProperties([map, textProps]);
    expect(result.rest).toEqual([map]);
  });
});
