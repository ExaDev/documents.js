import { XMLBuilder } from "fast-xml-parser";
import { describe, expect, it, vi } from "vitest";
import type { XmlNode } from "../model/node";
import { buildXml, toOrderedNode } from "./build";

describe("buildXml", () => {
  it("serialises a text node as bare text", () => {
    expect(buildXml([{ type: "text", value: "hello" }])).toBe("hello");
  });

  it("serialises a comment node, preserving its text verbatim", () => {
    expect(buildXml([{ type: "comment", value: "a note" }])).toBe(
      "<!--a note-->",
    );
  });

  it("serialises a cdata node, preserving its text verbatim", () => {
    expect(buildXml([{ type: "cdata", value: "raw & unescaped <text>" }])).toBe(
      "<![CDATA[raw & unescaped <text>]]>",
    );
  });

  it("serialises a processing instruction from its target alone", () => {
    // The underlying builder emits any "?"-prefixed key from the key and its ":@" attributes only, never from the value beside it — see build.ts's own comment on the pi/declaration cases. content is therefore deliberately absent from the output regardless of what it holds.
    const withContent: XmlNode = {
      type: "pi",
      target: "xml-stylesheet",
      content: 'type="text/xsl" href="styles.xsl"',
    };
    expect(buildXml([withContent])).toBe("<?xml-stylesheet?>");
    expect(
      buildXml([{ type: "pi", target: "xml-stylesheet", content: "" }]),
    ).toBe("<?xml-stylesheet?>");
  });

  it("serialises a declaration node from its attributes", () => {
    expect(
      buildXml([
        {
          type: "declaration",
          attributes: [
            { name: "version", value: "1.0" },
            { name: "encoding", value: "UTF-8" },
          ],
        },
      ]),
    ).toBe('<?xml version="1.0" encoding="UTF-8"?>');
  });

  it("serialises a declaration node with no attributes at all", () => {
    expect(buildXml([{ type: "declaration", attributes: [] }])).toBe("<?xml?>");
  });

  it("serialises a childless, attribute-less element as an empty tag pair", () => {
    expect(
      buildXml([{ type: "element", tag: "a", attributes: [], children: [] }]),
    ).toBe("<a></a>");
  });

  it("omits the attribute map entirely when an element carries no attributes", () => {
    // Confirms Object.keys(attrs).length > 0 gates the ":@" key: were it added unconditionally, the builder would still render identical text for a genuinely empty attrs object, so an equality check on the rendered string alone couldn't tell the two apart — what actually distinguishes them is that an element WITH attributes (below) proves the key does get added when there is something to add.
    const withAttrs = buildXml([
      {
        type: "element",
        tag: "a",
        attributes: [{ name: "href", value: "x" }],
        children: [],
      },
    ]);
    expect(withAttrs).toBe('<a href="x"></a>');
  });

  it("serialises an element carrying several attributes, in given order", () => {
    expect(
      buildXml([
        {
          type: "element",
          tag: "a",
          attributes: [
            { name: "x", value: "1" },
            { name: "y", value: "2" },
          ],
          children: [{ type: "text", value: "body" }],
        },
      ]),
    ).toBe('<a x="1" y="2">body</a>');
  });

  it("serialises nested elements in document order", () => {
    expect(
      buildXml([
        {
          type: "element",
          tag: "outer",
          attributes: [],
          children: [
            { type: "element", tag: "inner", attributes: [], children: [] },
          ],
        },
      ]),
    ).toBe("<outer><inner></inner></outer>");
  });

  it("throws when the underlying builder does not return a string", () => {
    // Spies on the shared prototype method rather than re-importing the module under a mock: a fresh import would re-run build.ts's own top-level `new XMLBuilder({...})` call inside this test's coverage window, which would make Stryker attribute (spurious) per-test coverage to that config object literal — exactly the kind of coverage that can never distinguish one config value from another, since the real constructor never runs during a mocked-import test. Spying on the prototype instead leaves BUILDER's own construction untouched and only intercepts the one call this test cares about.
    const spy = vi
      .spyOn(XMLBuilder.prototype, "build")
      .mockReturnValueOnce({ not: "a string" } as unknown as string);
    try {
      expect(() => buildXml([{ type: "text", value: "x" }])).toThrow(
        "XMLBuilder did not return a string",
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("toOrderedNode", () => {
  it("omits the ':@' key entirely for an attribute-less element, rather than carrying an empty attrs object", () => {
    // toEqual checks the object's exact own-property set: were the ":@" key added unconditionally (as an empty object), this would fail even though buildXml's own rendered XML string is identical either way — see build.test.ts's "omits the attribute map" case above, which pins the observable half of this same invariant.
    expect(
      toOrderedNode({
        type: "element",
        tag: "a",
        attributes: [],
        children: [],
      }),
    ).toStrictEqual({ a: [] });
  });

  it("adds the ':@' key once an element carries at least one attribute", () => {
    expect(
      toOrderedNode({
        type: "element",
        tag: "a",
        attributes: [{ name: "href", value: "x" }],
        children: [],
      }),
    ).toStrictEqual({ a: [], ":@": { "@_href": "x" } });
  });

  it("maps a pi node to its '?'-prefixed key holding an empty array, regardless of its own content", () => {
    expect(
      toOrderedNode({
        type: "pi",
        target: "xml-stylesheet",
        content: "ignored",
      }),
    ).toStrictEqual({ "?xml-stylesheet": [] });
  });

  it("maps a declaration node to '?xml' holding an empty array plus its attributes", () => {
    expect(
      toOrderedNode({
        type: "declaration",
        attributes: [{ name: "version", value: "1.0" }],
      }),
    ).toStrictEqual({ "?xml": [], ":@": { "@_version": "1.0" } });
  });
});
