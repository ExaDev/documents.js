import { describe, it, expect } from "vitest";
import { parseXml } from "../xml/parse";
import { buildXml } from "../xml/build";
import type { Package, Part } from "../model/package";
import type { XmlElement } from "../model/node";
import { rootElement, attrValue } from "../xml/query";
import { ODF_NAMESPACES } from "../ns";
import { ODF_MEDIA_TYPES } from "../media-type";
import { writeMimetype, readMimetype } from "../mimetype";
import { base64ToBytes } from "../util/base64";
import { transformOoo1Package, transformToOoo1Package } from "./transform";

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

function transformContent(body: string, options?: { class?: string }): string {
  const pkg: Package = {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: parseXml(contentXml(body, options)),
      },
    },
  };
  const part = transformOoo1Package(pkg).parts["content.xml"];
  if (part?.kind !== "xml") {
    throw new Error("content.xml did not survive the transform as an XML part");
  }
  return selfCloseEmpty(buildXml(part.nodes));
}

// The whole content.xml, so a caller can assert on office:automatic-styles as well as the body.
function transformWhole(xml: string, path = "content.xml"): string {
  const pkg: Package = {
    parts: { [path]: { kind: "xml", nodes: parseXml(xml) } },
  };
  const part = transformOoo1Package(pkg).parts[path];
  if (part?.kind !== "xml") {
    throw new Error(`${path} did not survive the transform as an XML part`);
  }
  return selfCloseEmpty(buildXml(part.nodes));
}

function contentRoot(xml: string): XmlElement {
  const root = rootElement(parseXml(xml));
  if (root === undefined) {
    throw new Error("no root element");
  }
  return root;
}

describe("transformOoo1Package: namespaces", () => {
  it("rewrites every declared namespace to its OASIS successor", () => {
    const out = contentRoot(transformContent(`<text:p>hi</text:p>`));
    expect(attrValue(out, "xmlns:office")).toBe(ODF_NAMESPACES.office);
    expect(attrValue(out, "xmlns:text")).toBe(ODF_NAMESPACES.text);
    expect(attrValue(out, "xmlns:draw")).toBe(ODF_NAMESPACES.draw);
    expect(attrValue(out, "xmlns:number")).toBe(ODF_NAMESPACES.number);
    expect(attrValue(out, "xmlns:presentation")).toBe(
      ODF_NAMESPACES.presentation,
    );
    // The two that flip from a real W3C namespace to an OASIS "-compatible" minting.
    expect(attrValue(out, "xmlns:fo")).toBe(ODF_NAMESPACES.fo);
    expect(attrValue(out, "xmlns:svg")).toBe(ODF_NAMESPACES.svg);
    // Untouched in both formats.
    expect(attrValue(out, "xmlns:xlink")).toBe(ODF_NAMESPACES.xlink);
    expect(attrValue(out, "xmlns:dc")).toBe(ODF_NAMESPACES.dc);
  });

  it("normalises a non-conventional prefix binding onto the canonical prefix", () => {
    // Nothing forces a producer to use the conventional prefixes; the URI is what binds. A document binding the text vocabulary to "t:" must still read, because every reader in this package matches on the canonical prefix.
    const out = transformWhole(
      `<o:document-content xmlns:o="http://openoffice.org/2000/office" xmlns:t="http://openoffice.org/2000/text" office:version="1.0" o:class="text"><o:body><t:p t:style-name="P1">hi</t:p></o:body></o:document-content>`,
    );
    expect(out).toContain("<office:document-content");
    expect(out).toContain(`<text:p text:style-name="P1">`);
    expect(out).not.toContain("<t:p");
  });

  it("leaves a package that is not OpenOffice.org 1.x completely alone", () => {
    const odf = `<office:document-content xmlns:office="${ODF_NAMESPACES.office}" xmlns:text="${ODF_NAMESPACES.text}"><office:body><office:text><text:p>hi</text:p></office:text></office:body></office:document-content>`;
    expect(transformWhole(odf)).toBe(buildXml(parseXml(odf)));
  });
});

describe("transformOoo1Package: document structure", () => {
  it("wraps office:body's children in the genre element office:class names, and drops the class", () => {
    const out = transformContent(`<text:p>hi</text:p>`);
    expect(out).toContain(
      `<office:body><office:text><text:p>hi</text:p></office:text></office:body>`,
    );
    expect(out).not.toContain("office:class");
  });

  it.each([
    ["spreadsheet", "office:spreadsheet"],
    ["presentation", "office:presentation"],
    ["drawing", "office:drawing"],
    ["chart", "office:chart"],
    // A master document's body is still office:text in ODF -- the master-ness lives in the media type, not the genre element.
    ["text-global", "office:text"],
  ])("maps office:class=%s onto <%s>", (documentClass, genre) => {
    const out = transformContent(`<text:p>hi</text:p>`, {
      class: documentClass,
    });
    expect(out).toContain(`<office:body><${genre}>`);
  });

  it("renames the font declaration container and its entries", () => {
    const out = transformWhole(
      `<office:document-content ${OOO_XMLNS} office:class="text"><office:font-decls><style:font-decl style:name="Arial" fo:font-family="Arial" style:font-style-name="Bold" style:font-pitch="variable"/></office:font-decls><office:body><text:p/></office:body></office:document-content>`,
    );
    expect(out).toContain("<office:font-face-decls>");
    expect(out).toContain(
      `<style:font-face style:name="Arial" svg:font-family="Arial" style:font-adornments="Bold" style:font-pitch="variable"/>`,
    );
  });

  it("renames the script and event containers", () => {
    const out = transformWhole(
      `<office:document-content ${OOO_XMLNS} office:class="text"><office:script/><office:body><text:p/></office:body></office:document-content>`,
    );
    expect(out).toContain("<office:scripts");
  });
});

describe("transformOoo1Package: style:properties splitting", () => {
  function automaticStyles(styles: string): string {
    return transformWhole(
      `<office:document-content ${OOO_XMLNS} office:class="text"><office:automatic-styles>${styles}</office:automatic-styles><office:body><text:p/></office:body></office:document-content>`,
    );
  }

  it("splits a paragraph style's single style:properties into paragraph and text properties", () => {
    const out = automaticStyles(
      `<style:style style:name="P1" style:family="paragraph"><style:properties fo:text-align="end" fo:margin-left="1inch" style:font-name="Arial" fo:font-size="10pt" fo:color="#000080"/></style:style>`,
    );
    expect(out).toContain(
      `<style:paragraph-properties fo:text-align="end" fo:margin-left="1in"/>`,
    );
    expect(out).toContain(
      `<style:text-properties style:font-name="Arial" fo:font-size="10pt" fo:color="#000080"/>`,
    );
    expect(out).not.toContain("<style:properties");
  });

  it("sends a table-cell style's fill and borders to table-cell properties, not paragraph ones", () => {
    // fo:background-color and fo:border are valid in more than one properties element, so which one they land in is decided by the style's family, exactly as LibreOffice's own OOo-to-OASIS splitter decides it.
    const out = automaticStyles(
      `<style:style style:name="C1" style:family="table-cell"><style:properties fo:background-color="#000080" fo:padding="0.0382inch" fo:border-left="0.0139inch solid #000080"/></style:style>`,
    );
    expect(out).toContain(
      `<style:table-cell-properties fo:background-color="#000080" fo:padding="0.0382in" fo:border-left="0.0139in solid #000080"/>`,
    );
  });

  it("uses the single properties element every one-family style has", () => {
    const out = automaticStyles(
      `<style:style style:name="co1" style:family="table-column"><style:properties style:column-width="2inch"/></style:style><style:style style:name="T1" style:family="text"><style:properties fo:font-weight="bold"/></style:style>`,
    );
    expect(out).toContain(
      `<style:table-column-properties style:column-width="2in"/>`,
    );
    expect(out).toContain(`<style:text-properties fo:font-weight="bold"/>`);
  });

  it("renames style:page-master and its properties", () => {
    const out = automaticStyles(
      `<style:page-master style:name="pm1"><style:properties fo:page-width="8.5inch" fo:page-height="11inch" fo:margin-left="1inch"/></style:page-master>`,
    );
    expect(out).toContain(`<style:page-layout style:name="pm1">`);
    expect(out).toContain(
      `<style:page-layout-properties fo:page-width="8.5in" fo:page-height="11in" fo:margin-left="1in"/>`,
    );
  });

  it("keeps a properties element's own child elements with the properties they belong to", () => {
    const out = automaticStyles(
      `<style:style style:name="P1" style:family="paragraph"><style:properties fo:text-align="start"><style:tab-stops><style:tab-stop style:position="1inch" style:leader-char="."/></style:tab-stops></style:properties></style:style>`,
    );
    expect(out).toContain(
      `<style:paragraph-properties fo:text-align="start"><style:tab-stops><style:tab-stop style:position="1in" style:leader-text="."/></style:tab-stops></style:paragraph-properties>`,
    );
  });

  it("expands the compound underline and strike attributes into their ODF triples", () => {
    const out = automaticStyles(
      `<style:style style:name="T1" style:family="text"><style:properties style:text-underline="single" style:text-crossing-out="single-line"/></style:style><style:style style:name="T2" style:family="text"><style:properties style:text-underline="bold-dotted" style:text-crossing-out="double-line"/></style:style>`,
    );
    expect(out).toContain(
      `<style:text-properties style:text-underline-style="solid" style:text-line-through-style="solid"/>`,
    );
    expect(out).toContain(
      `<style:text-properties style:text-underline-style="dotted" style:text-underline-width="bold" style:text-line-through-style="solid" style:text-line-through-type="double"/>`,
    );
  });

  it("maps the boolean fo:keep-with-next onto ODF's always/auto keyword", () => {
    const out = automaticStyles(
      `<style:style style:name="P1" style:family="paragraph"><style:properties fo:keep-with-next="true"/></style:style><style:style style:name="P2" style:family="paragraph"><style:properties fo:keep-with-next="false"/></style:style>`,
    );
    expect(out).toContain(`fo:keep-with-next="always"`);
    expect(out).toContain(`fo:keep-with-next="auto"`);
  });

  // The drawing family is the one style:family value the two vocabularies spell differently, and it has to be renamed before the split runs: PROPERTY_TYPES_BY_FAMILY is keyed on ODF's own spelling, so a family left as "graphics" would fall through the classification entirely and leave the style's fill and stroke in an unsplit style:properties no reader looks at.
  it("renames a drawing style's style:family from graphics to graphic, and splits it as a graphic style", () => {
    const out = automaticStyles(
      `<style:style style:name="gr1" style:family="graphics"><style:properties draw:fill="solid" draw:fill-color="#ffcc00" draw:stroke="solid" svg:stroke-color="#000000"/></style:style>`,
    );
    expect(out).toContain(`style:family="graphic"`);
    expect(out).not.toContain(`style:family="graphics"`);
    expect(out).toContain(
      `<style:graphic-properties draw:fill="solid" draw:fill-color="#ffcc00" draw:stroke="solid" svg:stroke-color="#000000"/>`,
    );
  });

  it("leaves every other style:family value alone, including the drawing family's presentation sibling", () => {
    const out = automaticStyles(
      `<style:style style:name="pr1" style:family="presentation"><style:properties draw:fill="none"/></style:style><style:style style:name="dp1" style:family="drawing-page"><style:properties draw:background-size="border"/></style:style>`,
    );
    expect(out).toContain(`style:family="presentation"`);
    expect(out).toContain(`style:family="drawing-page"`);
  });
});

describe("transformOoo1Package: text vocabulary", () => {
  it("renames a heading's text:level to text:outline-level", () => {
    const out = transformContent(
      `<text:h text:style-name="H1" text:level="2">Title</text:h>`,
    );
    expect(out).toContain(
      `<text:h text:style-name="H1" text:outline-level="2">Title</text:h>`,
    );
  });

  it("leaves text:level alone on a list level style, where ODF kept the name", () => {
    const out = transformWhole(
      `<office:document-styles ${OOO_XMLNS}><office:styles><text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/></text:list-style></office:styles></office:document-styles>`,
      "styles.xml",
    );
    expect(out).toContain(`<text:list-level-style-bullet text:level="1"`);
  });

  it("collapses both OpenOffice.org list elements onto text:list", () => {
    const out = transformContent(
      `<text:ordered-list text:style-name="L1"><text:list-item><text:p>one</text:p></text:list-item></text:ordered-list><text:unordered-list text:style-name="L2"><text:list-item><text:p>two</text:p></text:list-item></text:unordered-list>`,
    );
    expect(out).toContain(`<text:list text:style-name="L1">`);
    expect(out).toContain(`<text:list text:style-name="L2">`);
    expect(out).not.toContain("ordered-list");
  });

  it("renames the inline text:tab-stop to text:tab", () => {
    const out = transformContent(`<text:p>a<text:tab-stop/>b</text:p>`);
    expect(out).toContain(`<text:p>a<text:tab/>b</text:p>`);
  });

  it("folds footnotes and endnotes into the text:note family with a note class", () => {
    const out = transformContent(
      `<text:p><text:footnote text:id="ftn1"><text:footnote-citation>1</text:footnote-citation><text:footnote-body><text:p>note</text:p></text:footnote-body></text:footnote><text:endnote text:id="edn1"><text:endnote-citation>i</text:endnote-citation><text:endnote-body><text:p>end</text:p></text:endnote-body></text:endnote></text:p>`,
    );
    expect(out).toContain(
      `<text:note text:id="ftn1" text:note-class="footnote"><text:note-citation>1</text:note-citation><text:note-body><text:p>note</text:p></text:note-body></text:note>`,
    );
    expect(out).toContain(
      `<text:note text:id="edn1" text:note-class="endnote"><text:note-citation>i</text:note-citation><text:note-body><text:p>end</text:p></text:note-body></text:note>`,
    );
  });

  it("moves an annotation's author and date from attributes into child elements", () => {
    const out = transformContent(
      `<text:p><office:annotation office:author="Ada" office:create-date="2003-10-16T09:22:13"><text:p>comment</text:p></office:annotation></text:p>`,
    );
    expect(out).toContain(
      `<office:annotation><dc:creator>Ada</dc:creator><dc:date>2003-10-16T09:22:13</dc:date><text:p>comment</text:p></office:annotation>`,
    );
  });

  it("moves a tracked change's author and timestamp into child elements", () => {
    const out = transformContent(
      `<text:tracked-changes><text:changed-region text:id="c1"><text:insertion><office:change-info office:chg-author="Ada" office:chg-date-time="2003-10-16T09:22:13"/></text:insertion></text:changed-region></text:tracked-changes>`,
    );
    expect(out).toContain(
      `<office:change-info><dc:creator>Ada</dc:creator><dc:date>2003-10-16T09:22:13</dc:date></office:change-info>`,
    );
  });
});

describe("transformOoo1Package: table and drawing vocabulary", () => {
  it("moves a cell's value attributes from the table namespace to the office one", () => {
    const out = transformContent(
      `<table:table table:name="T"><table:table-row><table:table-cell table:value-type="float" table:value="42" table:formula="=SUM(A1:A2)"><text:p>42</text:p></table:table-cell></table:table-row></table:table>`,
    );
    expect(out).toContain(
      `<table:table-cell office:value-type="float" office:value="42" table:formula="=SUM(A1:A2)">`,
    );
  });

  it("wraps a bare drawing shape in the draw:frame ODF introduced, moving the frame-level attributes onto it", () => {
    const out = transformContent(
      `<text:p><draw:image draw:style-name="fr1" draw:name="Graphic1" text:anchor-type="paragraph" svg:width="1.9992inch" svg:height="0.7228inch" draw:z-index="0" xlink:href="#Pictures/a.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></text:p>`,
    );
    expect(out).toContain(
      `<draw:frame draw:style-name="fr1" draw:name="Graphic1" text:anchor-type="paragraph" svg:width="1.9992in" svg:height="0.7228in" draw:z-index="0"><draw:image xlink:href="Pictures/a.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>`,
    );
  });

  it("keeps a hyperlink's own fragment href intact while stripping a package reference's", () => {
    const out = transformContent(
      `<text:p><text:a xlink:href="#anchor">link</text:a></text:p>`,
    );
    expect(out).toContain(`<text:a xlink:href="#anchor">`);
  });

  it("wraps a text box's content, which is what carries a Draw page's text", () => {
    const out = transformContent(
      `<draw:page draw:name="page1"><draw:text-box draw:style-name="gr1" svg:x="1inch" svg:y="2inch" svg:width="3inch" svg:height="1inch"><text:p>caption</text:p></draw:text-box></draw:page>`,
      { class: "drawing" },
    );
    expect(out).toContain(
      `<draw:frame draw:style-name="gr1" svg:x="1in" svg:y="2in" svg:width="3in" svg:height="1in"><draw:text-box><text:p>caption</text:p></draw:text-box></draw:frame>`,
    );
  });
});

describe("transformOoo1Package: metadata and package parts", () => {
  it("unwraps meta:keywords so each meta:keyword sits directly under office:meta", () => {
    const out = transformWhole(
      `<office:document-meta ${OOO_XMLNS} office:version="1.0"><office:meta><dc:title>T</dc:title><meta:keywords><meta:keyword>alpha</meta:keyword><meta:keyword>beta</meta:keyword></meta:keywords></office:meta></office:document-meta>`,
      "meta.xml",
    );
    expect(out).toContain(
      `<office:meta><dc:title>T</dc:title><meta:keyword>alpha</meta:keyword><meta:keyword>beta</meta:keyword></office:meta>`,
    );
  });

  it("rewrites the manifest's namespace and its root entry's media type, and adds the mimetype part OpenOffice.org 1.x never had", () => {
    const pkg: Package = {
      parts: {
        "META-INF/manifest.xml": {
          kind: "xml",
          nodes: parseXml(
            `<manifest:manifest xmlns:manifest="http://openoffice.org/2001/manifest"><manifest:file-entry manifest:media-type="application/vnd.sun.xml.writer" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/></manifest:manifest>`,
          ),
        },
      },
    };
    const out = transformOoo1Package(pkg);
    const manifest = out.parts["META-INF/manifest.xml"];
    if (manifest?.kind !== "xml") {
      throw new Error("manifest did not survive as an XML part");
    }
    const xml = selfCloseEmpty(buildXml(manifest.nodes));
    expect(xml).toContain(`xmlns:manifest="${ODF_NAMESPACES.manifest}"`);
    expect(xml).toContain(
      `manifest:media-type="application/vnd.oasis.opendocument.text" manifest:full-path="/"`,
    );
    const mimetype = out.parts.mimetype;
    if (mimetype?.kind !== "binary") {
      throw new Error("mimetype part was not written as a binary part");
    }
    expect(new TextDecoder().decode(base64ToBytes(mimetype.base64))).toBe(
      "application/vnd.oasis.opendocument.text",
    );
  });

  it("carries binary parts through untouched", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(contentXml("<text:p/>")),
        },
        "Pictures/a.png": { kind: "binary", base64: "AAEC" },
      },
    };
    expect(transformOoo1Package(pkg).parts["Pictures/a.png"]).toEqual({
      kind: "binary",
      base64: "AAEC",
    });
  });
});

// =====================================================================================================================
// transformToOoo1Package: the reverse direction. Each test below pins one rule from transform.ts's own "REVERSE DIRECTION" section as a concrete XML shape, mirroring the forward suite's own convention above -- the write.ts round-trip suite (write.test.ts) is the strongest end-to-end evidence, but pinning each rule's own exact output here is what stops a future change from silently widening or narrowing what this direction actually reverses.
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

// An ODF content.xml, genre-wrapped exactly as writeOdt (and any real ODF producer) writes one, in a whole package carrying the "mimetype" part transformToOoo1Package gates on -- the ODF-side mirror of transformContent's own OOo1x-side helper above.
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
  });

  it("leaves a package with no mimetype part -- already OpenOffice.org 1.x-shaped, or not a document this module can identify -- completely alone", () => {
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

  // The forward rename's own inverse, and the one this direction cannot skip: a real consumer resolves a shape's draw:style-name against the plural spelling alone, so an OpenOffice.org 1.x package whose graphic styles still say "graphic" imports with every fill and stroke silently unbound (confirmed against LibreOffice 26.2 -- see the package README's own .sxd verification section).
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
    // The nested list, carrying no text:style-name of its own, still comes out as text:unordered-list -- inherited from its enclosing list, never left as the bare "text:list" ODF spelling.
    expect(out.match(/<text:unordered-list/g)).toHaveLength(2);
    expect(out).not.toContain("<text:list ");
    expect(out).not.toContain("<text:list>");
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
});
