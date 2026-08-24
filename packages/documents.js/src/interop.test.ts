// A structural-compatibility guard between ooxml.js's and odf.js's raw container types. Both packages independently define an XmlElement/XmlNode/Package model for their own container format (OOXML parts vs. ODF parts), and documents.js depends on both -- if either package's shape ever drifts (a renamed field, an added discriminant, a narrowed type), code that assumes the two are interchangeable would break in a way a runtime test cannot catch, since both sides would still be individually well-typed. This is deliberately a TYPE-LEVEL test: the assertion is that this file compiles under `pnpm typecheck` at all, not anything the test body does at runtime -- if the two packages' shapes genuinely diverge, this file fails to compile, not fails an assertion.
import { describe, expect, it } from "vitest";
import type {
  Attribute as OoxmlAttribute,
  Package as OoxmlPackage,
  XmlElement as OoxmlXmlElement,
  XmlNode as OoxmlXmlNode,
} from "ooxml.js";
import type {
  Attribute as OdfAttribute,
  Package as OdfPackage,
  XmlElement as OdfXmlElement,
  XmlNode as OdfXmlNode,
} from "odf.js";

// Assignability check in both directions: if T and U are not structurally compatible, TypeScript rejects the `value` return as a type error at the `Fn: (value: T) => U` call site, well before any test runner executes it.
function assertAssignable<T, U>(value: T, convert: (value: T) => U): U {
  return convert(value);
}

describe("ooxml.js / odf.js structural compatibility", () => {
  it("XmlElement is mutually assignable between ooxml.js and odf.js", () => {
    const ooxmlToOdf: OdfXmlElement = assertAssignable<
      OoxmlXmlElement,
      OdfXmlElement
    >(
      { type: "element", tag: "a", attributes: [], children: [] },
      (value) => value,
    );
    const odfToOoxml: OoxmlXmlElement = assertAssignable<
      OdfXmlElement,
      OoxmlXmlElement
    >(
      { type: "element", tag: "a", attributes: [], children: [] },
      (value) => value,
    );
    expect(ooxmlToOdf.tag).toBe("a");
    expect(odfToOoxml.tag).toBe("a");
  });

  it("XmlNode is mutually assignable between ooxml.js and odf.js", () => {
    const ooxmlToOdf: OdfXmlNode = assertAssignable<OoxmlXmlNode, OdfXmlNode>(
      { type: "text", value: "x" },
      (value) => value,
    );
    const odfToOoxml: OoxmlXmlNode = assertAssignable<OdfXmlNode, OoxmlXmlNode>(
      { type: "text", value: "x" },
      (value) => value,
    );
    expect(ooxmlToOdf).toEqual({ type: "text", value: "x" });
    expect(odfToOoxml).toEqual({ type: "text", value: "x" });
  });

  it("Attribute is mutually assignable between ooxml.js and odf.js", () => {
    const ooxmlToOdf: OdfAttribute = assertAssignable<
      OoxmlAttribute,
      OdfAttribute
    >({ name: "id", value: "1" }, (value) => value);
    const odfToOoxml: OoxmlAttribute = assertAssignable<
      OdfAttribute,
      OoxmlAttribute
    >({ name: "id", value: "1" }, (value) => value);
    expect(ooxmlToOdf).toEqual({ name: "id", value: "1" });
    expect(odfToOoxml).toEqual({ name: "id", value: "1" });
  });

  it("Package is mutually assignable between ooxml.js and odf.js", () => {
    const ooxmlToOdf: OdfPackage = assertAssignable<OoxmlPackage, OdfPackage>(
      { parts: {} },
      (value) => value,
    );
    const odfToOoxml: OoxmlPackage = assertAssignable<OdfPackage, OoxmlPackage>(
      { parts: {} },
      (value) => value,
    );
    expect(ooxmlToOdf).toEqual({ parts: {} });
    expect(odfToOoxml).toEqual({ parts: {} });
  });
});
