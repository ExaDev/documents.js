import { describe, expect, it } from "vitest";
import { bytesToBase64, decodePackage, ODF_MEDIA_TYPES } from "odf.js";
import type { XmlElement, XmlNode } from "odf.js";
import {
  decoratedOdsBytes,
  gridOdsBytes,
  minimalOdsBytes,
  richOdsBytes,
} from "./ods";
function isXmlElement(node: XmlNode): node is XmlElement {
  return node.type === "element";
}

function collectElements(nodes: readonly XmlNode[], tag: string): XmlElement[] {
  const found: XmlElement[] = [];
  for (const node of nodes) {
    if (!isXmlElement(node)) {
      continue;
    }
    if (node.tag === tag) {
      found.push(node);
    }
    found.push(...collectElements(node.children, tag));
  }
  return found;
}

function attrMap(element: XmlElement): Record<string, string> {
  return Object.fromEntries(
    element.attributes.map((attribute) => [attribute.name, attribute.value]),
  );
}

function xmlPart(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
): readonly XmlNode[] {
  const part = decodePackage(bytes).parts[name];
  if (part?.kind !== "xml") {
    throw new Error(`expected ${name} to be an xml part`);
  }
  return part.nodes;
}

function expectMimetypePart(
  bytes: Uint8Array<ArrayBuffer>,
  parts: ReturnType<typeof decodePackage>["parts"],
): void {
  const mimetype = parts.mimetype;
  if (mimetype?.kind !== "binary") {
    throw new Error("expected the mimetype part to be binary");
  }
  expect(mimetype.base64).toBe(
    bytesToBase64(new TextEncoder().encode(ODF_MEDIA_TYPES.ods)),
  );
}

const minimalContentXml = () => xmlPart(minimalOdsBytes(), "content.xml");
const minimalStylesXml = () => xmlPart(minimalOdsBytes(), "styles.xml");
const gridContentXml = () => xmlPart(gridOdsBytes(), "content.xml");
const richContentXml = () => xmlPart(richOdsBytes(), "content.xml");
const decoratedContentXml = () => xmlPart(decoratedOdsBytes(), "content.xml");

describe("every fixture's package skeleton", () => {
  it("roots content.xml at office:document-content with one automatic-styles, one body and one spreadsheet container, in every fixture", () => {
    for (const content of [
      minimalContentXml(),
      gridContentXml(),
      richContentXml(),
      decoratedContentXml(),
    ]) {
      const roots = content.filter(isXmlElement);
      expect(roots).toHaveLength(1);
      expect(roots[0]!.tag).toBe("office:document-content");
      expect(collectElements(content, "office:automatic-styles")).toHaveLength(
        1,
      );
      expect(collectElements(content, "office:body")).toHaveLength(1);
      expect(collectElements(content, "office:spreadsheet")).toHaveLength(1);
    }
  });

  it("roots styles.xml at office:document-styles with one automatic-styles and one master-styles container, in every fixture", () => {
    for (const bytes of [
      minimalOdsBytes(),
      gridOdsBytes(),
      richOdsBytes(),
      decoratedOdsBytes(),
    ]) {
      const styles = xmlPart(bytes, "styles.xml");
      const roots = styles.filter(isXmlElement);
      expect(roots).toHaveLength(1);
      expect(roots[0]!.tag).toBe("office:document-styles");
      expect(collectElements(styles, "office:automatic-styles")).toHaveLength(
        1,
      );
      expect(collectElements(styles, "office:master-styles")).toHaveLength(1);
    }
  });

  it("roots meta.xml at office:document-meta carrying exactly one dc:title, in every fixture that has one", () => {
    for (const bytes of [minimalOdsBytes(), gridOdsBytes(), richOdsBytes()]) {
      const meta = xmlPart(bytes, "meta.xml");
      const roots = meta.filter(isXmlElement);
      expect(roots).toHaveLength(1);
      expect(roots[0]!.tag).toBe("office:document-meta");
      expect(collectElements(meta, "office:meta")).toHaveLength(1);
      expect(collectElements(meta, "dc:title")).toHaveLength(1);
    }
  });
});

describe("minimalOdsBytes: raw package XML", () => {
  it("resolves the print-settings chain: PM1 page layout to Default master page, with the exact print attributes", () => {
    const layouts = collectElements(minimalStylesXml(), "style:page-layout");
    expect(layouts).toHaveLength(1);
    expect(attrMap(layouts[0]!)).toEqual({ "style:name": "PM1" });
    const properties = collectElements(
      minimalStylesXml(),
      "style:page-layout-properties",
    );
    expect(properties).toHaveLength(1);
    expect(attrMap(properties[0]!)).toEqual({
      "fo:page-width": "400pt",
      "fo:page-height": "300pt",
      "style:print": "grid headers",
      "style:print-page-order": "ttb",
    });
    const masters = collectElements(minimalStylesXml(), "style:master-page");
    expect(masters).toHaveLength(1);
    expect(attrMap(masters[0]!)).toEqual({
      "style:name": "Default",
      "style:page-layout-name": "PM1",
    });
  });

  it("declares the two column styles at their exact widths and the table style with its master-page link", () => {
    const styleElements = collectElements(minimalContentXml(), "style:style");
    expect(styleElements.map(attrMap)).toEqual([
      { "style:name": "ColA", "style:family": "table-column" },
      { "style:name": "ColB", "style:family": "table-column" },
      {
        "style:name": "DataTable",
        "style:family": "table",
        "style:master-page-name": "Default",
      },
    ]);
    const columnProperties = collectElements(
      minimalContentXml(),
      "style:table-column-properties",
    );
    expect(columnProperties.map(attrMap)).toEqual([
      { "style:column-width": "3cm" },
      { "style:column-width": "2cm" },
    ]);
  });

  it("builds the table with both columns (B collapsed), the three rows, and the exact cell attributes", () => {
    const tables = collectElements(minimalContentXml(), "table:table");
    expect(tables).toHaveLength(1);
    expect(attrMap(tables[0]!)).toEqual({
      "table:name": "Data",
      "table:style-name": "DataTable",
    });
    expect(
      collectElements(minimalContentXml(), "table:table-column").map(attrMap),
    ).toEqual([
      { "table:style-name": "ColA" },
      { "table:style-name": "ColB", "table:visibility": "collapse" },
    ]);
    expect(
      collectElements(minimalContentXml(), "table:table-row"),
    ).toHaveLength(3);
    expect(
      collectElements(minimalContentXml(), "table:table-cell").map(attrMap),
    ).toEqual([
      { "office:value-type": "string" },
      { "office:value-type": "string" },
      { "office:value-type": "string" },
      { "office:value-type": "float", "office:value": "123.45" },
      { "table:number-columns-spanned": "2", "office:value-type": "string" },
    ]);
    expect(
      collectElements(minimalContentXml(), "table:covered-table-cell").map(
        attrMap,
      ),
    ).toEqual([{}]);
    expect(
      collectElements(minimalContentXml(), "text:p").map((paragraph) =>
        JSON.stringify(paragraph.children),
      ),
    ).toEqual([
      JSON.stringify([{ type: "text", value: "Name" }]),
      JSON.stringify([{ type: "text", value: "Amount" }]),
      JSON.stringify([{ type: "text", value: "Acme" }]),
      JSON.stringify([{ type: "text", value: "123.45" }]),
      JSON.stringify([{ type: "text", value: "Merged" }]),
    ]);
  });

  it("carries the dc:title in meta.xml and the real ods mimetype as a binary part", () => {
    expect(
      collectElements(xmlPart(minimalOdsBytes(), "meta.xml"), "dc:title").map(
        attrMap,
      ),
    ).toEqual([{}]);
    expectMimetypePart(
      minimalOdsBytes(),
      decodePackage(minimalOdsBytes()).parts,
    );
  });
});

describe("gridOdsBytes: raw package XML", () => {
  it("declares one 2cm column style per column, each referenced by its own column", () => {
    expect(
      collectElements(gridContentXml(), "style:table-column-properties").map(
        attrMap,
      ),
    ).toEqual([
      { "style:column-width": "2cm" },
      { "style:column-width": "2cm" },
      { "style:column-width": "2cm" },
    ]);
    expect(
      collectElements(gridContentXml(), "table:table-column").map(attrMap),
    ).toEqual([
      { "table:style-name": "GridColA" },
      { "table:style-name": "GridColB" },
      { "table:style-name": "GridColC" },
    ]);
  });

  it("declares every automatic style by its exact attribute map", () => {
    expect(
      collectElements(gridContentXml(), "style:style").map(attrMap),
    ).toEqual([
      { "style:name": "GridColA", "style:family": "table-column" },
      { "style:name": "GridColB", "style:family": "table-column" },
      { "style:name": "GridColC", "style:family": "table-column" },
      { "style:name": "GridRow", "style:family": "table-row" },
      {
        "style:name": "GridTable",
        "style:family": "table",
        "style:master-page-name": "GridDefault",
      },
    ]);
    const gridStyles = xmlPart(gridOdsBytes(), "styles.xml");
    expect(
      collectElements(gridStyles, "style:page-layout").map(attrMap),
    ).toEqual([{ "style:name": "GridPM1" }]);
    expect(
      collectElements(gridStyles, "style:page-layout-properties").map(attrMap),
    ).toEqual([
      {
        "fo:page-width": "400pt",
        "fo:page-height": "300pt",
        "style:print": "grid headers",
        "style:print-page-order": "ttb",
      },
    ]);
    expect(
      collectElements(xmlPart(gridOdsBytes(), "meta.xml"), "dc:title"),
    ).toHaveLength(1);
  });

  it("declares the 0.6cm row style shared by all three rows, and the table style linked to the GridDefault master page", () => {
    expect(
      collectElements(gridContentXml(), "style:table-row-properties").map(
        attrMap,
      ),
    ).toEqual([{ "style:row-height": "0.6cm" }]);
    expect(
      collectElements(gridContentXml(), "table:table-row").map(attrMap),
    ).toEqual([
      { "table:style-name": "GridRow" },
      { "table:style-name": "GridRow" },
      { "table:style-name": "GridRow" },
    ]);
    expect(
      collectElements(gridContentXml(), "style:style")
        .filter((style) => attrMap(style)["style:name"] === "GridTable")
        .map(attrMap),
    ).toEqual([
      {
        "style:name": "GridTable",
        "style:family": "table",
        "style:master-page-name": "GridDefault",
      },
    ]);
    expect(
      collectElements(
        xmlPart(gridOdsBytes(), "styles.xml"),
        "style:master-page",
      ).map(attrMap),
    ).toEqual([
      { "style:name": "GridDefault", "style:page-layout-name": "GridPM1" },
    ]);
  });

  it("names the sheet Grid and writes nine string cells", () => {
    expect(
      collectElements(gridContentXml(), "table:table").map(attrMap),
    ).toEqual([{ "table:name": "Grid", "table:style-name": "GridTable" }]);
    expect(collectElements(gridContentXml(), "table:table-cell")).toHaveLength(
      9,
    );
    expect(
      new Set(
        collectElements(gridContentXml(), "table:table-cell").map(
          (cell) => attrMap(cell)["office:value-type"],
        ),
      ),
    ).toEqual(new Set(["string"]));
  });
});

describe("richOdsBytes: raw package XML", () => {
  it("declares the three distinct column widths 3cm, 4cm and 2cm in style order", () => {
    expect(
      collectElements(richContentXml(), "style:table-column-properties").map(
        attrMap,
      ),
    ).toEqual([
      { "style:column-width": "3cm" },
      { "style:column-width": "4cm" },
      { "style:column-width": "2cm" },
    ]);
  });

  it("declares every automatic style by its exact attribute map, and the full page-layout chain behind its table style", () => {
    expect(
      collectElements(richContentXml(), "style:style").map(attrMap),
    ).toEqual([
      { "style:name": "RichColA", "style:family": "table-column" },
      { "style:name": "RichColB", "style:family": "table-column" },
      { "style:name": "RichColC", "style:family": "table-column" },
      {
        "style:name": "RichTable",
        "style:family": "table",
        "style:master-page-name": "RichDefault",
      },
    ]);
    expect(
      collectElements(richContentXml(), "table:table-column").map(attrMap),
    ).toEqual([
      { "table:style-name": "RichColA" },
      { "table:style-name": "RichColB" },
      { "table:style-name": "RichColC" },
    ]);
    const richStyles = xmlPart(richOdsBytes(), "styles.xml");
    expect(
      collectElements(richStyles, "style:page-layout").map(attrMap),
    ).toEqual([{ "style:name": "RichPM1" }]);
    expect(
      collectElements(richStyles, "style:page-layout-properties").map(attrMap),
    ).toEqual([
      {
        "fo:page-width": "400pt",
        "fo:page-height": "300pt",
        "style:print": "grid headers",
        "style:print-page-order": "ttb",
      },
    ]);
  });

  it("writes every value type with its exact typed-value attribute", () => {
    expect(
      collectElements(richContentXml(), "table:table-cell").map(attrMap),
    ).toEqual([
      { "office:value-type": "string" },
      { "office:value-type": "string" },
      { "office:value-type": "string" },
      { "office:value-type": "string" },
      { "office:value-type": "float", "office:value": "42.5" },
      { "office:value-type": "boolean", "office:boolean-value": "true" },
      { "office:value-type": "percentage", "office:value": "0.15" },
      {
        "office:value-type": "currency",
        "office:value": "9.99",
        "office:currency": "USD",
      },
      { "office:value-type": "date", "office:date-value": "2026-01-15" },
      { "office:value-type": "time", "office:time-value": "PT14H30M00S" },
      {
        "office:value-type": "float",
        "office:value": "85",
        "table:formula": "of:=[.B2]*2",
      },
      { "table:number-columns-spanned": "2", "office:value-type": "string" },
    ]);
    expect(
      collectElements(richContentXml(), "table:covered-table-cell").map(
        attrMap,
      ),
    ).toEqual([{}]);
  });

  it("names the sheet Rich and links its table style to the RichDefault master page", () => {
    expect(
      collectElements(richContentXml(), "table:table").map(attrMap),
    ).toEqual([{ "table:name": "Rich", "table:style-name": "RichTable" }]);
    expect(
      collectElements(
        xmlPart(richOdsBytes(), "styles.xml"),
        "style:master-page",
      ).map(attrMap),
    ).toEqual([
      { "style:name": "RichDefault", "style:page-layout-name": "RichPM1" },
    ]);
    expect(
      collectElements(xmlPart(richOdsBytes(), "meta.xml"), "dc:title"),
    ).toHaveLength(1);
  });
});

describe("decoratedOdsBytes: raw package XML", () => {
  it("writes A1's style with the exact background, border shorthand, vertical align and paragraph alignment properties", () => {
    const cellProperties = collectElements(
      decoratedContentXml(),
      "style:table-cell-properties",
    );
    expect(cellProperties.map(attrMap)).toEqual([
      {
        "fo:background-color": "#ffff00",
        "fo:border": "2pt solid #0000ff",
        "style:vertical-align": "top",
      },
      { "fo:border-bottom": "1pt solid #ff0000" },
    ]);
    expect(
      collectElements(decoratedContentXml(), "style:paragraph-properties").map(
        attrMap,
      ),
    ).toEqual([{ "fo:text-align": "right" }]);
    expect(
      collectElements(decoratedContentXml(), "table:table-cell").map(attrMap),
    ).toEqual([
      { "table:style-name": "DecoratedA", "office:value-type": "string" },
      { "table:style-name": "DecoratedB", "office:value-type": "string" },
    ]);
  });

  it("declares every automatic style by its exact attribute map, including the table and row styles and both cell styles", () => {
    expect(
      collectElements(decoratedContentXml(), "style:style").map(attrMap),
    ).toEqual([
      { "style:name": "DecoratedCol", "style:family": "table-column" },
      { "style:name": "DecoratedRow", "style:family": "table-row" },
      {
        "style:name": "DecoratedTable",
        "style:family": "table",
        "style:master-page-name": "DecoratedDefault",
      },
      { "style:name": "DecoratedA", "style:family": "table-cell" },
      { "style:name": "DecoratedB", "style:family": "table-cell" },
    ]);
    expect(
      collectElements(decoratedContentXml(), "style:table-row-properties").map(
        attrMap,
      ),
    ).toEqual([{ "style:row-height": "1cm" }]);
    expect(
      collectElements(decoratedContentXml(), "table:table").map(attrMap),
    ).toEqual([
      { "table:name": "Decorated", "table:style-name": "DecoratedTable" },
    ]);
    expect(
      collectElements(decoratedContentXml(), "table:table-row").map(attrMap),
    ).toEqual([{ "table:style-name": "DecoratedRow" }]);
    expect(
      collectElements(
        xmlPart(decoratedOdsBytes(), "styles.xml"),
        "style:master-page",
      ).map(attrMap),
    ).toEqual([
      {
        "style:name": "DecoratedDefault",
        "style:page-layout-name": "DecoratedPM1",
      },
    ]);
  });

  it("omits meta.xml entirely and carries no print attributes on its page layout", () => {
    expect(decodePackage(decoratedOdsBytes()).parts.meta).toBeUndefined();
    expect(
      collectElements(
        xmlPart(decoratedOdsBytes(), "styles.xml"),
        "style:page-layout-properties",
      ).map(attrMap),
    ).toEqual([{ "fo:page-width": "400pt", "fo:page-height": "300pt" }]);
  });
});
