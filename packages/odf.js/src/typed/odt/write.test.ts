import { describe, expect, it } from "vitest";
import type {
  ContentBlock,
  ContentDocument,
  ContentSection,
} from "document-schema.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
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

// The write side's XML-shape suite: what writeOdtContent actually emits, construct by construct. The round-trip suite beside it (write-round-trip.test.ts) proves the output reads back as the document it came from; this one proves the output is the ODF a real consumer expects, which a round trip through one package's own reader cannot — a writer and reader that agreed on the same wrong spelling would round-trip perfectly and open nowhere.
//
// The one spelling this file pins hardest, style:master-page-name's position, is exactly that case: it was verified against LibreOffice directly rather than against this package's own reader (see the master-page describe block below).

const MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };

function section(blocks: readonly ContentBlock[]): ContentSection {
  return { pageSize: PAGE_SIZE_A4, margins: MARGINS, blocks: [...blocks] };
}

function documentOf(blocks: readonly ContentBlock[]): ContentDocument {
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

// ODF represents a run of two or more spaces, a tab, and a hard line break as ELEMENTS, because paragraph text collapses whitespace HTML-style. A writer that emitted them as literal characters would produce a document whose own text changes the moment any conforming consumer applies the format's rules — so these are the assertions that keep the writer honest about it.
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

  it("states the ordered-versus-bullet kind the only way ODF can — a text:list-style's own level-1 child", () => {
    // ODF's own maximum list-nesting depth (OASIS ODF 1.3 19.812): the writer always emits one level-style child per level, 1 through this bound, regardless of how deep the source list actually nests.
    const maxListLevels = 10;
    const bullet = writeOdtContent(listDocument);
    const bulletStyle = childrenWithTag(
      contentAutomaticStyles(bullet),
      "text:list-style",
    )[0];
    expect(bulletStyle).toBeDefined();
    expect(attrValue(bulletStyle!, "style:name")).toBe("L1");
    expect(
      childrenWithTag(bulletStyle!, "text:list-level-style-bullet"),
    ).toHaveLength(maxListLevels);

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
    ).toHaveLength(maxListLevels);
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
        columns: [{ widthPt: 60 }, { widthPt: 90 }],
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
