import { describe, it, expect } from "vitest";
import { parseXml } from "../xml/parse";
import type { Package } from "../model/package";
import { readSxw, readSxwContent } from "./read";
import { readSxc, readSxcContent } from "./read";
import { readSxi, readSxiContent } from "./read";
import { readSxd, readSxdContent } from "./read";

// Fixtures are built to the OpenOffice.org XML File Format 1.0 grammar (OpenOffice.org's own retained DTD, xmloff/dtd/office.mod and text.mod) and to the shape genuine OpenOffice.org 1.1/1.9 output takes -- the "inch" lengths, the bare draw:image, the single style:properties, the office:class attribute and the wrapper-free office:body are all copied from real .sxw/.sxc/.sxi/.sxd documents this reader was developed against, not invented.

const XMLNS = [
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

const META_XML = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${XMLNS} office:version="1.0"><office:meta><meta:generator>OpenOffice.org 1.1.0 (Linux)</meta:generator><dc:title>Legacy report</dc:title><dc:creator>G. Roderick Singleton</dc:creator><meta:initial-creator>Ada Lovelace</meta:initial-creator><meta:keywords><meta:keyword>legacy</meta:keyword><meta:keyword>staroffice</meta:keyword></meta:keywords></office:meta></office:document-meta>`;

function manifestXml(mediaType: string, extraEntries = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="http://openoffice.org/2001/manifest"><manifest:file-entry manifest:media-type="${mediaType}" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="styles.xml"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="meta.xml"/>${extraEntries}</manifest:manifest>`;
}

function ooo1Package(options: {
  mediaType: string;
  documentClass: string;
  content: string;
  styles: string;
  extraParts?: Package["parts"];
  extraManifestEntries?: string;
}): Package {
  const contentXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${XMLNS} office:version="1.0" office:class="${options.documentClass}">${options.content}</office:document-content>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${XMLNS} office:version="1.0">${options.styles}</office:document-styles>`;
  return {
    parts: {
      "META-INF/manifest.xml": {
        kind: "xml",
        nodes: parseXml(
          manifestXml(options.mediaType, options.extraManifestEntries),
        ),
      },
      "content.xml": { kind: "xml", nodes: parseXml(contentXml) },
      "styles.xml": { kind: "xml", nodes: parseXml(stylesXml) },
      "meta.xml": { kind: "xml", nodes: parseXml(META_XML) },
      ...options.extraParts,
    },
  };
}

// A page geometry every fixture below reuses, in OpenOffice.org 1.x's own style:page-master spelling and its "inch" unit.
const PAGE_MASTER = `<office:automatic-styles><style:page-master style:name="pm1"><style:properties fo:page-width="8.5inch" fo:page-height="11inch" fo:margin-left="1inch" fo:margin-right="1inch" fo:margin-top="1inch" fo:margin-bottom="1inch"/></style:page-master></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-master-name="pm1"/></office:master-styles>`;

function writerPackage(body: string, contentStyles = ""): Package {
  return ooo1Package({
    mediaType: "application/vnd.sun.xml.writer",
    documentClass: "text",
    content: `<office:automatic-styles>${contentStyles}</office:automatic-styles><office:body>${body}</office:body>`,
    styles: PAGE_MASTER,
  });
}

describe("readSxwContent", () => {
  it("reads a Writer document's paragraphs and headings out of the wrapper-free office:body", () => {
    const document = readSxwContent(
      writerPackage(
        `<text:h text:style-name="Heading 1" text:level="1">Chapter one</text:h><text:p text:style-name="Standard">A paragraph of legacy text.</text:p>`,
      ),
    );
    const [section] = document.sections;
    expect(section).toBeDefined();
    expect(section?.blocks).toHaveLength(2);
    const [heading, paragraph] = section?.blocks ?? [];
    expect(heading).toMatchObject({ kind: "paragraph", headingLevel: 1 });
    expect(paragraph).toMatchObject({ kind: "paragraph" });
    expect(
      heading?.kind === "paragraph" ? heading.runs[0]?.text : undefined,
    ).toBe("Chapter one");
    expect(
      paragraph?.kind === "paragraph" ? paragraph.runs[0]?.text : undefined,
    ).toBe("A paragraph of legacy text.");
  });

  it("reads the metadata, unwrapping the meta:keywords container ODF removed", () => {
    const document = readSxwContent(writerPackage(`<text:p>x</text:p>`));
    expect(document.metadata.title).toBe("Legacy report");
    expect(document.metadata.author).toBe("Ada Lovelace");
    expect(document.metadata.keywords).toEqual(["legacy", "staroffice"]);
  });

  it("resolves the page geometry from a style:page-master written in inches", () => {
    const document = readSxwContent(writerPackage(`<text:p>x</text:p>`));
    // 8.5in and 11in at 72pt to the inch, with 1in margins.
    expect(document.sections[0]?.pageSize).toEqual({
      widthPt: 612,
      heightPt: 792,
    });
    expect(document.sections[0]?.margins).toEqual({
      topPt: 72,
      rightPt: 72,
      bottomPt: 72,
      leftPt: 72,
    });
  });

  it("applies character formatting out of the single style:properties every style carries", () => {
    const document = readSxwContent(
      writerPackage(
        `<text:p text:style-name="P1">bold and underlined</text:p>`,
        `<style:style style:name="P1" style:family="paragraph"><style:properties fo:text-align="center" fo:font-weight="bold" style:text-underline="single" fo:font-size="14pt"/></style:style>`,
      ),
    );
    const paragraph = document.sections[0]?.blocks[0];
    expect(paragraph).toMatchObject({ kind: "paragraph", alignment: "center" });
    expect(
      paragraph?.kind === "paragraph" ? paragraph.runs[0] : undefined,
    ).toMatchObject({ bold: true, underline: true, sizePt: 14 });
  });

  it("reads both OpenOffice.org list elements as lists", () => {
    const document = readSxwContent(
      writerPackage(
        `<text:unordered-list text:style-name="L1"><text:list-item><text:p>bullet</text:p></text:list-item></text:unordered-list><text:ordered-list text:style-name="L2"><text:list-item><text:p>number</text:p></text:list-item></text:ordered-list>`,
      ),
    );
    const blocks = document.sections[0]?.blocks ?? [];
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.kind).toBe("paragraph");
      expect(block.kind === "paragraph" ? block.list : undefined).toBeDefined();
    }
  });

  it("reads a table, including a cell's paragraph text", () => {
    const document = readSxwContent(
      writerPackage(
        `<table:table table:name="T1" table:style-name="T1"><table:table-column table:style-name="T1.A"/><table:table-row><table:table-cell table:value-type="string"><text:p>cell text</text:p></table:table-cell></table:table-row></table:table>`,
      ),
    );
    const table = document.sections[0]?.blocks[0];
    expect(table?.kind).toBe("table");
    expect(
      table?.kind === "table"
        ? table.rows[0]?.cells[0]?.blocks[0]?.kind
        : undefined,
    ).toBe("paragraph");
  });

  it("reads a bare draw:image as an image block, resolving the package-fragment href", () => {
    // A 1x1 transparent PNG, so the image sniffer sees genuine bytes rather than a stub.
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const document = readSxwContent(
      ooo1Package({
        mediaType: "application/vnd.sun.xml.writer",
        documentClass: "text",
        content: `<office:body><text:p><draw:image draw:name="Graphic1" text:anchor-type="paragraph" svg:width="1.9992inch" svg:height="0.7228inch" draw:z-index="0" xlink:href="#Pictures/a.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></text:p></office:body>`,
        styles: PAGE_MASTER,
        extraParts: { "Pictures/a.png": { kind: "binary", base64: png } },
        extraManifestEntries: `<manifest:file-entry manifest:media-type="image/png" manifest:full-path="Pictures/a.png"/>`,
      }),
    );
    const blocks = document.sections[0]?.blocks ?? [];
    const image = blocks.find((block) => block.kind === "image");
    expect(image).toBeDefined();
    expect(image).toMatchObject({ kind: "image", format: "png" });
  });
});

describe("readSxw", () => {
  it("assembles the same document into a wordprocessing DocumentTree", () => {
    const tree = readSxw(
      writerPackage(`<text:p text:style-name="Standard">tree</text:p>`),
    );
    expect(tree.kind).toBe("wordprocessing");
    expect(tree.metadata.title).toBe("Legacy report");
    expect(tree.children.length).toBeGreaterThan(0);
  });
});

describe("readSxcContent", () => {
  const sheet = `<table:table table:name="Sheet1"><table:table-column table:style-name="co1" table:number-columns-repeated="2"/><table:table-row><table:table-cell table:value-type="string"><text:p>Item</text:p></table:table-cell><table:table-cell table:value-type="float" table:value="42"><text:p>42</text:p></table:table-cell></table:table-row></table:table>`;

  function calcPackage(): Package {
    return ooo1Package({
      mediaType: "application/vnd.sun.xml.calc",
      documentClass: "spreadsheet",
      content: `<office:automatic-styles><style:style style:name="co1" style:family="table-column"><style:properties style:column-width="0.889inch"/></style:style></office:automatic-styles><office:body>${sheet}</office:body>`,
      styles: PAGE_MASTER,
    });
  }

  it("reads a sheet's cells, with the value attributes ODF moved into the office namespace", () => {
    const document = readSxcContent(calcPackage());
    expect(document.sheets).toHaveLength(1);
    expect(document.sheets[0]?.name).toBe("Sheet1");
    const [first, second] = document.sheets[0]?.cells ?? [];
    expect(first).toMatchObject({
      row: 0,
      column: 0,
      value: { kind: "string", value: "Item" },
    });
    expect(second).toMatchObject({
      row: 0,
      column: 1,
      value: { kind: "number", value: 42 },
    });
  });

  it("assembles a spreadsheet DocumentTree", () => {
    expect(readSxc(calcPackage()).kind).toBe("spreadsheet");
  });
});

describe("readSxiContent", () => {
  function impressPackage(): Package {
    return ooo1Package({
      mediaType: "application/vnd.sun.xml.impress",
      documentClass: "presentation",
      content: `<office:automatic-styles><style:style style:name="dp1" style:family="drawing-page"><style:properties presentation:background-visible="true"/></style:style></office:automatic-styles><office:body><draw:page draw:name="page1" draw:style-name="dp1" draw:master-page-name="Default"><draw:text-box draw:name="Title" presentation:class="title" svg:x="1inch" svg:y="0.5inch" svg:width="6.5inch" svg:height="1inch"><text:p>Constructing triangles</text:p></draw:text-box></draw:page></office:body>`,
      styles: `<office:automatic-styles><style:page-master style:name="PM1"><style:properties fo:page-width="11inch" fo:page-height="8.5inch"/></style:page-master></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-master-name="PM1"/></office:master-styles>`,
    });
  }

  it("reads a slide and the text of its presentation text box", () => {
    const document = readSxiContent(impressPackage());
    expect(document.slides).toHaveLength(1);
    const title = document.slides[0]?.shapes.find(
      (shape) => shape.name === "Title",
    );
    const paragraph = title?.blocks.find((block) => block.kind === "paragraph");
    expect(
      paragraph?.kind === "paragraph" ? paragraph.runs[0]?.text : undefined,
    ).toBe("Constructing triangles");
  });

  it("assembles a presentation DocumentTree", () => {
    expect(readSxi(impressPackage()).kind).toBe("presentation");
  });
});

describe("readSxdContent", () => {
  function drawPackage(): Package {
    return ooo1Package({
      mediaType: "application/vnd.sun.xml.draw",
      documentClass: "drawing",
      // style:family="graphics" is OpenOffice.org 1.x's own spelling of the family ODF calls "graphic" -- the transform renames it, and a fixture written with ODF's singular spelling would be testing a document this format never produces.
      content: `<office:automatic-styles><style:style style:name="gr1" style:family="graphics"><style:properties draw:fill="solid" draw:fill-color="#ffcc00" draw:stroke="solid" svg:stroke-color="#000000"/></style:style></office:automatic-styles><office:body><draw:page draw:name="Slide 1" draw:master-page-name="Default"><draw:rect draw:style-name="gr1" svg:x="1inch" svg:y="1inch" svg:width="2inch" svg:height="1inch"/></draw:page></office:body>`,
      styles: `<office:automatic-styles><style:page-master style:name="PM1"><style:properties fo:page-width="11inch" fo:page-height="8.5inch"/></style:page-master></office:automatic-styles><office:master-styles><style:master-page style:name="Default" style:page-master-name="PM1"/></office:master-styles>`,
    });
  }

  it("reads a drawing page's vector shapes with the fill resolved from the graphic style", () => {
    const document = readSxdContent(drawPackage());
    expect(document.pages).toHaveLength(1);
    const rect = document.pages[0]?.vectors.find(
      (vector) => vector.kind === "rect",
    );
    expect(rect).toBeDefined();
    // #ffcc00, normalised to the 0..1 channel triple the schema's colour type uses.
    expect(rect?.kind === "rect" ? rect.fill : undefined).toEqual({
      r: 1,
      g: 0.8,
      b: 0,
    });
  });

  it("assembles a drawing DocumentTree", () => {
    expect(readSxd(drawPackage()).kind).toBe("drawing");
  });
});
