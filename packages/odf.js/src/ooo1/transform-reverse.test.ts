import { describe, it, expect } from "vitest";
import { parseXml } from "../xml/parse";
import { buildXml } from "../xml/build";
import type { Package, Part } from "../model/package";
import { rootElement } from "../xml/query";
import { ODF_NAMESPACES } from "../ns";
import { ODF_MEDIA_TYPES } from "../media-type";
import { writeMimetype, readMimetype } from "../mimetype";
import { transformToOoo1Package } from "./transform-reverse";

const OOO_XMLNS = [
  `xmlns:office="http://openoffice.org/2000/office"`,
  `xmlns:style="http://openoffice.org/2000/style"`,
  `xmlns:text="http://openoffice.org/2000/text"`,
  `xmlns:table="http://openoffice.org/2000/table"`,
  `xmlns:draw="http://openoffice.org/2000/drawing"`,
  `xmlns:fo="http://www.w3.org/1999/XSL/Format"`,
  `xmlns:xlink="http://www.w3.org/1999/xlink"`,
  `xmlns:dc="http://purl.org/dc/elements/1.1/"`,
  `xmlns:meta="http://openoffice.org/2000/meta"`,
  `xmlns:number="http://openoffice.org/2000/datastyle"`,
  `xmlns:svg="http://www.w3.org/2000/svg"`,
  `xmlns:presentation="http://openoffice.org/2000/presentation"`,
].join(" ");

// buildXml never self-closes an empty element (its builder is configured suppressEmptyNode: false, so round-tripping cannot invent a shorter spelling than the source had). These assertions are about which elements and attributes the transform produced, not about that serialisation choice, so the empty-element pairs are collapsed first to keep every expectation readable.
function selfCloseEmpty(xml: string): string {
  return xml.replace(
    /<([A-Za-z0-9:_.-]+)((?:[^<>"]|"[^"]*")*)><\/\1>/g,
    "<$1$2/>",
  );
}

// A whole content.xml for a Writer document, with the caller's own office:body children.
function contentXml(body: string, options?: { class?: string }): string {
  const documentClass = options?.class ?? "text";
  return `<office:document-content ${OOO_XMLNS} office:version="1.0" office:class="${documentClass}"><office:body>${body}</office:body></office:document-content>`;
}

// =====================================================================================================================
// transformToOoo1Package: the reverse direction. Each test below pins one rule from transform.ts's own "REVERSE DIRECTION" section as a concrete XML shape, mirroring the forward suite's own convention above — the write.ts round-trip suite (write.test.ts) is the strongest end-to-end evidence, but pinning each rule's own exact output here is what stops a future change from silently widening or narrowing what this direction actually reverses.
// =====================================================================================================================

const ODF_XMLNS = [
  `xmlns:office="${ODF_NAMESPACES.office}"`,
  `xmlns:style="${ODF_NAMESPACES.style}"`,
  `xmlns:text="${ODF_NAMESPACES.text}"`,
  `xmlns:table="${ODF_NAMESPACES.table}"`,
  `xmlns:draw="${ODF_NAMESPACES.draw}"`,
  `xmlns:fo="${ODF_NAMESPACES.fo}"`,
  `xmlns:xlink="${ODF_NAMESPACES.xlink}"`,
  `xmlns:dc="${ODF_NAMESPACES.dc}"`,
  `xmlns:meta="${ODF_NAMESPACES.meta}"`,
  `xmlns:number="${ODF_NAMESPACES.number}"`,
  `xmlns:svg="${ODF_NAMESPACES.svg}"`,
].join(" ");

// An ODF content.xml, genre-wrapped exactly as writeOdt (and any real ODF producer) writes one, in a whole package carrying the "mimetype" part transformToOoo1Package gates on — the ODF-side mirror of transformContent's own OOo1x-side helper above.
function odfPackage(
  body: string,
  options?: {
    readonly genre?: string;
    readonly extraParts?: Readonly<Record<string, Part>>;
  },
): Package {
  const genre = options?.genre ?? "office:text";
  const pkg: Package = {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: parseXml(
          `<office:document-content ${ODF_XMLNS} office:version="1.3"><office:body><${genre}>${body}</${genre}></office:body></office:document-content>`,
        ),
      },
      ...options?.extraParts,
    },
  };
  writeMimetype(pkg, ODF_MEDIA_TYPES.odt);
  return pkg;
}

function reversePart(pkg: Package, path: string): string {
  const part = transformToOoo1Package(pkg).parts[path];
  if (part?.kind !== "xml") {
    throw new Error(
      `${path} did not survive the reverse transform as an XML part`,
    );
  }
  return selfCloseEmpty(buildXml(part.nodes));
}

function reverseContent(
  body: string,
  options?: { readonly genre?: string },
): string {
  return reversePart(odfPackage(body, options), "content.xml");
}

describe("transformToOoo1Package: namespaces and package identity", () => {
  it("rewrites every declared namespace to its OpenOffice.org 1.x predecessor", () => {
    const out = reverseContent(`<text:p>hi</text:p>`);
    expect(out).toContain(`xmlns:office="http://openoffice.org/2000/office"`);
    expect(out).toContain(`xmlns:text="http://openoffice.org/2000/text"`);
    expect(out).toContain(`xmlns:draw="http://openoffice.org/2000/drawing"`);
    expect(out).toContain(
      `xmlns:number="http://openoffice.org/2000/datastyle"`,
    );
    // The two that flip from OASIS's own "-compatible" mintings back to the real W3C namespaces.
    expect(out).toContain(`xmlns:fo="http://www.w3.org/1999/XSL/Format"`);
    expect(out).toContain(`xmlns:svg="http://www.w3.org/2000/svg"`);
    // Untouched in both formats.
    expect(out).toContain(`xmlns:xlink="http://www.w3.org/1999/xlink"`);
    expect(out).toContain(`xmlns:dc="http://purl.org/dc/elements/1.1/"`);
  });

  it("carries no mimetype part, and rewrites the manifest's namespace and root media type", () => {
    const pkg = odfPackage(`<text:p/>`, {
      extraParts: {
        "META-INF/manifest.xml": {
          kind: "xml",
          nodes: parseXml(
            `<manifest:manifest xmlns:manifest="${ODF_NAMESPACES.manifest}" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
          ),
        },
      },
    });
    const out = transformToOoo1Package(pkg);
    expect(out.parts.mimetype).toBeUndefined();
    const manifestXml = reversePart(pkg, "META-INF/manifest.xml");
    expect(manifestXml).toContain(
      `xmlns:manifest="http://openoffice.org/2001/manifest"`,
    );
    expect(manifestXml).toContain(
      `manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.sun.xml.writer"`,
    );
    // The second, non-root entry's own media type is not this rewrite's concern — it must survive untouched.
    expect(manifestXml).toContain(
      `manifest:full-path="content.xml" manifest:media-type="text/xml"`,
    );
  });

  it("only rewrites the manifest's own root entry, skipping a same-shaped decoy tag and a decoy attribute placed before the real full-path", () => {
    const pkg = odfPackage(`<text:p/>`, {
      extraParts: {
        "META-INF/manifest.xml": {
          kind: "xml",
          nodes: parseXml(
            `<manifest:manifest xmlns:manifest="${ODF_NAMESPACES.manifest}"><manifest:not-a-file-entry manifest:full-path="/" manifest:media-type="text/plain"/><manifest:file-entry manifest:decoy="nope" manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/></manifest:manifest>`,
          ),
        },
      },
    });
    const manifestXml = reversePart(pkg, "META-INF/manifest.xml");
    expect(manifestXml).toContain(
      `<manifest:not-a-file-entry manifest:full-path="/" manifest:media-type="text/plain"/>`,
    );
    expect(manifestXml).toContain(
      `manifest:decoy="nope" manifest:full-path="/" manifest:media-type="application/vnd.sun.xml.writer"`,
    );
  });

  it("reverses a default (unprefixed) xmlns declaration back to its OpenOffice.org 1.x predecessor, keeping it unprefixed", () => {
    const pkg = odfPackage(`<text:p>hi</text:p>`);
    const contentPart = pkg.parts["content.xml"];
    if (contentPart?.kind !== "xml") {
      throw new Error("content.xml is not an xml part");
    }
    const root = rootElement(contentPart.nodes);
    if (root === undefined) {
      throw new Error("no root");
    }
    root.attributes.push({ name: "xmlns", value: ODF_NAMESPACES.office });
    const out = reversePart(pkg, "content.xml");
    expect(out).toContain(`xmlns="http://openoffice.org/2000/office"`);
  });

  it("never treats a same-shaped element elsewhere in the package as a manifest entry when reversing either", () => {
    const pkg = odfPackage(`<text:p/>`, {
      extraParts: {
        "other.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-content ${ODF_XMLNS} office:version="1.3"><manifest:file-entry xmlns:manifest="${ODF_NAMESPACES.manifest}" manifest:full-path="/" manifest:media-type="text/plain"/><office:body><office:text/></office:body></office:document-content>`,
          ),
        },
      },
    });
    const out = reversePart(pkg, "other.xml");
    expect(out).toContain(`manifest:media-type="text/plain"`);
  });

  it("leaves an XML part with no root element completely alone in reverse too", () => {
    const pkg = odfPackage(`<text:p/>`, {
      extraParts: {
        "stray.xml": { kind: "xml", nodes: [{ type: "text", value: "stray" }] },
      },
    });
    const out = transformToOoo1Package(pkg);
    expect(out.parts["stray.xml"]).toEqual({
      kind: "xml",
      nodes: [{ type: "text", value: "stray" }],
    });
  });

  it("leaves a package with no mimetype part — already OpenOffice.org 1.x-shaped, or not a document this module can identify — completely alone", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(contentXml("<text:p>hi</text:p>")),
        },
      },
    };
    expect(readMimetype(pkg)).toBeUndefined();
    expect(transformToOoo1Package(pkg)).toBe(pkg);
  });
});

describe("transformToOoo1Package: document structure", () => {
  it("unwraps the genre element into office:body directly, and stamps office:class from it", () => {
    const out = reverseContent(`<text:p>hi</text:p>`);
    expect(out).toContain(`<office:body><text:p>hi</text:p></office:body>`);
    expect(out).toContain(`office:class="text"`);
  });

  it.each([
    ["office:spreadsheet", "spreadsheet"],
    ["office:presentation", "presentation"],
    ["office:drawing", "drawing"],
    ["office:chart", "chart"],
  ])("maps <%s> onto office:class=%s", (genre, documentClass) => {
    const out = reverseContent(`<text:p/>`, { genre });
    expect(out).toContain(`office:class="${documentClass}"`);
  });

  it("recurses into office:body's own children directly when they are not wrapped in a recognised genre element", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-content ${ODF_XMLNS} office:version="1.3"><office:body><text:p>hi</text:p></office:body></office:document-content>`,
          ),
        },
      },
    };
    writeMimetype(pkg, ODF_MEDIA_TYPES.odt);
    const out = reversePart(pkg, "content.xml");
    expect(out).toContain(`<office:body><text:p>hi</text:p></office:body>`);
  });

  it("only unwraps a genre child for office:body itself, never for another element whose own first child happens to share a genre tag", () => {
    const out = reverseContent(
      `<text:p><office:text>trap</office:text></text:p>`,
    );
    expect(out).toContain(`<text:p><office:text>trap</office:text></text:p>`);
  });

  it("renames the font declaration container and its entries", () => {
    const pkg = odfPackage(`<text:p/>`);
    const contentPart = pkg.parts["content.xml"];
    if (contentPart?.kind !== "xml") {
      throw new Error("content.xml is not an xml part");
    }
    const root = rootElement(contentPart.nodes);
    if (root === undefined) {
      throw new Error("no root");
    }
    root.children.splice(
      0,
      0,
      rootElement(
        parseXml(
          `<office:font-face-decls><style:font-face style:name="Arial" svg:font-family="Arial" style:font-adornments="Bold" style:font-pitch="variable"/></office:font-face-decls>`,
        ),
      )!,
    );
    const out = reversePart(pkg, "content.xml");
    expect(out).toContain("<office:font-decls>");
    expect(out).toContain(
      `<style:font-decl style:name="Arial" fo:font-family="Arial" style:font-style-name="Bold" style:font-pitch="variable"/>`,
    );
  });
});

describe("transformToOoo1Package: style:*-properties merging", () => {
  function automaticStylesReverse(styles: string): string {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-content ${ODF_XMLNS} office:version="1.3"><office:automatic-styles>${styles}</office:automatic-styles><office:body><office:text><text:p/></office:text></office:body></office:document-content>`,
          ),
        },
      },
    };
    writeMimetype(pkg, ODF_MEDIA_TYPES.odt);
    return reversePart(pkg, "content.xml");
  }

  it("merges a paragraph style's separate paragraph and text properties into one style:properties", () => {
    const out = automaticStylesReverse(
      `<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="end" fo:margin-left="1in"/><style:text-properties fo:font-size="10pt" fo:color="#000080"/></style:style>`,
    );
    expect(out).toContain(
      `<style:properties fo:text-align="end" fo:margin-left="1inch" fo:font-size="10pt" fo:color="#000080"/>`,
    );
    expect(out).not.toContain("style:paragraph-properties");
    expect(out).not.toContain("style:text-properties");
  });

  it("merges a table-cell style's single table-cell-properties element into style:properties", () => {
    const out = automaticStylesReverse(
      `<style:style style:name="C1" style:family="table-cell"><style:table-cell-properties fo:background-color="#000080" fo:padding="0.0382in"/></style:style>`,
    );
    expect(out).toContain(
      `<style:properties fo:background-color="#000080" fo:padding="0.0382inch"/>`,
    );
  });

  it("renames style:page-layout back to style:page-master and merges its properties", () => {
    const out = automaticStylesReverse(
      `<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="8.5in" fo:page-height="11in"/></style:page-layout>`,
    );
    expect(out).toContain(`<style:page-master style:name="pm1">`);
    expect(out).toContain(
      `<style:properties fo:page-width="8.5inch" fo:page-height="11inch"/>`,
    );
  });

  it("keeps a properties element's own child elements with the merged properties", () => {
    const out = automaticStylesReverse(
      `<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="start"><style:tab-stops><style:tab-stop style:position="1in"/></style:tab-stops></style:paragraph-properties></style:style>`,
    );
    expect(out).toContain(
      `<style:properties fo:text-align="start"><style:tab-stops><style:tab-stop style:position="1inch"/></style:tab-stops></style:properties>`,
    );
  });

  it("maps ODF's always/auto keyword back onto the boolean fo:keep-with-next", () => {
    const out = automaticStylesReverse(
      `<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:keep-with-next="always"/></style:style><style:style style:name="P2" style:family="paragraph"><style:paragraph-properties fo:keep-with-next="auto"/></style:style>`,
    );
    expect(out).toContain(`fo:keep-with-next="true"`);
    expect(out).toContain(`fo:keep-with-next="false"`);
  });

  it("leaves fo:keep-with-next alone when its value is neither always nor auto", () => {
    const out = automaticStylesReverse(
      `<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:keep-with-next="page"/></style:style>`,
    );
    expect(out).toContain(`fo:keep-with-next="page"`);
  });

  // The forward rename's own inverse, and the one this direction cannot skip: a real consumer resolves a shape's draw:style-name against the plural spelling alone, so an OpenOffice.org 1.x package whose graphic styles still say "graphic" imports with every fill and stroke silently unbound (confirmed against LibreOffice 26.2 — see the package README's own .sxd verification section).
  it("renames a drawing style's style:family back from graphic to graphics", () => {
    const out = automaticStylesReverse(
      `<style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#ffcc00"/></style:style>`,
    );
    expect(out).toContain(`style:family="graphics"`);
    expect(out).toContain(
      `<style:properties draw:fill="solid" draw:fill-color="#ffcc00"/>`,
    );
  });

  it("leaves every other style:family value alone in this direction too", () => {
    const out = automaticStylesReverse(
      `<style:style style:name="pr1" style:family="presentation"><style:graphic-properties draw:fill="none"/></style:style><style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>`,
    );
    expect(out).toContain(`style:family="presentation"`);
    expect(out).toContain(`style:family="text"`);
  });
});

describe("transformToOoo1Package: text vocabulary", () => {
  it("renames a heading's text:outline-level back to text:level", () => {
    const out = reverseContent(
      `<text:h text:style-name="H1" text:outline-level="2">Title</text:h>`,
    );
    expect(out).toContain(
      `<text:h text:style-name="H1" text:level="2">Title</text:h>`,
    );
  });

  it("reverses text:outline-level back to text:level only on text:h, leaving it alone elsewhere", () => {
    const out = reverseContent(`<text:p text:outline-level="1">Body</text:p>`);
    expect(out).toContain(`<text:p text:outline-level="1">Body</text:p>`);
  });

  it("renames the inline text:tab back to text:tab-stop", () => {
    const out = reverseContent(`<text:p>a<text:tab/>b</text:p>`);
    expect(out).toContain(`<text:p>a<text:tab-stop/>b</text:p>`);
  });

  it("splits the unified text:note family back into footnote/endnote by their own text:note-class, including the class-less body and citation children", () => {
    const out = reverseContent(
      `<text:p><text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>note</text:p></text:note-body></text:note><text:note text:id="edn1" text:note-class="endnote"><text:note-citation>i</text:note-citation><text:note-body><text:p>end</text:p></text:note-body></text:note></text:p>`,
    );
    expect(out).toContain(
      `<text:footnote text:id="ftn1"><text:footnote-citation>1</text:footnote-citation><text:footnote-body><text:p>note</text:p></text:footnote-body></text:footnote>`,
    );
    expect(out).toContain(
      `<text:endnote text:id="edn1"><text:endnote-citation>i</text:endnote-citation><text:endnote-body><text:p>end</text:p></text:endnote-body></text:endnote>`,
    );
    expect(out).not.toContain("text:note-class");
  });

  it("splits text:note-ref back into footnote-ref/endnote-ref by its own note-class", () => {
    const out = reverseContent(
      `<text:p><text:note-ref text:id="ftn1" text:note-class="footnote"/><text:note-ref text:id="edn1" text:note-class="endnote"/></text:p>`,
    );
    expect(out).toContain(`<text:footnote-ref text:id="ftn1"`);
    expect(out).toContain(`<text:endnote-ref text:id="edn1"`);
  });

  it("splits text:notes-configuration back into footnotes/endnotes-configuration by its own note-class", () => {
    const out = reverseContent(
      `<text:notes-configuration text:note-class="footnote"/><text:notes-configuration text:note-class="endnote"/>`,
    );
    expect(out).toContain(`<text:footnotes-configuration`);
    expect(out).toContain(`<text:endnotes-configuration`);
  });

  it("defaults a missing note-class to footnote when reversing the note family", () => {
    const out = reverseContent(
      `<text:p><text:note text:id="x"><text:note-citation>1</text:note-citation><text:note-body><text:p>n</text:p></text:note-body></text:note></text:p>`,
    );
    expect(out).toContain(`<text:footnote text:id="x">`);
    expect(out).toContain(`<text:footnote-citation>1</text:footnote-citation>`);
    expect(out).toContain(
      `<text:footnote-body><text:p>n</text:p></text:footnote-body>`,
    );
  });

  it("reverses the plain RENAMED_ATTRIBUTES table by explicit name", () => {
    const out = reverseContent(
      `<text:p style:page-layout-name="pm1" style:leader-text="." text:count-in-text-boxes="true">hi</text:p>`,
    );
    expect(out).toContain(`style:page-master-name="pm1"`);
    expect(out).toContain(`style:leader-char="."`);
    expect(out).toContain(`text:count-in-floating-frames="true"`);
  });

  it("reverses form:control-implementation and form:text-style-name by explicit name", () => {
    const out = reverseContent(
      `<form:property form:control-implementation="com.sun.star.form.control.TextField" form:text-style-name="S1"/>`,
    );
    expect(out).toContain(
      `form:service-name="com.sun.star.form.control.TextField"`,
    );
    expect(out).toContain(`form:column-style-name="S1"`);
  });

  it("reverses office:value-type on a form:property back to form:property-type, but leaves it as office:value-type on an ordinary element", () => {
    const out = reverseContent(
      `<form:property office:value-type="float"/><style:style style:name="X" office:value-type="float"/>`,
    );
    expect(out).toContain(`<form:property form:property-type="float"`);
    expect(out).toContain(
      `<style:style style:name="X" office:value-type="float"`,
    );
  });

  it("pulls an annotation's dc:creator/dc:date children back into attributes", () => {
    const out = reverseContent(
      `<text:p><office:annotation><dc:creator>Ada</dc:creator><dc:date>2003-10-16T09:22:13</dc:date><text:p>comment</text:p></office:annotation></text:p>`,
    );
    expect(out).toContain(
      `<office:annotation office:author="Ada" office:create-date="2003-10-16T09:22:13"><text:p>comment</text:p></office:annotation>`,
    );
  });

  it("pulls a tracked change's dc:creator/dc:date children back into attributes", () => {
    const out = reverseContent(
      `<text:tracked-changes><text:changed-region text:id="c1"><text:insertion><office:change-info><dc:creator>Ada</dc:creator><dc:date>2003-10-16T09:22:13</dc:date></office:change-info></text:insertion></text:changed-region></text:tracked-changes>`,
    );
    expect(out).toContain(
      `<office:change-info office:chg-author="Ada" office:chg-date-time="2003-10-16T09:22:13"/>`,
    );
  });
});

describe("transformToOoo1Package: table and drawing vocabulary", () => {
  it("moves a cell's value attributes from the office namespace back to the table one", () => {
    const out = reverseContent(
      `<table:table table:name="T"><table:table-row><table:table-cell office:value-type="float" office:value="42" table:formula="=SUM(A1:A2)"><text:p>42</text:p></table:table-cell></table:table-row></table:table>`,
    );
    expect(out).toContain(
      `<table:table-cell table:value-type="float" table:value="42" table:formula="=SUM(A1:A2)">`,
    );
  });

  it("renames a real table:table carrying table:is-sub-table back to table:sub-table", () => {
    const out = reverseContent(
      `<table:table table:name="Inner" table:is-sub-table="true"><table:table-row><table:table-cell><text:p/></table:table-cell></table:table-row></table:table>`,
    );
    expect(out).toContain(`<table:sub-table table:name="Inner">`);
    expect(out).not.toContain("table:is-sub-table");
  });

  it("leaves an ordinary top-level table:table exactly as it is", () => {
    const out = reverseContent(
      `<table:table table:name="T"><table:table-row><table:table-cell><text:p/></table:table-cell></table:table-row></table:table>`,
    );
    expect(out).toContain(`<table:table table:name="T">`);
  });

  it("only converts table:is-sub-table on a real table:table, never a same-shaped attribute on another element", () => {
    const out = reverseContent(`<text:p table:is-sub-table="true">hi</text:p>`);
    expect(out).toContain(`<text:p table:is-sub-table="true">hi</text:p>`);
  });

  it("reverses a cell's own content-validation-name back to validation-name", () => {
    const out = reverseContent(
      `<table:table><table:table-row><table:table-cell table:content-validation-name="V1"><text:p/></table:table-cell></table:table-row></table:table>`,
    );
    expect(out).toContain(`table:validation-name="V1"`);
    expect(out).not.toContain("table:content-validation-name");
  });

  it("leaves an office:value-type-shaped attribute alone outside a real cell or text-value element in reverse too", () => {
    const out = reverseContent(
      `<table:table office:value-type="float"><table:table-row><table:table-cell><text:p/></table:table-cell></table:table-row></table:table>`,
    );
    expect(out).toContain(`<table:table office:value-type="float">`);
  });

  it("reverses a text field's value-carrying attributes back to the text namespace", () => {
    const out = reverseContent(
      `<text:variable-set office:value-type="float" office:value="42">42</text:variable-set>`,
    );
    expect(out).toContain(
      `<text:variable-set text:value-type="float" text:value="42">42</text:variable-set>`,
    );
  });

  it("reverses a multi-column layout's own indent attributes back to the margin pair, leaving any other attribute alone", () => {
    const out = reverseContent(
      `<style:column fo:start-indent="1in" fo:end-indent="2in" fo:padding="3in"/>`,
    );
    expect(out).toContain(
      `<style:column fo:margin-left="1inch" fo:margin-right="2inch" fo:padding="3inch"/>`,
    );
  });

  it("leaves the fo:start-indent/fo:end-indent attribute name alone outside a real style:column in reverse too", () => {
    const out = reverseContent(`<text:p fo:start-indent="1in">hi</text:p>`);
    expect(out).toContain(`<text:p fo:start-indent="1inch">hi</text:p>`);
  });

  it("never reverses an in-shaped token inside a name-suffixed or xlink:href attribute", () => {
    const out = reverseContent(
      `<draw:image draw:name="Logo 2in" xlink:href="note 5in"/>`,
    );
    expect(out).toContain(`draw:name="Logo 2in"`);
    expect(out).toContain(`xlink:href="#note 5in"`);
  });

  it("only unwraps the first frame-shaped child when a draw:frame somehow carries more than one, nesting the rest as the chosen shape's own trailing children", () => {
    const out = reverseContent(
      `<draw:frame svg:width="1in"><draw:image xlink:href="a.png"/><draw:text-box><text:p>t</text:p></draw:text-box></draw:frame>`,
    );
    expect(out).toContain(
      `<draw:image xlink:href="#a.png" svg:width="1inch"><draw:text-box><text:p>t</text:p></draw:text-box></draw:image>`,
    );
  });

  it("unwraps a draw:frame back to the bare shape it wraps, moving the frame attributes onto it and reversing the inch unit", () => {
    const out = reverseContent(
      `<text:p><draw:frame draw:style-name="fr1" draw:name="Graphic1" text:anchor-type="paragraph" svg:width="1.9992in" svg:height="0.7228in" draw:z-index="0"><draw:image xlink:href="Pictures/a.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame></text:p>`,
    );
    expect(out).toContain(
      `<draw:image xlink:href="#Pictures/a.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad" draw:style-name="fr1" draw:name="Graphic1" text:anchor-type="paragraph" svg:width="1.9992inch" svg:height="0.7228inch" draw:z-index="0"/>`,
    );
    expect(out).not.toContain("draw:frame");
  });

  it("leaves a draw:frame wrapping a construct OpenOffice.org 1.x never wrapped this way (a custom shape) exactly as it is", () => {
    const out = reverseContent(
      `<draw:frame svg:width="1in" svg:height="1in"><draw:custom-shape draw:style-name="gr1"/></draw:frame>`,
    );
    expect(out).toContain(`<draw:frame svg:width="1inch" svg:height="1inch">`);
    expect(out).toContain(`<draw:custom-shape draw:style-name="gr1"/>`);
  });

  it("prefixes a package-internal href with the # OpenOffice.org 1.x wrote, but leaves an external URL and a genuine fragment untouched", () => {
    const out = reverseContent(
      `<text:p><draw:image xlink:href="Pictures/a.png"/><draw:image xlink:href="http://example.invalid/a.png"/><text:a xlink:href="#bookmark">link</text:a></text:p>`,
    );
    expect(out).toContain(`xlink:href="#Pictures/a.png"`);
    expect(out).toContain(`xlink:href="http://example.invalid/a.png"`);
    expect(out).toContain(`xlink:href="#bookmark"`);
  });

  it("does not double-prefix a package-internal href that already starts with #", () => {
    const out = reverseContent(`<draw:image xlink:href="#Pictures/a.png"/>`);
    expect(out).toContain(`xlink:href="#Pictures/a.png"`);
    expect(out).not.toContain(`xlink:href="##Pictures/a.png"`);
  });
});

describe("transformToOoo1Package: lists", () => {
  function bodyWithListStyle(list: string, levelStyleTag: string): string {
    return `<office:automatic-styles><text:list-style style:name="L1"><${levelStyleTag} text:level="1"/></text:list-style></office:automatic-styles><office:body><office:text>${list}</office:text></office:body>`;
  }

  it("spells a text:list referencing a number-level style as text:ordered-list", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-content ${ODF_XMLNS} office:version="1.3">${bodyWithListStyle(
              `<text:list text:style-name="L1"><text:list-item><text:p>one</text:p></text:list-item></text:list>`,
              "text:list-level-style-number",
            )}</office:document-content>`,
          ),
        },
      },
    };
    writeMimetype(pkg, ODF_MEDIA_TYPES.odt);
    const out = reversePart(pkg, "content.xml");
    expect(out).toContain(`<text:ordered-list text:style-name="L1">`);
  });

  it("spells a text:list referencing a bullet-level style as text:unordered-list, and a nested text:list with no style-name of its own inherits the same kind", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-content ${ODF_XMLNS} office:version="1.3">${bodyWithListStyle(
              `<text:list text:style-name="L1"><text:list-item><text:p>one</text:p><text:list><text:list-item><text:p>nested</text:p></text:list-item></text:list></text:list-item></text:list>`,
              "text:list-level-style-bullet",
            )}</office:document-content>`,
          ),
        },
      },
    };
    writeMimetype(pkg, ODF_MEDIA_TYPES.odt);
    const out = reversePart(pkg, "content.xml");
    expect(out).toContain(`<text:unordered-list text:style-name="L1">`);
    // The nested list, carrying no text:style-name of its own, still comes out as text:unordered-list — inherited from its enclosing list, never left as the bare "text:list" ODF spelling.
    expect(out.match(/<text:unordered-list/g)).toHaveLength(2);
    expect(out).not.toContain("<text:list ");
    expect(out).not.toContain("<text:list>");
  });

  it("leaves a text:list unrenamed when its referenced list-style can't be resolved to ordered or bullet", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-content ${ODF_XMLNS} office:version="1.3"><office:body><office:text><text:list text:style-name="Unknown"><text:list-item><text:p>one</text:p></text:list-item></text:list></office:text></office:body></office:document-content>`,
          ),
        },
      },
    };
    writeMimetype(pkg, ODF_MEDIA_TYPES.odt);
    const out = reversePart(pkg, "content.xml");
    expect(out).toContain(`<text:list text:style-name="Unknown">`);
  });

  it("only threads listKind down from a genuine enclosing text:list, never from another element that merely resolves a list style", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-content ${ODF_XMLNS} office:version="1.3"><office:automatic-styles><text:list-style style:name="L1"><text:list-level-style-number text:level="1"/></text:list-style></office:automatic-styles><office:body><office:text><text:p text:style-name="L1"><text:list><text:list-item><text:p>one</text:p></text:list-item></text:list></text:p></office:text></office:body></office:document-content>`,
          ),
        },
      },
    };
    writeMimetype(pkg, ODF_MEDIA_TYPES.odt);
    const out = reversePart(pkg, "content.xml");
    expect(out).toContain(`<text:list>`);
    expect(out).not.toContain("text:ordered-list");
    expect(out).not.toContain("text:unordered-list");
  });
});

describe("transformToOoo1Package: metadata", () => {
  it("re-wraps every meta:keyword under one meta:keywords element", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(contentXml("<text:p/>")),
        },
        "meta.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-meta ${ODF_XMLNS} office:version="1.3"><office:meta><dc:title>T</dc:title><meta:keyword>alpha</meta:keyword><meta:keyword>beta</meta:keyword></office:meta></office:document-meta>`,
          ),
        },
      },
    };
    writeMimetype(pkg, ODF_MEDIA_TYPES.odt);
    const out = reversePart(pkg, "meta.xml");
    expect(out).toContain(
      `<office:meta><dc:title>T</dc:title><meta:keywords><meta:keyword>alpha</meta:keyword><meta:keyword>beta</meta:keyword></meta:keywords></office:meta>`,
    );
  });

  it("leaves office:meta's children alone when there are no meta:keyword siblings to rewrap", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(contentXml("<text:p/>")),
        },
        "meta.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-meta ${ODF_XMLNS} office:version="1.3"><office:meta><dc:title>T</dc:title></office:meta></office:document-meta>`,
          ),
        },
      },
    };
    writeMimetype(pkg, ODF_MEDIA_TYPES.odt);
    const out = reversePart(pkg, "meta.xml");
    expect(out).toContain(`<office:meta><dc:title>T</dc:title></office:meta>`);
  });
});
