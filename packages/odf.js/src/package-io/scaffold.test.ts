import { describe, expect, it } from "vitest";
import { buildXml } from "../xml/build";
import { base64ToBytes } from "byte-codec";
import {
  createOdfPackage,
  odfPartContainer,
  DEFAULT_ODF_VERSION,
} from "./scaffold";

describe("createOdfPackage", () => {
  it("writes content.xml and styles.xml, each starting with the exact XML declaration", () => {
    const pkg = createOdfPackage("application/vnd.oasis.opendocument.text", {
      type: "element",
      tag: "office:text",
      attributes: [],
      children: [],
    });
    const contentPart = pkg.parts["content.xml"];
    const stylesPart = pkg.parts["styles.xml"];
    expect(contentPart?.kind).toBe("xml");
    expect(stylesPart?.kind).toBe("xml");
    if (contentPart?.kind !== "xml" || stylesPart?.kind !== "xml") {
      throw new Error("expected xml parts");
    }
    expect(buildXml(contentPart.nodes)).toMatch(
      /^<\?xml version="1\.0" encoding="UTF-8"\?><office:document-content /,
    );
    expect(buildXml(stylesPart.nodes)).toMatch(
      /^<\?xml version="1\.0" encoding="UTF-8"\?><office:document-styles /,
    );
  });

  it("stamps office:version from the given version, defaulting to DEFAULT_ODF_VERSION", () => {
    const bodyElement = {
      type: "element" as const,
      tag: "office:text",
      attributes: [],
      children: [],
    };
    const defaulted = createOdfPackage(
      "application/vnd.oasis.opendocument.text",
      bodyElement,
    );
    const custom = createOdfPackage(
      "application/vnd.oasis.opendocument.text",
      bodyElement,
      "1.2",
    );
    const defaultedContent = defaulted.parts["content.xml"];
    const customContent = custom.parts["content.xml"];
    if (defaultedContent?.kind !== "xml" || customContent?.kind !== "xml") {
      throw new Error("expected xml parts");
    }
    expect(buildXml(defaultedContent.nodes)).toContain(
      `office:version="${DEFAULT_ODF_VERSION}"`,
    );
    expect(buildXml(customContent.nodes)).toContain('office:version="1.2"');
  });

  it("nests the caller's own body element inside office:body in content.xml", () => {
    const pkg = createOdfPackage("application/vnd.oasis.opendocument.text", {
      type: "element",
      tag: "office:spreadsheet",
      attributes: [],
      children: [],
    });
    const contentPart = pkg.parts["content.xml"];
    if (contentPart?.kind !== "xml") {
      throw new Error("expected an xml part");
    }
    expect(buildXml(contentPart.nodes)).toContain(
      "<office:body><office:spreadsheet></office:spreadsheet></office:body>",
    );
  });

  it("writes the mimetype part from the given media type", () => {
    const pkg = createOdfPackage(
      "application/vnd.oasis.opendocument.spreadsheet",
      {
        type: "element",
        tag: "office:spreadsheet",
        attributes: [],
        children: [],
      },
    );
    const mimetypePart = pkg.parts.mimetype;
    expect(mimetypePart?.kind).toBe("binary");
    if (mimetypePart?.kind !== "binary") {
      throw new Error("expected a binary mimetype part");
    }
    expect(new TextDecoder().decode(base64ToBytes(mimetypePart.base64))).toBe(
      "application/vnd.oasis.opendocument.spreadsheet",
    );
  });
});

describe("odfPartContainer", () => {
  function freshPackage() {
    return createOdfPackage("application/vnd.oasis.opendocument.text", {
      type: "element",
      tag: "office:text",
      attributes: [],
      children: [],
    });
  }

  it("returns the named container element from a real part", () => {
    const container = odfPartContainer(
      freshPackage(),
      "content.xml",
      "office:automatic-styles",
    );
    expect(container.tag).toBe("office:automatic-styles");
  });

  it("throws when the part path is not an XML part at all", () => {
    expect(() =>
      odfPartContainer(freshPackage(), "mimetype", "office:styles"),
    ).toThrow('odfPartContainer: "mimetype" is not an XML part');
  });

  it("throws when the XML part has no container with that tag", () => {
    expect(() =>
      odfPartContainer(freshPackage(), "content.xml", "office:styles"),
    ).toThrow('odfPartContainer: "content.xml" has no office:styles container');
  });
});
