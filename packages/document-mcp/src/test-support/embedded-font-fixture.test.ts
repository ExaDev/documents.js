import type { Package, XmlPart } from "documents.js";
import { decodeDocumentPackage } from "documents.js";
import { describe, expect, it } from "vitest";
import {
  buildFontFaceDeclsElement,
  buildOdtWithEmbeddedFont,
  requireOdtContentRoot,
} from "./embedded-font-fixture";

const FONT_BYTES = new Uint8Array([1, 2, 3, 4]);

describe("buildFontFaceDeclsElement", () => {
  it("declares one style:font-face referencing the embedded font part by href", () => {
    expect(buildFontFaceDeclsElement("Example Sans")).toEqual({
      type: "element",
      tag: "office:font-face-decls",
      attributes: [],
      children: [
        {
          type: "element",
          tag: "style:font-face",
          attributes: [
            { name: "style:name", value: "Example Sans" },
            { name: "svg:font-family", value: "Example Sans" },
          ],
          children: [
            {
              type: "element",
              tag: "svg:font-face-src",
              attributes: [],
              children: [
                {
                  type: "element",
                  tag: "svg:font-face-uri",
                  attributes: [
                    { name: "xlink:href", value: "Fonts/font1.ttf" },
                    { name: "xlink:type", value: "simple" },
                  ],
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    });
  });
});

const XML_PART_WITH_NO_ROOT: XmlPart = { kind: "xml", nodes: [] };

describe("requireOdtContentRoot", () => {
  it("returns content.xml's own root element when the package is well-formed", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: [
            {
              type: "element",
              tag: "office:document-content",
              attributes: [],
              children: [],
            },
          ],
        },
      },
    };

    expect(requireOdtContentRoot(pkg)).toEqual({
      type: "element",
      tag: "office:document-content",
      attributes: [],
      children: [],
    });
  });

  it("throws when the package has no content.xml part at all", () => {
    const pkg: Package = { parts: {} };

    expect(() => requireOdtContentRoot(pkg)).toThrow(
      "embedded-font-fixture: createOdt() produced a package with no 'content.xml' XML part",
    );
  });

  it("throws when content.xml is a binary part rather than xml", () => {
    const pkg: Package = {
      parts: { "content.xml": { kind: "binary", base64: "" } },
    };

    expect(() => requireOdtContentRoot(pkg)).toThrow(
      "embedded-font-fixture: createOdt() produced a package with no 'content.xml' XML part",
    );
  });

  it("throws when content.xml carries no element node at all", () => {
    const pkg: Package = { parts: { "content.xml": XML_PART_WITH_NO_ROOT } };

    expect(() => requireOdtContentRoot(pkg)).toThrow(
      "embedded-font-fixture: 'content.xml' has no root element",
    );
  });
});

describe("buildOdtWithEmbeddedFont", () => {
  it("writes the ordinary body paragraph alongside the font declaration and the font part itself", () => {
    const pkg = decodeDocumentPackage(
      "odt",
      buildOdtWithEmbeddedFont({
        family: "Example Sans",
        fontBytes: FONT_BYTES,
      }),
    );

    const content = pkg.parts["content.xml"];
    if (content?.kind !== "xml") {
      throw new Error("expected content.xml to be an xml part");
    }
    expect(JSON.stringify(content.nodes)).toContain(
      "A paragraph of ordinary body text.",
    );

    const fontPart = pkg.parts["Fonts/font1.ttf"];
    if (fontPart?.kind !== "binary") {
      throw new Error("expected Fonts/font1.ttf to be a binary part");
    }
    expect(Buffer.from(fontPart.base64, "base64")).toEqual(
      Buffer.from(FONT_BYTES),
    );
  });
});
