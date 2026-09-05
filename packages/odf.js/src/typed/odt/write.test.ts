import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  ContentSection,
} from "document-schema.js";
import { PAGE_SIZE_A4, PAGE_SIZE_LETTER } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import type { Package } from "../../model/package";
import { encodePackage } from "../../codec";
import { readManifest } from "../../manifest";
import { buildXml } from "../../xml/build";
import {
  attrValue,
  childrenWithTag,
  elementsWithTag,
  findChildElement,
  rootElement,
} from "../../xml/query";
import { assertMimetypeEntryLayout } from "../../test-support/zip";
import { writeOdtContent } from "./write";

// The write side's XML-shape suite: what writeOdtContent actually emits, construct by construct. The round-trip suite beside it (write-round-trip.test.ts) proves the output reads back as the document it came from; this one proves the output is the ODF a real consumer expects, which a round trip through one package's own reader cannot -- a writer and reader that agreed on the same wrong spelling would round-trip perfectly and open nowhere.
//
// The one spelling this file pins hardest, style:master-page-name's position, is exactly that case: it was verified against LibreOffice directly rather than against this package's own reader (see the master-page describe block below).

const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

function section(blocks: ContentBlock[]): ContentSection {
  return { pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks };
}

function documentOf(blocks: ContentBlock[]): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [section(blocks)],
  };
}

function partRoot(pkg: Package, path: string): XmlElement {
  const part = pkg.parts[path];
  if (part?.kind !== "xml") {
    throw new Error(`expected an XML part at ${path}`);
  }
  const root = rootElement(part.nodes);
  if (root === undefined) {
    throw new Error(`expected a root element in ${path}`);
  }
  return root;
}

function partXml(pkg: Package, path: string): string {
  const part = pkg.parts[path];
  if (part?.kind !== "xml") {
    throw new Error(`expected an XML part at ${path}`);
  }
  return buildXml(part.nodes);
}

function textBody(pkg: Package): XmlElement {
  const body = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:body",
  );
  const text =
    body === undefined
      ? undefined
      : findChildElement(body.children, "office:text");
  if (text === undefined) {
    throw new Error("expected office:body/office:text");
  }
  return text;
}

function bodyElements(pkg: Package): XmlElement[] {
  return textBody(pkg).children.filter(
    (node): node is XmlElement => node.type === "element",
  );
}

function contentAutomaticStyles(pkg: Package): XmlElement {
  const container = findChildElement(
    partRoot(pkg, "content.xml").children,
    "office:automatic-styles",
  );
  if (container === undefined) {
    throw new Error("expected content.xml office:automatic-styles");
  }
  return container;
}

function styleNamed(
  container: XmlElement,
  name: string,
  family: string,
): XmlElement {
  const found = childrenWithTag(container, "style:style").find(
    (style) =>
      attrValue(style, "style:name") === name &&
      attrValue(style, "style:family") === family,
  );
  if (found === undefined) {
    throw new Error(`expected a ${family} style named ${name}`);
  }
  return found;
}

function paragraphOf(pkg: Package, index: number): XmlElement {
  const element = bodyElements(pkg)[index];
  if (element === undefined) {
    throw new Error(`expected a body element at index ${index}`);
  }
  return element;
}

describe("writeOdtContent: package structure", () => {
  const pkg = writeOdtContent(
    documentOf([{ kind: "paragraph", runs: [{ text: "Body" }] }]),
  );

  it("writes exactly the parts a text document needs, and no settings.xml", () => {
    expect(Object.keys(pkg.parts).sort()).toEqual([
      "META-INF/manifest.xml",
      "content.xml",
      "meta.xml",
      "mimetype",
      "styles.xml",
    ]);
  });

  it("encodes to a zip whose first entry is the stored, uncompressed mimetype part", () => {
    assertMimetypeEntryLayout(
      encodePackage(pkg),
      "application/vnd.oasis.opendocument.text",
    );
  });

  it("derives a manifest naming every part with its own media type", () => {
    const manifest = readManifest(pkg);
    expect(manifest.version).toBe("1.3");
    expect(
      manifest.entries.map((entry) => [entry.fullPath, entry.mediaType]),
    ).toEqual(
      expect.arrayContaining([
        ["/", "application/vnd.oasis.opendocument.text"],
        ["content.xml", "text/xml"],
        ["styles.xml", "text/xml"],
        ["meta.xml", "text/xml"],
      ]),
    );
  });

  it("stamps office:version on both document parts", () => {
    expect(attrValue(partRoot(pkg, "content.xml"), "office:version")).toBe(
      "1.3",
    );
    expect(attrValue(partRoot(pkg, "styles.xml"), "office:version")).toBe(
      "1.3",
    );
  });

  it("honours an explicit ODF version on the parts and the manifest alike", () => {
    const versioned = writeOdtContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "Body" }] }]),
      { version: "1.2" },
    );
    expect(
      attrValue(partRoot(versioned, "content.xml"), "office:version"),
    ).toBe("1.2");
    expect(readManifest(versioned).version).toBe("1.2");
  });

  it("declares the namespace prefixes its own content uses", () => {
    const root = partRoot(pkg, "content.xml");
    expect(attrValue(root, "xmlns:text")).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    );
    // The two easily-mistaken URIs (see src/ns.ts): drawing:1.0, not draw:1.0, and OASIS's own xsl-fo-compatible URI rather than the real W3C one.
    expect(attrValue(root, "xmlns:draw")).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:drawing:1.0",
    );
    expect(attrValue(root, "xmlns:fo")).toBe(
      "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0",
    );
  });

  it("stamps the template media type, in both the mimetype part and the manifest root entry, when template is requested", () => {
    const template = writeOdtContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "Body" }] }]),
      { template: true },
    );
    assertMimetypeEntryLayout(
      encodePackage(template),
      "application/vnd.oasis.opendocument.text-template",
    );
    expect(
      readManifest(template).entries.find((entry) => entry.fullPath === "/")
        ?.mediaType,
    ).toBe("application/vnd.oasis.opendocument.text-template");
  });
});

describe("writeOdtContent: paragraphs and runs", () => {
  it("writes an unformatted paragraph as a bare text:p with no style reference at all", () => {
    const pkg = writeOdtContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "Plain" }] }]),
    );
    const paragraph = paragraphOf(pkg, 0);
    expect(paragraph.tag).toBe("text:p");
    expect(paragraph.attributes).toEqual([]);
    expect(buildXml([paragraph])).toBe("<text:p>Plain</text:p>");
  });

  it("interns a run's formatting as a 'text'-family automatic style and wraps the run in a text:span", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [
            { text: "plain " },
            {
              text: "loud",
              bold: true,
              italic: true,
              underline: true,
              strike: true,
              fontFamily: "Liberation Sans",
              sizePt: 14,
              color: { r: 1, g: 0, b: 0 },
            },
          ],
        },
      ]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      '<text:p>plain <text:span text:style-name="T1">loud</text:span></text:p>',
    );
    const style = styleNamed(contentAutomaticStyles(pkg), "T1", "text");
    const properties = childrenWithTag(style, "style:text-properties")[0];
    expect(properties).toBeDefined();
    expect(buildXml([style])).toBe(
      '<style:style style:name="T1" style:family="text">' +
        '<style:text-properties fo:font-weight="bold" fo:font-style="italic"' +
        ' style:text-underline-style="solid" style:text-underline-width="auto"' +
        ' style:text-underline-color="font-color" style:text-line-through-style="solid"' +
        ' style:text-line-through-type="single" fo:font-family="Liberation Sans"' +
        ' fo:font-size="14pt" fo:color="#ff0000"></style:text-properties></style:style>',
    );
  });

  it("interns one style for two identically-formatted runs, however far apart they sit", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "one", bold: true }] },
        { kind: "paragraph", runs: [{ text: "two" }] },
        { kind: "paragraph", runs: [{ text: "three", bold: true }] },
      ]),
    );
    expect(
      childrenWithTag(contentAutomaticStyles(pkg), "style:style").filter(
        (style) => attrValue(style, "style:family") === "text",
      ),
    ).toHaveLength(1);
    expect(buildXml([paragraphOf(pkg, 2)])).toBe(
      '<text:p><text:span text:style-name="T1">three</text:span></text:p>',
    );
  });

  it("interns paragraph-level formatting as a 'paragraph'-family automatic style", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "x" }],
          alignment: "center",
          spacingBeforePt: 6,
          spacingAfterPt: 3,
          lineSpacing: 1.5,
          indentLeftPt: 18,
          indentFirstLinePt: 9,
          pageBreakBefore: true,
        },
      ]),
    );
    expect(attrValue(paragraphOf(pkg, 0), "text:style-name")).toBe("P1");
    expect(
      buildXml([styleNamed(contentAutomaticStyles(pkg), "P1", "paragraph")]),
    ).toBe(
      '<style:style style:name="P1" style:family="paragraph">' +
        '<style:paragraph-properties fo:text-align="center" fo:margin-top="6pt"' +
        ' fo:margin-bottom="3pt" fo:line-height="150%" fo:margin-left="18pt"' +
        ' fo:text-indent="9pt" fo:break-before="page"></style:paragraph-properties></style:style>',
    );
  });

  it("writes a heading as a text:h carrying its own outline level", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          headingLevel: 3,
          styleId: "Heading3",
          runs: [{ text: "Deep" }],
        },
      ]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      '<text:h text:outline-level="3">Deep</text:h>',
    );
  });

  it("groups consecutive runs sharing one hyperlink into a single text:a", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [
            { text: "see " },
            { text: "the ", hyperlink: "https://example.invalid/" },
            { text: "docs", bold: true, hyperlink: "https://example.invalid/" },
            { text: " now" },
          ],
        },
      ]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      "<text:p>see " +
        '<text:a xlink:type="simple" xlink:href="https://example.invalid/">the ' +
        '<text:span text:style-name="T1">docs</text:span></text:a> now</text:p>',
    );
  });

  it("XML-encodes text and attribute values rather than emitting them raw", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [
            { text: "a & b < c" },
            { text: "linked", hyperlink: "https://example.invalid/?a=1&b=2" },
          ],
        },
      ]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      "<text:p>a &amp; b &lt; c" +
        '<text:a xlink:type="simple" xlink:href="https://example.invalid/?a=1&amp;b=2">' +
        "linked</text:a></text:p>",
    );
  });
});

// ODF represents a run of two or more spaces, a tab, and a hard line break as ELEMENTS, because paragraph text collapses whitespace HTML-style. A writer that emitted them as literal characters would produce a document whose own text changes the moment any conforming consumer applies the format's rules -- so these are the assertions that keep the writer honest about it.
describe("writeOdtContent: whitespace is structure", () => {
  it("leaves a single interior space literal, so ordinary prose stays one text node", () => {
    const pkg = writeOdtContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "one two three" }] }]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      "<text:p>one two three</text:p>",
    );
  });

  it("writes a run of two or more spaces as a text:s carrying its own count", () => {
    const pkg = writeOdtContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "a   b" }] }]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      '<text:p>a<text:s text:c="3"></text:s>b</text:p>',
    );
  });

  it("protects a leading and a trailing space, which a conforming consumer would otherwise strip", () => {
    const pkg = writeOdtContent(
      documentOf([{ kind: "paragraph", runs: [{ text: " a " }] }]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      "<text:p><text:s></text:s>a<text:s></text:s></text:p>",
    );
  });

  it("writes a tab and a hard line break as their own elements", () => {
    const pkg = writeOdtContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "a\tb\nc" }] }]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      "<text:p>a<text:tab></text:tab>b<text:line-break></text:line-break>c</text:p>",
    );
  });

  it("protects two single spaces that would otherwise collapse across a span boundary", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "a " }, { text: " b", bold: true }],
        },
      ]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      "<text:p>a<text:s></text:s>" +
        '<text:span text:style-name="T1"><text:s></text:s>b</text:span></text:p>',
    );
  });
});

describe("writeOdtContent: lists", () => {
  const listDocument = documentOf([
    {
      kind: "paragraph",
      runs: [{ text: "one" }],
      list: { numId: "bullet:list1", level: 0 },
    },
    {
      kind: "paragraph",
      runs: [{ text: "one.a" }],
      list: { numId: "bullet:list1", level: 1 },
    },
    {
      kind: "paragraph",
      runs: [{ text: "two" }],
      list: { numId: "bullet:list1", level: 0 },
    },
  ]);

  it("nests a deeper item inside the preceding item's own text:list", () => {
    const pkg = writeOdtContent(listDocument);
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      '<text:list text:style-name="L1">' +
        "<text:list-item><text:p>one</text:p>" +
        "<text:list><text:list-item><text:p>one.a</text:p></text:list-item></text:list>" +
        "</text:list-item>" +
        "<text:list-item><text:p>two</text:p></text:list-item>" +
        "</text:list>",
    );
  });

  it("states the ordered-versus-bullet kind the only way ODF can -- a text:list-style's own level-1 child", () => {
    const bullet = writeOdtContent(listDocument);
    const bulletStyle = childrenWithTag(
      contentAutomaticStyles(bullet),
      "text:list-style",
    )[0];
    expect(bulletStyle).toBeDefined();
    expect(attrValue(bulletStyle!, "style:name")).toBe("L1");
    expect(
      childrenWithTag(bulletStyle!, "text:list-level-style-bullet"),
    ).toHaveLength(10);

    const ordered = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "one" }],
          list: { numId: "ordered:list1", level: 0 },
        },
      ]),
    );
    const orderedStyle = childrenWithTag(
      contentAutomaticStyles(ordered),
      "text:list-style",
    )[0];
    expect(
      childrenWithTag(orderedStyle!, "text:list-level-style-number"),
    ).toHaveLength(10);
  });

  it("mints one list style per kind, not one per list", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "bullet:list1", level: 0 },
        },
        { kind: "paragraph", runs: [{ text: "between" }] },
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "bullet:list2", level: 0 },
        },
      ]),
    );
    expect(
      childrenWithTag(contentAutomaticStyles(pkg), "text:list-style"),
    ).toHaveLength(1);
    // Two separate lists, though: a paragraph that is not one of their own closes the run.
    expect(
      bodyElements(pkg).filter((element) => element.tag === "text:list"),
    ).toHaveLength(2);
  });

  it("writes a list with no stated kind as a text:list with no style reference", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "whatever", level: 0 },
        },
      ]),
    );
    expect(attrValue(paragraphOf(pkg, 0), "text:style-name")).toBeUndefined();
    expect(
      childrenWithTag(contentAutomaticStyles(pkg), "text:list-style"),
    ).toHaveLength(0);
  });

  it("opens the intervening containers for an item that jumps more than one level deeper", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "paragraph",
          runs: [{ text: "deep" }],
          list: { numId: "bullet:list1", level: 2 },
        },
      ]),
    );
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      '<text:list text:style-name="L1"><text:list-item><text:list><text:list-item>' +
        "<text:list><text:list-item><text:p>deep</text:p></text:list-item></text:list>" +
        "</text:list-item></text:list></text:list-item></text:list>",
    );
  });
});

describe("writeOdtContent: tables", () => {
  const pkg = writeOdtContent(
    documentOf([
      {
        kind: "table",
        columnWidthsPt: [60, 90],
        rows: [
          {
            heightPt: 24,
            cells: [
              {
                colSpan: 2,
                background: { kind: "solid", color: { r: 1, g: 1, b: 0 } },
                borders: {
                  top: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
                  left: {
                    color: { r: 0, g: 0, b: 1 },
                    widthPt: 2,
                    style: "dotted",
                  },
                },
                blocks: [{ kind: "paragraph", runs: [{ text: "wide" }] }],
              },
              { blocks: [] },
            ],
          },
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "a" }] }] },
              { blocks: [{ kind: "paragraph", runs: [{ text: "b" }] }] },
            ],
          },
        ],
      },
    ]),
  );
  const table = paragraphOf(pkg, 0);

  it("writes a named table with one table:table-column per stated width", () => {
    expect(table.tag).toBe("table:table");
    expect(attrValue(table, "table:name")).toBe("Table1");
    const columns = childrenWithTag(table, "table:table-column");
    expect(columns).toHaveLength(2);
    expect(
      buildXml([
        styleNamed(contentAutomaticStyles(pkg), "co1", "table-column"),
      ]),
    ).toBe(
      '<style:style style:name="co1" style:family="table-column">' +
        '<style:table-column-properties style:column-width="60pt">' +
        "</style:table-column-properties></style:style>",
    );
  });

  it("carries the table's own total width on its table style", () => {
    expect(
      buildXml([styleNamed(contentAutomaticStyles(pkg), "ta1", "table")]),
    ).toBe(
      '<style:style style:name="ta1" style:family="table">' +
        '<style:table-properties table:align="margins" style:width="150pt">' +
        "</style:table-properties></style:style>",
    );
  });

  it("writes a row height as a table-row style", () => {
    expect(
      buildXml([styleNamed(contentAutomaticStyles(pkg), "ro1", "table-row")]),
    ).toBe(
      '<style:style style:name="ro1" style:family="table-row">' +
        '<style:table-row-properties style:row-height="24pt">' +
        "</style:table-row-properties></style:style>",
    );
  });

  it("writes a span, and the grid position it covers as a table:covered-table-cell", () => {
    const rows = childrenWithTag(table, "table:table-row");
    const firstRowCells = rows[0]!.children.filter(
      (node): node is XmlElement => node.type === "element",
    );
    expect(firstRowCells.map((cell) => cell.tag)).toEqual([
      "table:table-cell",
      "table:covered-table-cell",
    ]);
    expect(attrValue(firstRowCells[0]!, "table:number-columns-spanned")).toBe(
      "2",
    );
  });

  it("writes a cell's fill and per-edge borders in ODF's own three-token shorthand", () => {
    expect(
      buildXml([styleNamed(contentAutomaticStyles(pkg), "ce1", "table-cell")]),
    ).toBe(
      '<style:style style:name="ce1" style:family="table-cell">' +
        '<style:table-cell-properties fo:background-color="#ffff00"' +
        ' fo:border-left="2pt dotted #0000ff" fo:border-top="1pt solid #000000">' +
        "</style:table-cell-properties></style:style>",
    );
  });

  it("writes a cell's blocks as ordinary paragraphs", () => {
    const cell = elementsWithTag([table], "table:table-cell")[0];
    expect(buildXml([cell!])).toContain("<text:p>wide</text:p>");
  });
});

describe("writeOdtContent: images", () => {
  // A 1x1 PNG, the smallest real image a sniffing manifest builder can classify.
  const PNG_BASE64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("stores the image bytes as a Pictures part the manifest classifies by sniffing", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "before" }] },
        {
          kind: "image",
          format: "png",
          base64: PNG_BASE64,
          widthPt: 48,
          heightPt: 24,
          altText: "A dot",
        },
      ]),
    );
    expect(pkg.parts["Pictures/image1.png"]).toEqual({
      kind: "binary",
      base64: PNG_BASE64,
    });
    expect(
      readManifest(pkg).entries.find(
        (entry) => entry.fullPath === "Pictures/image1.png",
      )?.mediaType,
    ).toBe("image/png");
  });

  it("anchors the frame inside the preceding paragraph, as-char, sized but unpositioned", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "before" }] },
        {
          kind: "image",
          format: "png",
          base64: PNG_BASE64,
          widthPt: 48,
          heightPt: 24,
          altText: "A dot",
        },
      ]),
    );
    expect(bodyElements(pkg)).toHaveLength(1);
    expect(buildXml([paragraphOf(pkg, 0)])).toBe(
      "<text:p>before" +
        '<draw:frame text:anchor-type="as-char" svg:width="48pt" svg:height="24pt">' +
        '<draw:image xlink:href="Pictures/image1.png" xlink:type="simple"' +
        ' xlink:show="embed" xlink:actuate="onLoad"></draw:image>' +
        "<svg:title>A dot</svg:title></draw:frame></text:p>",
    );
  });

  it("opens an empty anchor paragraph for an image with nothing before it to hang off", () => {
    const pkg = writeOdtContent(
      documentOf([
        {
          kind: "image",
          format: "png",
          base64: PNG_BASE64,
          widthPt: 10,
          heightPt: 10,
        },
      ]),
    );
    const elements = bodyElements(pkg);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.tag).toBe("text:p");
    expect(childrenWithTag(elements[0]!, "draw:frame")).toHaveLength(1);
  });

  it("names each image part after its own format", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "x" }] },
        {
          kind: "image",
          format: "jpeg",
          base64: PNG_BASE64,
          widthPt: 10,
          heightPt: 10,
        },
      ]),
    );
    expect(Object.keys(pkg.parts)).toContain("Pictures/image1.jpg");
  });
});

describe("writeOdtContent: page geometry and section boundaries", () => {
  const pkg = writeOdtContent({
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: PAGE_SIZE_A4,
        margins: MARGINS,
        blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
      },
      {
        pageSize: PAGE_SIZE_LETTER,
        margins: { topPt: 36, rightPt: 36, bottomPt: 36, leftPt: 36 },
        breakType: "nextPage",
        blocks: [
          {
            kind: "paragraph",
            runs: [{ text: "second" }],
            alignment: "center",
          },
        ],
      },
    ],
  });
  const stylesRoot = partRoot(pkg, "styles.xml");

  it("writes one page layout per section, carrying its own size and margins", () => {
    const automatic = findChildElement(
      stylesRoot.children,
      "office:automatic-styles",
    );
    const layouts = childrenWithTag(automatic!, "style:page-layout");
    expect(layouts.map((layout) => attrValue(layout, "style:name"))).toEqual([
      "PM1",
      "PM2",
    ]);
    expect(
      buildXml(childrenWithTag(layouts[1]!, "style:page-layout-properties")),
    ).toBe(
      '<style:page-layout-properties fo:page-width="612pt" fo:page-height="792pt"' +
        ' style:print-orientation="portrait" fo:margin-top="36pt" fo:margin-right="36pt"' +
        ' fo:margin-bottom="36pt" fo:margin-left="36pt"></style:page-layout-properties>',
    );
  });

  it("writes one master page per section, each naming its own page layout", () => {
    const masterStyles = findChildElement(
      stylesRoot.children,
      "office:master-styles",
    );
    expect(
      childrenWithTag(masterStyles!, "style:master-page").map((page) => [
        attrValue(page, "style:name"),
        attrValue(page, "style:page-layout-name"),
      ]),
    ).toEqual([
      ["MP1", "PM1"],
      ["MP2", "PM2"],
    ]);
  });

  // The placement this test pins was verified against LibreOffice itself, not against this package's own reader: a flat-ODF document carrying style:master-page-name on style:style renders its second page at the second master page's own size and survives a re-save verbatim, while the identical document carrying it on style:paragraph-properties renders one page and has the attribute stripped outright. Writing it in the second position would round-trip perfectly through odf.js and open as a single-page document everywhere else.
  it("states a section's page-style switch as style:master-page-name on the style:style element itself", () => {
    const named = findChildElement(stylesRoot.children, "office:styles");
    expect(buildXml(childrenWithTag(named!, "style:style"))).toBe(
      '<style:style style:name="MP2Start" style:family="paragraph"' +
        ' style:master-page-name="MP2"></style:style>',
    );
  });

  it("reaches the switch from the section's first paragraph, through its own automatic style's parent", () => {
    const second = writeOdtContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
        },
        {
          pageSize: PAGE_SIZE_LETTER,
          margins: MARGINS,
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "second" }],
              alignment: "center",
            },
          ],
        },
      ],
    });
    const paragraph = paragraphOf(second, 1);
    const styleName = attrValue(paragraph, "text:style-name");
    expect(styleName).toBe("P1");
    expect(
      attrValue(
        styleNamed(contentAutomaticStyles(second), "P1", "paragraph"),
        "style:parent-style-name",
      ),
    ).toBe("MP2Start");
  });

  it("references the break style directly when the section's first paragraph has no formatting of its own", () => {
    expect(attrValue(paragraphOf(pkg, 1), "text:style-name")).toBe("P1");
    const plain = writeOdtContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
        },
        {
          pageSize: PAGE_SIZE_LETTER,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "second" }] }],
        },
      ],
    });
    expect(attrValue(paragraphOf(plain, 1), "text:style-name")).toBe(
      "MP2Start",
    );
  });

  it("opens an empty paragraph to carry the switch when a section starts with something that cannot", () => {
    const startsWithTable = writeOdtContent({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: PAGE_SIZE_A4,
          margins: MARGINS,
          blocks: [{ kind: "paragraph", runs: [{ text: "first" }] }],
        },
        {
          pageSize: PAGE_SIZE_LETTER,
          margins: MARGINS,
          blocks: [
            {
              kind: "table",
              columnWidthsPt: [40],
              rows: [{ cells: [{ blocks: [] }] }],
            },
          ],
        },
      ],
    });
    const elements = bodyElements(startsWithTable);
    expect(elements.map((element) => element.tag)).toEqual([
      "text:p",
      "text:p",
      "table:table",
    ]);
    expect(attrValue(elements[1]!, "text:style-name")).toBe("MP2Start");
  });
});

describe("writeOdtContent: page breaks", () => {
  it("folds a page-break block onto the following paragraph's own style", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "before" }] },
        { kind: "pageBreak" },
        { kind: "paragraph", runs: [{ text: "after" }] },
      ]),
    );
    const elements = bodyElements(pkg);
    expect(elements).toHaveLength(2);
    const style = styleNamed(contentAutomaticStyles(pkg), "P1", "paragraph");
    expect(
      attrValue(
        childrenWithTag(style, "style:paragraph-properties")[0]!,
        "fo:break-before",
      ),
    ).toBe("page");
    expect(attrValue(elements[1]!, "text:style-name")).toBe("P1");
  });

  it("opens an empty paragraph for a break with nothing after it to carry one", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "before" }] },
        { kind: "pageBreak" },
      ]),
    );
    const elements = bodyElements(pkg);
    expect(elements).toHaveLength(2);
    expect(buildXml([elements[1]!])).toBe(
      '<text:p text:style-name="P1"></text:p>',
    );
  });

  it("keeps two consecutive breaks as two breaks rather than collapsing them", () => {
    const pkg = writeOdtContent(
      documentOf([
        { kind: "paragraph", runs: [{ text: "before" }] },
        { kind: "pageBreak" },
        { kind: "pageBreak" },
        { kind: "paragraph", runs: [{ text: "after" }] },
      ]),
    );
    const elements = bodyElements(pkg);
    expect(elements).toHaveLength(3);
    expect(attrValue(elements[1]!, "text:style-name")).toBe("P1");
    expect(attrValue(elements[2]!, "text:style-name")).toBe("P1");
  });
});

describe("writeOdtContent: metadata", () => {
  it("writes each stated field into meta.xml, in ODF's own element vocabulary", () => {
    const pkg = writeOdtContent({
      kind: "wordprocessing",
      metadata: {
        title: "A title",
        author: "An author",
        subject: "A subject",
        keywords: ["alpha", "beta"],
        creator: "odf.js",
        createdIso: "2026-01-02T03:04:05Z",
        modifiedIso: "2026-02-03T04:05:06Z",
        language: "en-GB",
      },
      sections: [section([{ kind: "paragraph", runs: [{ text: "x" }] }])],
    });
    expect(partXml(pkg, "meta.xml")).toContain(
      "<office:meta><meta:generator>odf.js</meta:generator>" +
        "<dc:title>A title</dc:title><dc:subject>A subject</dc:subject>" +
        "<meta:keyword>alpha</meta:keyword><meta:keyword>beta</meta:keyword>" +
        "<meta:initial-creator>An author</meta:initial-creator>" +
        "<meta:creation-date>2026-01-02T03:04:05Z</meta:creation-date>" +
        "<dc:date>2026-02-03T04:05:06Z</dc:date>" +
        "<dc:language>en-GB</dc:language></office:meta>",
    );
  });

  it("writes an empty office:meta for a document that states nothing", () => {
    const pkg = writeOdtContent(
      documentOf([{ kind: "paragraph", runs: [{ text: "x" }] }]),
    );
    expect(partXml(pkg, "meta.xml")).toContain("<office:meta></office:meta>");
  });
});

// Every refusal below is a construct that carries real meaning: writing the document without it would produce an .odt that silently lost content the caller handed in. The residue channel is the one deliberate exception, and it is stated in normaliseOdtContent rather than refused, because residue is opaque by construction.
describe("writeOdtContent: what it refuses rather than dropping", () => {
  it("refuses a construct boundary marker", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "constructStart",
            descriptor: { kind: "anchor", anchorType: "bookmark", name: "b" },
          },
          { kind: "paragraph", runs: [{ text: "x" }] },
          { kind: "constructEnd" },
        ]),
      ),
    ).toThrow(/construct boundary marker/);
  });

  it("refuses a run-level construct extent", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "paragraph",
            runs: [{ text: "x" }],
            constructs: [
              {
                descriptor: { kind: "field", instruction: "<text:date/>" },
                startRun: 0,
                endRun: 1,
              },
            ],
          },
        ]),
      ),
    ).toThrow(/run-level construct extents/);
  });

  it("refuses an embedded object", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "embeddedObject",
            objectKind: "spreadsheet",
            frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
            document: {
              kind: "spreadsheet",
              metadata: {},
              sheets: [],
            },
          },
        ]),
      ),
    ).toThrow(/embedded object/);
  });

  it("refuses a table cell carrying anything but paragraphs, which the table reader could not read back", () => {
    expect(() =>
      writeOdtContent(
        documentOf([
          {
            kind: "table",
            columnWidthsPt: [40],
            rows: [
              {
                cells: [
                  {
                    blocks: [
                      {
                        kind: "table",
                        columnWidthsPt: [10],
                        rows: [{ cells: [{ blocks: [] }] }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      ),
    ).toThrow(/table cell/);
  });

  it("refuses a document of the wrong kind", () => {
    expect(() =>
      writeOdtContent({ kind: "presentation", metadata: {}, slides: [] }),
    ).toThrow(/expected a 'wordprocessing' document/);
  });

  it("refuses a document with no sections rather than inventing page geometry", () => {
    expect(() =>
      writeOdtContent({ kind: "wordprocessing", metadata: {}, sections: [] }),
    ).toThrow(/no page geometry/);
  });
});
