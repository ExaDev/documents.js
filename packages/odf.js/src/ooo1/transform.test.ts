import { describe, it, expect } from "vitest";
import { parseXml } from "../xml/parse";
import { buildXml } from "../xml/build";
import type { Package } from "../model/package";
import type { XmlElement } from "../model/node";
import { rootElement, attrValue } from "../xml/query";
import { ODF_NAMESPACES } from "../ns";
import { base64ToBytes } from "byte-codec";
import { transformOoo1Package } from "./transform";

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
      `<o:document-content xmlns:o="http://openoffice.org/2000/office" xmlns:t="http://openoffice.org/2000/text" office:version="1.0" o:class="text"><o:body><t:p t:style-name="P1" tz="unchanged">hi</t:p></o:body></o:document-content>`,
    );
    expect(out).toContain("<office:document-content");
    expect(out).toContain(`<text:p text:style-name="P1" tz="unchanged">`);
    expect(out).not.toContain("<t:p");
    // office:class was resolved through the "o:" alias, not just the conventional literal — proven by the genre wrapper it drives, not merely by the attribute renames above.
    expect(out).toContain(`<office:body><office:text>`);
    // "tz" carries no colon for renameQName to act on and must survive untouched — chosen so that a broken "no colon" early-return would slice it down to "t" (a real prefix bound above to "text") and wrongly rewrite it to "text:tz".
    expect(out).toContain(`tz="unchanged"`);
  });

  it("never resolves office:class through a decoy prefix bound to something other than the office namespace", () => {
    // "t" is bound to the text namespace, never office — classAttributeName must stay undefined, so a decoy "t:class" attribute placed before the real office:class is never mistaken for it.
    const out = transformWhole(
      `<office:document-content xmlns:t="http://openoffice.org/2000/text" office:version="1.0" t:class="spreadsheet" office:class="text"><office:body><t:p>hi</t:p></office:body></office:document-content>`,
    );
    expect(out).toContain(`<office:body><office:text>`);
  });

  it("resolves office:class from its own literal attribute name when no prefix is aliased to the office namespace at all", () => {
    const out = transformWhole(
      `<office:document-content xmlns:text="http://openoffice.org/2000/text" office:version="1.0" office:class="text"><office:body><text:p>hi</text:p></office:body></office:document-content>`,
    );
    expect(out).toContain(`<office:body><office:text>`);
  });

  it("never treats a coincidentally 'undefined:class'-named attribute as office:class when no alias prefix is bound", () => {
    const out = transformWhole(
      `<office:document-content xmlns:text="http://openoffice.org/2000/text" office:version="1.0" undefined:class="spreadsheet"><office:body><text:p>hi</text:p></office:body></office:document-content>`,
    );
    expect(out).not.toContain("office:spreadsheet");
    expect(out).toContain(`<office:body><text:p>hi</text:p></office:body>`);
  });

  it("rewrites a default (unprefixed) xmlns declaration to its OASIS successor, keeping it unprefixed", () => {
    const out = transformWhole(
      `<office:document-content xmlns="http://openoffice.org/2000/office" ${OOO_XMLNS} office:version="1.0" office:class="text"><office:body><text:p>hi</text:p></office:body></office:document-content>`,
    );
    expect(out).toContain(`xmlns="${ODF_NAMESPACES.office}"`);
  });

  it("does not treat a non-xmlns attribute as a namespace declaration even when its value matches a known namespace URI", () => {
    // "aaaaaatext" is deliberately not a namespace declaration (no "xmlns:" prefix) but is long enough that a broken skip-check would slice it down to "text" and, seeing its value resolve to the table URI, silently redirect every text:-prefixed name in the document onto table: instead.
    const out = transformWhole(
      `<office:document-content ${OOO_XMLNS} aaaaaatext="http://openoffice.org/2000/table" office:version="1.0" office:class="text"><office:body><text:p>hi</text:p></office:body></office:document-content>`,
    );
    expect(out).toContain(`<text:p>hi</text:p>`);
    expect(out).not.toContain("table:p");
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
    // A master document's body is still office:text in ODF — the master-ness lives in the media type, not the genre element.
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

  it("drops office:class only from a document root element, keeping any other root attribute and any office:class attribute elsewhere", () => {
    const out = transformWhole(
      `<office:document-content ${OOO_XMLNS} office:version="1.0" office:class="text"><office:body><text:p office:class="not-a-root">hi</text:p></office:body></office:document-content>`,
    );
    expect(out).toContain(`office:version="1.0"`);
    expect(out).not.toMatch(/<office:document-content[^>]*office:class=/);
    expect(out).toContain(`office:class="not-a-root"`);
  });

  it("leaves office:body unwrapped when there is no office:class to derive a genre from", () => {
    const out = transformWhole(
      `<office:document-content ${OOO_XMLNS} office:version="1.0"><office:body><text:p>hi</text:p></office:body></office:document-content>`,
    );
    expect(out).toContain(`<office:body><text:p>hi</text:p></office:body>`);
  });

  it("leaves an XML part with no root element completely alone", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(contentXml("<text:p/>")),
        },
        "stray.xml": { kind: "xml", nodes: [{ type: "text", value: "stray" }] },
      },
    };
    const out = transformOoo1Package(pkg);
    expect(out.parts["stray.xml"]).toEqual({
      kind: "xml",
      nodes: [{ type: "text", value: "stray" }],
    });
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

  it("leaves a style's own style:properties unsplit when its family is not one this codec classifies", () => {
    const out = automaticStyles(
      `<style:style style:name="X1" style:family="weird-family"><style:properties draw:fill="none"/></style:style>`,
    );
    expect(out).toContain(`<style:properties draw:fill="none"/>`);
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

  it("renames a paragraph's text:level to text:outline-level too, not only a heading's", () => {
    const out = transformContent(
      `<text:p text:style-name="P1" text:level="1">Body</text:p>`,
    );
    expect(out).toContain(
      `<text:p text:style-name="P1" text:outline-level="1">Body</text:p>`,
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

  it("renames a cell's own validation-name to the content-validation-name ODF spells it with", () => {
    const out = transformContent(
      `<table:table><table:table-row><table:table-cell table:validation-name="V1"><text:p/></table:table-cell></table:table-row></table:table>`,
    );
    expect(out).toContain(`table:content-validation-name="V1"`);
    expect(out).not.toContain("table:validation-name");
  });

  it("leaves a table:value-type-shaped attribute alone outside a real cell element", () => {
    const out = transformContent(
      `<table:table table:value-type="float"><table:table-row><table:table-cell><text:p/></table:table-cell></table:table-row></table:table>`,
    );
    expect(out).toContain(`<table:table table:value-type="float">`);
  });

  it("moves a text field's value-carrying attributes to the office namespace", () => {
    const out = transformContent(
      `<text:variable-set text:name="v1" text:value-type="float" text:value="42">42</text:variable-set>`,
    );
    expect(out).toContain(
      `<text:variable-set text:name="v1" office:value-type="float" office:value="42">42</text:variable-set>`,
    );
  });

  it("leaves a text:value-type-shaped attribute alone outside a real text-value element", () => {
    const out = transformContent(`<text:p text:value-type="float">hi</text:p>`);
    expect(out).toContain(`<text:p text:value-type="float">hi</text:p>`);
  });

  it("renames a multi-column layout's own margin attributes to the indent pair, leaving any other attribute alone", () => {
    const out = transformContent(
      `<style:column fo:margin-left="1inch" fo:margin-right="2inch" fo:padding="3inch"/>`,
    );
    expect(out).toContain(
      `<style:column fo:start-indent="1in" fo:end-indent="2in" fo:padding="3in"/>`,
    );
  });

  it("renames table:sub-table to table:table with the sub-table flag", () => {
    const out = transformContent(
      `<table:table table:name="Outer"><table:table-row><table:table-cell><table:sub-table table:name="Inner"><table:table-row><table:table-cell><text:p/></table:table-cell></table:table-row></table:sub-table></table:table-cell></table:table-row></table:table>`,
    );
    expect(out).toContain(
      `<table:table table:name="Inner" table:is-sub-table="true">`,
    );
    expect(out).not.toContain("table:sub-table");
  });

  it("drops the boolean form:property-is-list flag while keeping the property's own other attributes", () => {
    const out = transformContent(
      `<form:property form:property-name="P1" form:property-is-list="true"/>`,
    );
    expect(out).toContain(`<form:property form:property-name="P1"/>`);
    expect(out).not.toContain("form:property-is-list");
  });

  it("never rewrites an inch-shaped token inside a name-suffixed or xlink:href attribute", () => {
    const out = transformContent(
      `<draw:image draw:name="Logo 2inch" xlink:href="#note 5inch"/>`,
    );
    expect(out).toContain(`draw:name="Logo 2inch"`);
    expect(out).toContain(`xlink:href="note 5inch"`);
  });

  it("only rewrites a package-internal xlink:href with a leading '#' on a frame-eligible element, leaving other attributes and non-matching hrefs alone", () => {
    const out = transformContent(
      `<draw:image draw:name="#weird" xlink:href="Pictures/a.png"/>`,
    );
    expect(out).toContain(`draw:name="#weird"`);
    expect(out).toContain(`xlink:href="Pictures/a.png"`);
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
    // The second, non-root entry's own media type is not a manifest concern of this rewrite — it must survive untouched.
    expect(xml).toContain(
      `manifest:media-type="text/xml" manifest:full-path="content.xml"`,
    );
  });

  it("only rewrites manifest:file-entry children when writing the synthesised media type, leaving a same-shaped decoy tag alone", () => {
    const pkg: Package = {
      parts: {
        "META-INF/manifest.xml": {
          kind: "xml",
          nodes: parseXml(
            `<manifest:manifest xmlns:manifest="http://openoffice.org/2001/manifest"><manifest:not-a-file-entry manifest:full-path="/" manifest:media-type="application/vnd.sun.xml.writer"/><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.sun.xml.writer"/></manifest:manifest>`,
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
    expect(xml).toContain(
      `<manifest:not-a-file-entry manifest:full-path="/" manifest:media-type="application/vnd.sun.xml.writer"/>`,
    );
    expect(xml).toContain(
      `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>`,
    );
  });

  it("resolves the manifest's own media type from its root entry alone, skipping a decoy element, a non-root entry, and a decoy attribute", () => {
    const pkg: Package = {
      parts: {
        "META-INF/manifest.xml": {
          kind: "xml",
          nodes: parseXml(
            `<manifest:manifest xmlns:manifest="http://openoffice.org/2001/manifest">` +
              `<manifest:not-a-file-entry manifest:media-type="text/plain" manifest:full-path="/"/>` +
              `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
              `<manifest:file-entry manifest:decoy="nope" manifest:full-path="/" manifest:media-type="application/vnd.sun.xml.writer"/>` +
              `</manifest:manifest>`,
          ),
        },
      },
    };
    const out = transformOoo1Package(pkg);
    const mimetype = out.parts.mimetype;
    if (mimetype?.kind !== "binary") {
      throw new Error("mimetype part was not written as a binary part");
    }
    expect(new TextDecoder().decode(base64ToBytes(mimetype.base64))).toBe(
      "application/vnd.oasis.opendocument.text",
    );
  });

  it("never treats a same-shaped element elsewhere in the package as a manifest entry, even when odfMediaType resolves", () => {
    const pkg: Package = {
      parts: {
        "META-INF/manifest.xml": {
          kind: "xml",
          nodes: parseXml(
            `<manifest:manifest xmlns:manifest="http://openoffice.org/2001/manifest"><manifest:file-entry manifest:media-type="application/vnd.sun.xml.writer" manifest:full-path="/"/></manifest:manifest>`,
          ),
        },
        "content.xml": {
          kind: "xml",
          nodes: parseXml(
            `<office:document-content ${OOO_XMLNS} office:version="1.0" office:class="text"><manifest:file-entry xmlns:manifest="http://openoffice.org/2001/manifest" manifest:full-path="/" manifest:media-type="application/vnd.sun.xml.writer"/><office:body><text:p/></office:body></office:document-content>`,
          ),
        },
      },
    };
    const out = transformOoo1Package(pkg).parts["content.xml"];
    if (out?.kind !== "xml") {
      throw new Error("content.xml did not survive as an XML part");
    }
    const xml = selfCloseEmpty(buildXml(out.nodes));
    expect(xml).toContain(
      `manifest:media-type="application/vnd.sun.xml.writer"`,
    );
  });

  it("synthesises no mimetype part when the manifest's own root media type can't be resolved", () => {
    const pkg: Package = {
      parts: {
        "content.xml": {
          kind: "xml",
          nodes: parseXml(contentXml("<text:p/>")),
        },
      },
    };
    expect(transformOoo1Package(pkg).parts.mimetype).toBeUndefined();
  });

  it("never overwrites a mimetype part the package already carries", () => {
    const pkg: Package = {
      parts: {
        "META-INF/manifest.xml": {
          kind: "xml",
          nodes: parseXml(
            `<manifest:manifest xmlns:manifest="http://openoffice.org/2001/manifest"><manifest:file-entry manifest:media-type="application/vnd.sun.xml.writer" manifest:full-path="/"/></manifest:manifest>`,
          ),
        },
        "content.xml": {
          kind: "xml",
          nodes: parseXml(contentXml("<text:p/>")),
        },
        mimetype: { kind: "binary", base64: "AAEC" },
      },
    };
    expect(transformOoo1Package(pkg).parts.mimetype).toEqual({
      kind: "binary",
      base64: "AAEC",
    });
  });

  it("does not restructure an already-ODF package even where its shapes overlap with an OpenOffice.org 1.x rewrite rule", () => {
    const odf = `<office:document-content xmlns:office="${ODF_NAMESPACES.office}" xmlns:dc="${ODF_NAMESPACES.dc}"><office:body><office:text><office:annotation office:author="Ada" office:create-date="2003-10-16T09:22:13"></office:annotation></office:text></office:body></office:document-content>`;
    expect(transformWhole(odf)).toBe(selfCloseEmpty(buildXml(parseXml(odf))));
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
