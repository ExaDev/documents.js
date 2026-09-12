import { describe, expect, it } from "vitest";
import {
  asString,
  isRecord,
  isUnknownArray,
  parseAttributes,
  parseNode,
  parseNodes,
  parseXml,
  scalarText,
} from "./parse";

describe("isRecord", () => {
  it("is true for a plain object", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("is false for null, even though typeof null === 'object'", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("is false for an array, even though arrays are typeof 'object'", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });

  it("is false for a primitive", () => {
    expect(isRecord("x")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe("isUnknownArray", () => {
  it("is true for an array, empty or not", () => {
    expect(isUnknownArray([])).toBe(true);
    expect(isUnknownArray([1])).toBe(true);
  });

  it("is false for a non-array", () => {
    expect(isUnknownArray({})).toBe(false);
    expect(isUnknownArray("x")).toBe(false);
    expect(isUnknownArray(undefined)).toBe(false);
  });
});

describe("asString", () => {
  it("passes a string straight through", () => {
    expect(asString("value")).toBe("value");
  });

  it("throws naming the actual runtime type it received", () => {
    expect(() => asString(42)).toThrow(
      "expected string while parsing XML, got number",
    );
    expect(() => asString(undefined)).toThrow(
      "expected string while parsing XML, got undefined",
    );
  });
});

describe("parseNodes", () => {
  it("throws when the top-level value is not an array at all", () => {
    expect(() => parseNodes({})).toThrow(
      "fast-xml-parser output was not an ordered array",
    );
  });

  it("maps every element of a real array through parseNode, in order", () => {
    const result = parseNodes([{ "#text": "a" }, { "#text": "b" }]);
    expect(result).toEqual([
      { type: "text", value: "a" },
      { type: "text", value: "b" },
    ]);
  });
});

describe("parseNode", () => {
  it("throws when the node itself is not an object", () => {
    expect(() => parseNode("not an object")).toThrow(
      "fast-xml-parser node was not an object",
    );
    expect(() => parseNode(null)).toThrow(
      "fast-xml-parser node was not an object",
    );
    expect(() => parseNode([])).toThrow(
      "fast-xml-parser node was not an object",
    );
  });

  it("throws when the node carries no tag key at all beyond ':@'", () => {
    expect(() => parseNode({ ":@": {} })).toThrow("XML node had no tag key");
    expect(() => parseNode({})).toThrow("XML node had no tag key");
  });

  it("throws when the node carries more than one tag key", () => {
    expect(() => parseNode({ a: [], b: [] })).toThrow(
      "XML node had multiple tag keys",
    );
  });

  it("parses a text node from its own #text key", () => {
    expect(parseNode({ "#text": "hello" })).toEqual({
      type: "text",
      value: "hello",
    });
  });

  it("parses a comment node from its own __comment key", () => {
    expect(parseNode({ __comment: [{ "#text": "note" }] })).toEqual({
      type: "comment",
      value: "note",
    });
  });

  it("parses a cdata node from its own __cdata key", () => {
    expect(parseNode({ __cdata: [{ "#text": "raw" }] })).toEqual({
      type: "cdata",
      value: "raw",
    });
  });

  it("parses a declaration node from the exact '?xml' tag key, carrying its attributes", () => {
    expect(parseNode({ "?xml": [], ":@": { "@_version": "1.0" } })).toEqual({
      type: "declaration",
      attributes: [{ name: "version", value: "1.0" }],
    });
  });

  it("parses any other '?'-prefixed key as a processing instruction, named by the tag with the '?' stripped", () => {
    expect(parseNode({ "?custom": [{ "#text": "payload" }] })).toEqual({
      type: "pi",
      target: "custom",
      content: "payload",
    });
  });

  it("parses an ordinary tag as an element, recursing into its own children array", () => {
    expect(
      parseNode({
        a: [{ "#text": "inner" }],
        ":@": { "@_id": "1" },
      }),
    ).toEqual({
      type: "element",
      tag: "a",
      attributes: [{ name: "id", value: "1" }],
      children: [{ type: "text", value: "inner" }],
    });
  });

  it("defaults an element's attributes to an empty array when ':@' is absent", () => {
    const result = parseNode({ a: [] });
    expect(result).toEqual({
      type: "element",
      tag: "a",
      attributes: [],
      children: [],
    });
  });
});

describe("parseAttributes", () => {
  it("returns an empty array when the raw value is absent (undefined)", () => {
    expect(parseAttributes(undefined)).toEqual([]);
  });

  it("throws when the raw value is present but not an object", () => {
    expect(() => parseAttributes([])).toThrow(
      "XML attributes were not an object",
    );
    expect(() => parseAttributes("x")).toThrow(
      "XML attributes were not an object",
    );
  });

  it("throws, naming the offending key, when a key lacks the '@_' prefix", () => {
    expect(() => parseAttributes({ id: "1" })).toThrow(
      "unexpected attribute key without @_ prefix: id",
    );
  });

  it("strips the '@_' prefix off every real attribute key", () => {
    expect(parseAttributes({ "@_id": "1", "@_name": "x" })).toEqual([
      { name: "id", value: "1" },
      { name: "name", value: "x" },
    ]);
  });
});

describe("scalarText", () => {
  it("throws when the raw value is not an array", () => {
    expect(() => scalarText(undefined)).toThrow(
      "expected a scalar-text wrapper array",
    );
    expect(() => scalarText({})).toThrow(
      "expected a scalar-text wrapper array",
    );
  });

  it("throws when the raw value is an empty array", () => {
    expect(() => scalarText([])).toThrow(
      "expected a scalar-text wrapper array",
    );
  });

  it("throws when the wrapper array's first element is not an object", () => {
    expect(() => scalarText(["not an object"])).toThrow(
      "scalar-text wrapper was not an object",
    );
  });

  it("returns the '#text' value of the wrapper array's first element", () => {
    expect(scalarText([{ "#text": "value" }])).toBe("value");
  });
});

describe("parseXml (end-to-end through the real fast-xml-parser)", () => {
  it("parses a self-closing element with an attribute and no children", () => {
    expect(parseXml('<a id="1"/>')).toEqual([
      {
        type: "element",
        tag: "a",
        attributes: [{ name: "id", value: "1" }],
        children: [],
      },
    ]);
  });
});
