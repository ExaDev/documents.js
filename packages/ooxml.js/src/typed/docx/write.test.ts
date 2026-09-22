import { describe, expect, it } from "vitest";
import type {
  ConstructDescriptor,
  ContentBlock,
  ContentSection,
  ContentTable,
} from "document-schema.js";
import {
  findConstructMarkerImbalance,
  rgbHexToColor,
} from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { decodePackage, encodePackage } from "../../codec";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import { ptToEmu } from "../shared/units";
import type { DocxDocument } from "./read";
import { readDocxContent } from "./read";
import { buildDocxPackageFromContent } from "./write";

// The round trip these tests actually assert: a docx read into sections, written back out through buildDocxPackageFromContent, and read again must produce the identical sections. Every fixture below is a real word/document.xml body, so the assertion is over the whole pair rather than over the writer's XML in isolation — what the writer emits only matters inasmuch as readDocxContent reads the same model back out of it.

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const HYPERLINK_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const PICTURE_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";

function docxPackage(
  bodyChildren: XmlNode[],
  extraParts: Package["parts"] = {},
): Package {
  const body = el("w:body", {}, [
    ...bodyChildren,
    el("w:sectPr", {}, [
      el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
      el("w:pgMar", {
        "w:top": "1440",
        "w:right": "1440",
        "w:bottom": "1440",
        "w:left": "1440",
      }),
    ]),
  ]);
  return {
    parts: {
      "word/document.xml": {
        kind: "xml",
        nodes: [el("w:document", {}, [body])],
      },
      ...extraParts,
    },
  };
}

function para(text: string, ...extra: XmlNode[]): XmlNode {
  return el("w:p", {}, [...extra, el("w:r", {}, [el("w:t", {}, [txt(text)])])]);
}

// Read, write, read: the second read's sections are what every assertion compares against the first's.
function roundTrip(source: Package): {
  before: ContentSection[];
  after: ContentSection[];
  written: Package;
} {
  const before = readDocxContent(source);
  const written = buildDocxPackageFromContent(before);
  return {
    before: before.sections,
    after: readDocxContent(written).sections,
    written,
  };
}

function expectStableRoundTrip(source: Package): ContentSection[] {
  const { before, after } = roundTrip(source);
  expect(after).toEqual(before);
  return after;
}

// The extras round trip: unlike `roundTrip` above, this carries the WHOLE DocxDocument — comments, footnotes, endnotes, header/footer parts, and numbering, not only sections — through buildDocxPackageFromContent, since DocxContent's own optional fields are a superset of what `roundTrip` exercises.
function fullRoundTrip(source: Package): {
  before: DocxDocument;
  after: DocxDocument;
  written: Package;
} {
  const before = readDocxContent(source);
  const written = buildDocxPackageFromContent(before);
  return { before, after: readDocxContent(written), written };
}

// The written order of a paragraph's run-and-bookmark children, described by bookmark NAME rather than the id the writer mints: an order assertion over the writer's own XML, which the round-trip assertions cannot express (readDocxContent pairs halves by id at run positions, so it reads an inverted pair back as the same extent it wrote from).
function writtenBookmarkOrder(
  paragraphElement: XmlNode | undefined,
): string[] | undefined {
  if (paragraphElement?.type !== "element") {
    return undefined;
  }
  const nameById = new Map<string, string>();
  for (const child of paragraphElement.children) {
    if (child.type === "element" && child.tag === "w:bookmarkStart") {
      const id = child.attributes.find(
        (attribute) => attribute.name === "w:id",
      )?.value;
      const name = child.attributes.find(
        (attribute) => attribute.name === "w:name",
      )?.value;
      if (id !== undefined && name !== undefined) {
        nameById.set(id, name);
      }
    }
  }
  const described: string[] = [];
  for (const child of paragraphElement.children) {
    if (
      child.type !== "element" ||
      (child.tag !== "w:r" &&
        child.tag !== "w:bookmarkStart" &&
        child.tag !== "w:bookmarkEnd")
    ) {
      continue;
    }
    if (child.tag === "w:r") {
      described.push("run");
      continue;
    }
    const id =
      child.attributes.find((attribute) => attribute.name === "w:id")?.value ??
      "";
    described.push(
      `${child.tag === "w:bookmarkStart" ? "start" : "end"}(${nameById.get(id) ?? id})`,
    );
  }
  return described;
}

describe("buildDocxPackageFromContent: package scaffolding", () => {
  it("writes a package that re-zips and decodes back to the same parts", () => {
    const pkg = buildDocxPackageFromContent(
      readDocxContent(docxPackage([para("hello")])),
    );
    const reDecoded = decodePackage(encodePackage(pkg));
    expect(Object.keys(reDecoded.parts).sort()).toEqual(
      Object.keys(pkg.parts).sort(),
    );
    expect(readDocxContent(reDecoded).sections).toEqual(
      readDocxContent(pkg).sections,
    );
  });

  it("declares every part it writes in [Content_Types].xml, including the media default for an embedded image", () => {
    const drawing = el("w:drawing", {}, [
      el("wp:inline", {}, [
        el("wp:extent", { cx: "914400", cy: "457200" }),
        el("wp:docPr", { id: "1", name: "Picture 1" }),
        el("a:graphic", {}, [
          el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
            el("pic:pic", {}, [
              el("pic:blipFill", {}, [el("a:blip", { "r:embed": "rIdImg" })]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const source = docxPackage([el("w:p", {}, [el("w:r", {}, [drawing])])], {
      "word/_rels/document.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            el("Relationship", {
              Id: "rIdImg",
              Type: IMAGE_REL,
              Target: "media/image1.png",
            }),
          ]),
        ],
      },
      "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
    });
    const written = buildDocxPackageFromContent(readDocxContent(source));
    expect(written.parts["word/media/image1.png"]).toEqual({
      kind: "binary",
      base64: TINY_PNG_BASE64,
    });
    const types = rootElement(written.parts["[Content_Types].xml"]);
    const declared = elementsWithTag(
      types === undefined ? [] : [types],
      "Default",
    ).map(
      (element) =>
        element.attributes.find((a) => a.name === "Extension")?.value,
    );
    expect(declared).toContain("png");
  });

  it("writes core and extended properties that read back as the same metadata", () => {
    const core = el("cp:coreProperties", {}, [
      el("dc:title", {}, [txt("Round trip")]),
      el("dc:creator", {}, [txt("Ada Lovelace")]),
      el("dc:subject", {}, [txt("fidelity")]),
      el("cp:keywords", {}, [txt("one, two")]),
      el("dcterms:created", {}, [txt("2026-08-18T09:00:00Z")]),
    ]);
    const app = el("Properties", {}, [
      el("Application", {}, [txt("ooxml.js")]),
    ]);
    const source = docxPackage([para("body")], {
      "docProps/core.xml": { kind: "xml", nodes: [core] },
      "docProps/app.xml": { kind: "xml", nodes: [app] },
    });
    const before = readDocxContent(source);
    expect(
      readDocxContent(buildDocxPackageFromContent(before)).metadata,
    ).toEqual(before.metadata);
  });

  it("writes an empty document for a content value carrying no sections at all", () => {
    const sections = readDocxContent(
      buildDocxPackageFromContent({ sections: [] }),
    ).sections;
    expect(sections).toHaveLength(1);
    expect(sections[0]?.blocks).toEqual([]);
  });

  it("refuses a block list whose construct markers do not balance rather than writing a document that cannot be read back", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: {
          kind: "anchor",
          anchorType: "bookmark",
          name: "unclosed",
        },
      },
      { kind: "paragraph", runs: [{ text: "x" }] },
    ];
    expect(() =>
      buildDocxPackageFromContent({
        sections: [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks,
          },
        ],
      }),
    ).toThrow(/unclosedStart/);
  });
});

// A minimal one-paragraph section, for the package-scaffolding tests below that only care about the parts every document carries regardless of content.
function emptyBodySection(): ContentSection {
  return {
    pageSize: { widthPt: 612, heightPt: 792 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: [],
  };
}

const DRAWINGML_MAIN_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/main";

describe("buildDocxPackageFromContent: buildDrawing's fixed XML shape", () => {
  it("writes the zero offset, rect preset, distT/B/L/R zeros, and docPr id/name exactly, with alt text as descr", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 100,
              heightPt: 50,
              altText: "a caption",
            },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const drawing = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:drawing",
    )[0];
    if (drawing === undefined) {
      throw new Error("expected a w:drawing element");
    }
    const inline = childrenWithTag(drawing, "wp:inline")[0];
    if (inline === undefined) {
      throw new Error("expected a wp:inline element");
    }
    expect(attr(inline, "distT")).toBe("0");
    expect(attr(inline, "distB")).toBe("0");
    expect(attr(inline, "distL")).toBe("0");
    expect(attr(inline, "distR")).toBe("0");

    const cx = String(ptToEmu(100));
    const cy = String(ptToEmu(50));
    const extent = childrenWithTag(inline, "wp:extent")[0];
    expect(extent === undefined ? undefined : attr(extent, "cx")).toBe(cx);
    expect(extent === undefined ? undefined : attr(extent, "cy")).toBe(cy);

    const docPr = childrenWithTag(inline, "wp:docPr")[0];
    expect(docPr === undefined ? undefined : attr(docPr, "id")).toBe("1");
    expect(docPr === undefined ? undefined : attr(docPr, "name")).toBe(
      "Picture 1",
    );
    expect(docPr === undefined ? undefined : attr(docPr, "descr")).toBe(
      "a caption",
    );

    const graphic = childrenWithTag(inline, "a:graphic")[0];
    expect(graphic === undefined ? undefined : attr(graphic, "xmlns:a")).toBe(
      DRAWINGML_MAIN_NS,
    );
    const graphicData =
      graphic === undefined
        ? undefined
        : childrenWithTag(graphic, "a:graphicData")[0];
    expect(
      graphicData === undefined ? undefined : attr(graphicData, "uri"),
    ).toBe(PICTURE_GRAPHIC_URI);

    const pic =
      graphicData === undefined
        ? undefined
        : childrenWithTag(graphicData, "pic:pic")[0];
    expect(pic === undefined ? undefined : attr(pic, "xmlns:pic")).toBe(
      PICTURE_GRAPHIC_URI,
    );

    const nvPicPr =
      pic === undefined ? undefined : childrenWithTag(pic, "pic:nvPicPr")[0];
    const cNvPr =
      nvPicPr === undefined
        ? undefined
        : childrenWithTag(nvPicPr, "pic:cNvPr")[0];
    expect(cNvPr === undefined ? undefined : attr(cNvPr, "id")).toBe("1");
    expect(cNvPr === undefined ? undefined : attr(cNvPr, "name")).toBe(
      "Picture 1",
    );
    const cNvPicPr =
      nvPicPr === undefined
        ? undefined
        : childrenWithTag(nvPicPr, "pic:cNvPicPr")[0];
    expect(cNvPicPr?.children).toEqual([]);

    const blipFill =
      pic === undefined ? undefined : childrenWithTag(pic, "pic:blipFill")[0];
    const blip =
      blipFill === undefined
        ? undefined
        : childrenWithTag(blipFill, "a:blip")[0];
    expect(blip === undefined ? undefined : attr(blip, "r:embed")).toBe("rId1");
    const stretch =
      blipFill === undefined
        ? undefined
        : childrenWithTag(blipFill, "a:stretch")[0];
    expect(
      stretch === undefined
        ? undefined
        : childrenWithTag(stretch, "a:fillRect")[0],
    ).toBeDefined();

    const spPr =
      pic === undefined ? undefined : childrenWithTag(pic, "pic:spPr")[0];
    const xfrm =
      spPr === undefined ? undefined : childrenWithTag(spPr, "a:xfrm")[0];
    const off =
      xfrm === undefined ? undefined : childrenWithTag(xfrm, "a:off")[0];
    expect(off === undefined ? undefined : attr(off, "x")).toBe("0");
    expect(off === undefined ? undefined : attr(off, "y")).toBe("0");
    const ext =
      xfrm === undefined ? undefined : childrenWithTag(xfrm, "a:ext")[0];
    expect(ext === undefined ? undefined : attr(ext, "cx")).toBe(cx);
    expect(ext === undefined ? undefined : attr(ext, "cy")).toBe(cy);
    const prstGeom =
      spPr === undefined ? undefined : childrenWithTag(spPr, "a:prstGeom")[0];
    expect(prstGeom === undefined ? undefined : attr(prstGeom, "prst")).toBe(
      "rect",
    );
    expect(
      prstGeom === undefined
        ? undefined
        : childrenWithTag(prstGeom, "a:avLst")[0],
    ).toBeDefined();
  });

  it("omits wp:docPr's descr attribute for an image with no alt text, and increments the drawing id for a second image", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 10,
              heightPt: 10,
            },
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 10,
              heightPt: 10,
            },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const drawings = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:drawing",
    );
    expect(drawings).toHaveLength(2);
    const docPrs = drawings.map((drawing) => {
      const inline = childrenWithTag(drawing, "wp:inline")[0];
      return inline === undefined
        ? undefined
        : childrenWithTag(inline, "wp:docPr")[0];
    });
    expect(docPrs[0] === undefined ? undefined : attr(docPrs[0], "id")).toBe(
      "1",
    );
    expect(
      docPrs[0] === undefined ? undefined : attr(docPrs[0], "descr"),
    ).toBeUndefined();
    expect(docPrs[1] === undefined ? undefined : attr(docPrs[1], "id")).toBe(
      "2",
    );
    expect(docPrs[1] === undefined ? undefined : attr(docPrs[1], "name")).toBe(
      "Picture 2",
    );
  });
});

describe("buildDocxPackageFromContent: fixed package-scaffolding parts", () => {
  it("writes _rels/.rels with exactly the three fixed package relationships, in order", () => {
    const written = buildDocxPackageFromContent({
      sections: [emptyBodySection()],
    });
    const root = rootElement(written.parts["_rels/.rels"]);
    expect(root?.tag).toBe("Relationships");
    expect(root === undefined ? undefined : attr(root, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/relationships",
    );
    const rels =
      root === undefined ? [] : childrenWithTag(root, "Relationship");
    expect(
      rels.map((rel) => ({
        Id: attr(rel, "Id"),
        Type: attr(rel, "Type"),
        Target: attr(rel, "Target"),
      })),
    ).toEqual([
      {
        Id: "rId1",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        Target: "word/document.xml",
      },
      {
        Id: "rId2",
        Type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties",
        Target: "docProps/core.xml",
      },
      {
        Id: "rId3",
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties",
        Target: "docProps/app.xml",
      },
    ]);
  });

  it("writes [Content_Types].xml's fixed rels/xml Default entries and document/core/app Overrides", () => {
    const written = buildDocxPackageFromContent({
      sections: [emptyBodySection()],
    });
    const root = rootElement(written.parts["[Content_Types].xml"]);
    expect(root?.tag).toBe("Types");
    expect(root === undefined ? undefined : attr(root, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/content-types",
    );
    const defaults = root === undefined ? [] : childrenWithTag(root, "Default");
    expect(
      defaults.map((entry) => ({
        Extension: attr(entry, "Extension"),
        ContentType: attr(entry, "ContentType"),
      })),
    ).toEqual([
      {
        Extension: "rels",
        ContentType: "application/vnd.openxmlformats-package.relationships+xml",
      },
      { Extension: "xml", ContentType: "application/xml" },
    ]);

    const overrides =
      root === undefined ? [] : childrenWithTag(root, "Override");
    const overrideFor = (partName: string): string | undefined => {
      const found = overrides.find(
        (entry) => attr(entry, "PartName") === partName,
      );
      return found === undefined ? undefined : attr(found, "ContentType");
    };
    expect(overrideFor("/word/document.xml")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
    );
    expect(overrideFor("/docProps/core.xml")).toBe(
      "application/vnd.openxmlformats-package.core-properties+xml",
    );
    expect(overrideFor("/docProps/app.xml")).toBe(
      "application/vnd.openxmlformats-officedocument.extended-properties+xml",
    );
    expect(overrideFor("/word/styles.xml")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
    );
  });

  it("declares a Default entry for every media format actually used, jpeg and gif included, never one that was not", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "image",
              format: "jpeg",
              base64: "AAAA",
              widthPt: 10,
              heightPt: 10,
            },
            {
              kind: "image",
              format: "gif",
              base64: "BBBB",
              widthPt: 10,
              heightPt: 10,
            },
          ],
        },
      ],
    });
    const root = rootElement(written.parts["[Content_Types].xml"]);
    const defaultFor = (extension: string): string | undefined => {
      const found = (
        root === undefined ? [] : childrenWithTag(root, "Default")
      ).find((entry) => attr(entry, "Extension") === extension);
      return found === undefined ? undefined : attr(found, "ContentType");
    };
    expect(defaultFor("jpeg")).toBe("image/jpeg");
    expect(defaultFor("gif")).toBe("image/gif");
    expect(defaultFor("png")).toBeUndefined();
  });

  it("writes word/_rels/document.xml.rels with the Relationships root tag and namespace", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "link", hyperlink: "https://example.com" }],
            },
          ],
        },
      ],
    });
    const root = rootElement(written.parts["word/_rels/document.xml.rels"]);
    expect(root?.tag).toBe("Relationships");
    expect(root === undefined ? undefined : attr(root, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/package/2006/relationships",
    );
  });

  it("writes docProps/core.xml and docProps/app.xml's exact XML, including an empty keywords list and a modifiedIso date", () => {
    const written = buildDocxPackageFromContent({
      sections: [emptyBodySection()],
      metadata: {
        title: "T",
        author: "A",
        subject: "S",
        keywords: [],
        createdIso: "2026-01-01T00:00:00Z",
        modifiedIso: "2026-02-02T00:00:00Z",
        creator: "ooxml.js",
      },
    });
    const core = rootElement(written.parts["docProps/core.xml"]);
    expect(core?.tag).toBe("cp:coreProperties");
    expect(core === undefined ? undefined : attr(core, "xmlns:cp")).toBe(
      "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    );
    // An empty keywords array is not undefined, but the writer's own length>0 guard means a present-but-empty list is treated the same as an absent one: no cp:keywords element at all, not an empty one.
    expect(childrenWithTag(core!, "cp:keywords")).toHaveLength(0);
    expect(childrenWithTag(core!, "dcterms:modified")[0]).toEqual(
      el("dcterms:modified", { "xsi:type": "dcterms:W3CDTF" }, [
        txt("2026-02-02T00:00:00Z"),
      ]),
    );
    const app = rootElement(written.parts["docProps/app.xml"]);
    expect(app?.tag).toBe("Properties");
    expect(app === undefined ? undefined : attr(app, "xmlns")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties",
    );
    expect(childrenWithTag(app!, "Application")[0]).toEqual(
      el("Application", {}, [txt("ooxml.js")]),
    );
  });

  it("writes styles.xml's fixed docDefaults and Normal/DefaultParagraphFont scaffolding for a document with no named styles", () => {
    const written = buildDocxPackageFromContent({
      sections: [emptyBodySection()],
    });
    const root = rootElement(written.parts["word/styles.xml"]);
    const docDefaults =
      root === undefined
        ? undefined
        : childrenWithTag(root, "w:docDefaults")[0];
    expect(
      docDefaults === undefined
        ? undefined
        : childrenWithTag(docDefaults, "w:rPrDefault")[0]?.children,
    ).toEqual([]);
    expect(
      docDefaults === undefined
        ? undefined
        : childrenWithTag(docDefaults, "w:pPrDefault")[0]?.children,
    ).toEqual([]);

    const styles = root === undefined ? [] : childrenWithTag(root, "w:style");
    expect(
      styles.map((style) => {
        const name = childrenWithTag(style, "w:name")[0];
        return {
          type: attr(style, "w:type"),
          default: attr(style, "w:default"),
          styleId: attr(style, "w:styleId"),
          name: name === undefined ? undefined : attr(name, "w:val"),
        };
      }),
    ).toEqual([
      {
        type: "paragraph",
        default: "1",
        styleId: "Normal",
        name: "Normal",
      },
      {
        type: "character",
        default: "1",
        styleId: "DefaultParagraphFont",
        name: "Default Paragraph Font",
      },
    ]);
  });
});

describe("buildDocxPackageFromContent: content round trip", () => {
  it("round-trips paragraph properties, run formatting, headings, lists, and page breaks", () => {
    const styled = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:pStyle", { "w:val": "Heading2" }),
        el("w:numPr", {}, [
          el("w:ilvl", { "w:val": "2" }),
          el("w:numId", { "w:val": "7" }),
        ]),
        el("w:spacing", {
          "w:before": "240",
          "w:after": "120",
          "w:line": "360",
          "w:lineRule": "auto",
        }),
        el("w:ind", { "w:left": "720", "w:hanging": "360" }),
        el("w:jc", { "w:val": "both" }),
        el("w:outlineLvl", { "w:val": "1" }),
      ]),
      el("w:r", {}, [
        el("w:rPr", {}, [
          el("w:b"),
          el("w:i"),
          el("w:u", { "w:val": "single" }),
          el("w:strike"),
          el("w:rFonts", { "w:ascii": "Georgia" }),
          el("w:sz", { "w:val": "28" }),
          el("w:color", { "w:val": "ff0000" }),
        ]),
        el("w:t", {}, [txt("styled")]),
      ]),
      el("w:r", {}, [
        el("w:t", {}, [txt("a")]),
        el("w:tab"),
        el("w:t", {}, [txt("b")]),
        el("w:br"),
        el("w:t", {}, [txt("c")]),
      ]),
    ]);
    const pageBreak = el("w:p", {}, [
      el("w:pPr", {}, [el("w:pageBreakBefore")]),
      el("w:r", {}, [el("w:t", {}, [txt("next page")])]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([styled, pageBreak]));
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "pageBreak",
      "paragraph",
    ]);
  });

  // A heading with a page break before it and Word's own _Toc bookmark around it — one of the commonest shapes in a real document with a table of contents. collectParagraph pushes the pageBreak block before the paragraph it belongs to, so a construct whose extent starts at that same paragraph opens one block later: the page break and the construct are siblings in the flat list, not nested. The page break must still land immediately before the paragraph that carries it, not at the end of the section with a spurious empty paragraph appended.
  it("keeps a page break immediately before the paragraph that opens a construct there, instead of moving it to the end of the flow", () => {
    const source = docxPackage([
      para("before"),
      el("w:p", {}, [
        el("w:pPr", {}, [el("w:pageBreakBefore")]),
        el("w:bookmarkStart", { "w:id": "3", "w:name": "_Toc9" }),
        el("w:r", {}, [el("w:t", {}, [txt("Chapter 1")])]),
        el("w:bookmarkEnd", { "w:id": "3" }),
      ]),
    ]);
    const before = readDocxContent(source);
    expect(before.sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "pageBreak",
      "constructStart",
      "paragraph",
      "constructEnd",
    ]);
    const after =
      readDocxContent(buildDocxPackageFromContent(before)).sections[0]
        ?.blocks ?? [];
    expect(findConstructMarkerImbalance(after)).toBeUndefined();
    const paragraphs = after.flatMap((block) =>
      block.kind === "paragraph" ? [block] : [],
    );
    // No spurious paragraph gained on the way out, and "Chapter 1" is not displaced to the end of the flow.
    expect(
      paragraphs.map((paragraph) =>
        paragraph.runs.map((run) => run.text).join(""),
      ),
    ).toEqual(["before", "Chapter 1"]);
    const kinds = after.map((block) => block.kind);
    expect(kinds.filter((kind) => kind === "pageBreak")).toHaveLength(1);
    expect(kinds.indexOf("pageBreak")).toBeLessThan(
      kinds.lastIndexOf("paragraph"),
    );
  });

  // A ContentDocument from another codec (markdown-codec, odf.js, pdf-codec) can hand this writer a page break directly followed by a table, a shape readDocxContent itself never produces but buildDocxPackageFromContent still has to honour: WordprocessingML has no page-break element for a table to carry, so the break becomes its own empty paragraph immediately before the table, not displaced after it.
  it("keeps a page break immediately before a table rather than displacing it after the table", () => {
    const blocks: ContentBlock[] = [
      { kind: "paragraph", runs: [{ text: "before" }] },
      { kind: "pageBreak" },
      {
        kind: "table",
        columns: [{ widthPt: 72 }],
        rows: [
          {
            cells: [
              { blocks: [{ kind: "paragraph", runs: [{ text: "cell" }] }] },
            ],
          },
        ],
      },
    ];
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks,
        },
      ],
    });
    const after = readDocxContent(written).sections[0]?.blocks ?? [];
    const kinds = after.map((block) => block.kind);
    expect(kinds.indexOf("pageBreak")).toBeGreaterThan(-1);
    expect(kinds.indexOf("pageBreak")).toBeLessThan(kinds.indexOf("table"));
  });

  // The source relationship spells its query separator as the XML entity '&amp;'; the projection decodes it, and the writer re-encodes it once — the whole point of the pair being that a target survives the trip spelled the same way, not doubly encoded.
  it("round-trips an external hyperlink through a freshly minted relationship, sharing one relationship per target", () => {
    const link = (text: string): XmlNode =>
      el("w:p", {}, [
        el("w:hyperlink", { "r:id": "rIdHlink" }, [
          el("w:r", {}, [el("w:t", {}, [txt(text)])]),
        ]),
      ]);
    const source = docxPackage([link("first"), link("second")], {
      "word/_rels/document.xml.rels": {
        kind: "xml",
        nodes: [
          el("Relationships", {}, [
            el("Relationship", {
              Id: "rIdHlink",
              Type: HYPERLINK_REL,
              Target: "https://example.com/a?x=1&amp;y=2",
              TargetMode: "External",
            }),
          ]),
        ],
      },
    });
    const { after, written } = roundTrip(source);
    const paragraph = after[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph"
        ? paragraph.runs[0]?.hyperlink
        : undefined,
    ).toBe("https://example.com/a?x=1&y=2");
    // Filtered to the hyperlink relationship specifically — document.xml.rels also always carries a styles.xml relationship now (buildStylesPart is unconditional), which this test's own "one relationship per target" claim was never about.
    const rels = rootElement(written.parts["word/_rels/document.xml.rels"]);
    const hyperlinkRels = elementsWithTag(
      rels === undefined ? [] : [rels],
      "Relationship",
    ).filter((rel) => attr(rel, "Type") === HYPERLINK_REL);
    expect(hyperlinkRels).toHaveLength(1);
  });

  it("round-trips a table's grid, spans, shading, borders, and row heights", () => {
    const borders = el("w:tcBorders", {}, [
      el("w:top", { "w:val": "single", "w:sz": "8", "w:color": "00ff00" }),
      el("w:bottom", { "w:val": "dashed", "w:color": "auto" }),
    ]);
    const spanned = el("w:tc", {}, [
      el("w:tcPr", {}, [
        el("w:gridSpan", { "w:val": "2" }),
        el("w:shd", { "w:fill": "ff0000" }),
        borders,
      ]),
      para("merged"),
    ]);
    const anchor = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
      para("top"),
    ]);
    const continuation = el("w:tc", {}, [
      el("w:tcPr", {}, [el("w:vMerge")]),
      el("w:p"),
    ]);
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "2880" }),
        el("w:gridCol", { "w:w": "1440" }),
      ]),
      el("w:tr", {}, [
        el("w:trPr", {}, [el("w:trHeight", { "w:val": "560" })]),
        spanned,
      ]),
      el("w:tr", {}, [anchor, el("w:tc", {}, [para("right one")])]),
      el("w:tr", {}, [continuation, el("w:tc", {}, [para("right two")])]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([table]));
    const written = sections[0]?.blocks[0];
    if (written?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(written.rows[1]?.cells[0]?.rowSpan).toBe(2);
    expect(written.rows[0]?.cells[0]?.colSpan).toBe(2);
  });

  describe("a table breaking the grid rule", () => {
    const paragraphOf = (text: string): ContentBlock => ({
      kind: "paragraph",
      runs: [{ text }],
    });
    // A merged header whose covered position carries a second copy of the anchor's content, which a w:tc with a gridSpan has no cell to hold.
    const coveredContentTable: ContentTable = {
      kind: "table",
      columns: [{ widthPt: 100 }, { widthPt: 100 }],
      rows: [
        {
          cells: [
            { blocks: [paragraphOf("anchor")], colSpan: 2 },
            { blocks: [paragraphOf("copy")] },
          ],
        },
      ],
    };

    function buildWith(table: ContentTable): unknown {
      return buildDocxPackageFromContent({
        sections: [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [table],
          },
        ],
      });
    }

    it("refuses a table whose covered position carries content, naming the entry point and the fault", () => {
      expect(() => buildWith(coveredContentTable)).toThrow(
        "buildDocxPackageFromContent: table breaks the grid rule (the cell at row 0, column 1 lies inside the merged region anchored at row 0, column 0 but carries content of its own, and a merged region's content belongs to its anchor)",
      );
    });

    it("refuses a table whose rows differ in length", () => {
      expect(() =>
        buildWith({
          kind: "table",
          columns: [{ widthPt: 100 }, { widthPt: 100 }],
          rows: [
            { cells: [{ blocks: [paragraphOf("a")] }, { blocks: [] }] },
            { cells: [{ blocks: [paragraphOf("b")] }] },
          ],
        }),
      ).toThrow(
        /^buildDocxPackageFromContent: table breaks the grid rule \(row 1 holds 1 cells/,
      );
    });

    it("refuses a table nested inside a cell", () => {
      expect(() =>
        buildWith({
          kind: "table",
          columns: [{ widthPt: 100 }],
          rows: [{ cells: [{ blocks: [coveredContentTable] }] }],
        }),
      ).toThrow(/^buildDocxPackageFromContent: table breaks the grid rule/);
    });
  });

  it("writes a table's exact tblPr, tblGrid, gridSpan, vMerge, and trHeight XML, not just a round-trippable one", () => {
    // A round trip through readTable can mask a writer defect the reader happens to tolerate (a wrong tag name it still recognises, a swapped constant it still parses back the same way), so this asserts the actual written XML shape directly rather than only the read-back content.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "table" as const,
              columns: [{ widthPt: 100 }, { widthPt: 50 }],
              rows: [
                {
                  heightPt: 30,
                  cells: [
                    {
                      blocks: [
                        { kind: "paragraph" as const, runs: [{ text: "top" }] },
                      ],
                      colSpan: 2,
                    },
                    { blocks: [] },
                  ],
                },
                {
                  cells: [
                    {
                      blocks: [
                        {
                          kind: "paragraph" as const,
                          runs: [{ text: "left" }],
                        },
                      ],
                      rowSpan: 2,
                    },
                    {
                      blocks: [
                        {
                          kind: "paragraph" as const,
                          runs: [{ text: "right1" }],
                        },
                      ],
                    },
                  ],
                },
                {
                  cells: [
                    { blocks: [] },
                    {
                      blocks: [
                        {
                          kind: "paragraph" as const,
                          runs: [{ text: "right2" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const table = elementsWithTag(
      document === undefined ? [] : [document],
      "w:tbl",
    )[0];
    if (table === undefined) {
      throw new Error("expected a w:tbl element");
    }
    expect(table.children[0]).toEqual(
      el("w:tblPr", {}, [el("w:tblW", { "w:w": "0", "w:type": "auto" })]),
    );
    expect(table.children[1]).toEqual(
      el("w:tblGrid", {}, [
        el("w:gridCol", { "w:w": "2000" }),
        el("w:gridCol", { "w:w": "1000" }),
      ]),
    );
    const rows = childrenWithTag(table, "w:tr");
    expect(rows).toHaveLength(3);
    expect(childrenWithTag(rows[0]!, "w:trPr")[0]).toEqual(
      el("w:trPr", {}, [el("w:trHeight", { "w:val": "600" })]),
    );
    const row0Cells = childrenWithTag(rows[0]!, "w:tc");
    expect(row0Cells).toHaveLength(1);
    expect(childrenWithTag(row0Cells[0]!, "w:tcPr")[0]).toEqual(
      el("w:tcPr", {}, [el("w:gridSpan", { "w:val": "2" })]),
    );
    const row1Cells = childrenWithTag(rows[1]!, "w:tc");
    expect(row1Cells).toHaveLength(2);
    expect(childrenWithTag(row1Cells[0]!, "w:tcPr")[0]).toEqual(
      el("w:tcPr", {}, [el("w:vMerge", { "w:val": "restart" })]),
    );
    expect(childrenWithTag(row1Cells[1]!, "w:tcPr")).toHaveLength(0);
    const row2Cells = childrenWithTag(rows[2]!, "w:tc");
    expect(row2Cells).toHaveLength(2);
    expect(childrenWithTag(row2Cells[0]!, "w:tcPr")[0]).toEqual(
      el("w:tcPr", {}, [el("w:vMerge", {})]),
    );
    // The vMerge continuation cell carries no blocks of its own, but ECMA-376 still requires a trailing block-level element, so it still gets the empty paragraph every genuinely empty cell gets.
    expect(row2Cells[0]!.children.filter((c) => c.type === "element")).toEqual([
      el("w:tcPr", {}, [el("w:vMerge", {})]),
      el("w:p"),
    ]);
  });

  it("round-trips a genuine two-colour pattern fill instead of dropping it (ExaDev/documents.js#951)", () => {
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "2880" })]),
      el("w:tr", {}, [
        el("w:tc", {}, [
          el("w:tcPr", {}, [
            el("w:shd", {
              "w:val": "pct20",
              "w:color": "000000",
              "w:fill": "ffffff",
            }),
          ]),
          para("percentage grey"),
        ]),
      ]),
      el("w:tr", {}, [
        el("w:tc", {}, [
          el("w:tcPr", {}, [
            el("w:shd", { "w:val": "diagCross", "w:color": "ff0000" }),
          ]),
          para("crosshatch"),
        ]),
      ]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([table]));
    const written = sections[0]?.blocks[0];
    if (written?.kind !== "table") {
      throw new Error("expected a table block");
    }
    expect(written.rows[0]?.cells[0]?.background).toEqual({
      kind: "pattern",
      patternType: "percent20",
      foregroundColor: { r: 0, g: 0, b: 0 },
      backgroundColor: { r: 1, g: 1, b: 1 },
    });
    expect(written.rows[1]?.cells[0]?.background).toEqual({
      kind: "pattern",
      patternType: "diagonalCross",
      foregroundColor: { r: 1, g: 0, b: 0 },
    });
  });

  it("round-trips an image back into the run it was lifted out of, rather than adding a paragraph for it", () => {
    const drawing = (rId: string, alt: string): XmlNode =>
      el("w:drawing", {}, [
        el("wp:inline", {}, [
          el("wp:extent", { cx: "914400", cy: "457200" }),
          el("wp:docPr", { id: "1", name: "Picture 1", descr: alt }),
          el("a:graphic", {}, [
            el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
              el("pic:pic", {}, [
                el("pic:blipFill", {}, [el("a:blip", { "r:embed": rId })]),
              ]),
            ]),
          ]),
        ]),
      ]);
    const source = docxPackage(
      [
        el("w:p", {}, [el("w:r", {}, [drawing("rIdImg", "alone")])]),
        el("w:p", {}, [
          el("w:r", {}, [el("w:t", {}, [txt("caption")])]),
          el("w:r", {}, [drawing("rIdImg", "after text")]),
        ]),
      ],
      {
        "word/_rels/document.xml.rels": {
          kind: "xml",
          nodes: [
            el("Relationships", {}, [
              el("Relationship", {
                Id: "rIdImg",
                Type: IMAGE_REL,
                Target: "media/image1.png",
              }),
            ]),
          ],
        },
        "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
      },
    );
    const sections = expectStableRoundTrip(source);
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "paragraph",
      "image",
      "paragraph",
      "image",
    ]);
  });

  it("round-trips several sections, keeping each break on the paragraph that carries it", () => {
    const firstBreak = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:sectPr", {}, [
          el("w:pgSz", { "w:w": "11906", "w:h": "16838" }),
          el("w:pgMar", {
            "w:top": "720",
            "w:right": "720",
            "w:bottom": "720",
            "w:left": "720",
          }),
        ]),
      ]),
    ]);
    const sections = expectStableRoundTrip(
      docxPackage([para("first"), firstBreak, para("second")]),
    );
    expect(sections).toHaveLength(2);
    expect(sections[0]?.pageSize.widthPt).toBeCloseTo(595.3, 1);
  });

  it("round-trips a section break kind, re-emitting w:sectPr/w:type for a section that spells one and none for a section that does not", () => {
    const continuousBreak = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:sectPr", {}, [
          el("w:type", { "w:val": "continuous" }),
          el("w:pgSz", { "w:w": "11906", "w:h": "16838" }),
          el("w:pgMar", {
            "w:top": "720",
            "w:right": "720",
            "w:bottom": "720",
            "w:left": "720",
          }),
        ]),
      ]),
    ]);
    const sections = expectStableRoundTrip(
      docxPackage([para("first"), continuousBreak, para("second")]),
    );
    expect(sections[0]?.breakType).toBe("continuous");
    expect(sections[1]?.breakType).toBeUndefined();
  });

  // A bookmark closing exactly where a section ends: the section's own flow ends in a childless w:bookmarkEnd marker, not a w:p, so attachSectionBreak has to descend into the construct to find the paragraph the break actually belongs to, the same way buildFieldNodes' own findParagraph already does for a field.
  it("attaches a mid-document section break to the true last paragraph even when a construct closes at the end of the section", () => {
    const closingParagraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:sectPr", {}, [
          el("w:pgSz", { "w:w": "11906", "w:h": "16838" }),
          el("w:pgMar", {
            "w:top": "720",
            "w:right": "720",
            "w:bottom": "720",
            "w:left": "720",
          }),
        ]),
      ]),
      el("w:r", {}, [el("w:t", {}, [txt("end of section one")])]),
    ]);
    const source = docxPackage([
      el("w:bookmarkStart", { "w:id": "1", "w:name": "closing" }),
      closingParagraph,
      el("w:bookmarkEnd", { "w:id": "1" }),
      para("second"),
    ]);
    const sections = expectStableRoundTrip(source);
    expect(sections).toHaveLength(2);
    // No spurious empty paragraph gained on the way out to carry the break.
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "constructEnd",
    ]);
  });
});

describe("buildDocxPackageFromContent: construct round trip", () => {
  it("round-trips a content control with its type, tag, alias, lock, and options", () => {
    const sdt = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:alias", { "w:val": "Status" }),
        el("w:tag", { "w:val": "status" }),
        el("w:lock", { "w:val": "sdtLocked" }),
        el("w:dropDownList", {}, [
          el("w:listItem", { "w:displayText": "Draft" }),
          el("w:listItem", { "w:displayText": "Final" }),
        ]),
      ]),
      el("w:sdtContent", {}, [para("Draft")]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([sdt]));
    const start = sections[0]?.blocks[0];
    expect(
      start?.kind === "constructStart" ? start.descriptor : undefined,
    ).toEqual({
      kind: "contentControl",
      controlType: "dropDown",
      tag: "status",
      alias: "Status",
      lock: "container",
      options: ["Draft", "Final"],
    });
  });

  it("round-trips a checkbox, a date, and a table-of-contents control through their own docx spellings", () => {
    const control = (properties: XmlNode[], text: string): XmlNode =>
      el("w:sdt", {}, [
        el("w:sdtPr", {}, properties),
        el("w:sdtContent", {}, [para(text)]),
      ]);
    const source = docxPackage([
      control(
        [el("w14:checkbox", {}, [el("w14:checked", { "w14:val": "1" })])],
        "X",
      ),
      control(
        [el("w:date", { "w:fullDate": "2026-08-18T00:00:00Z" })],
        "18 August 2026",
      ),
      control(
        [
          el("w:docPartObj", {}, [
            el("w:docPartGallery", { "w:val": "Table of Contents" }),
          ]),
        ],
        "Chapter 1",
      ),
    ]);
    const sections = expectStableRoundTrip(source);
    const descriptors = (sections[0]?.blocks ?? []).flatMap((block) =>
      block.kind === "constructStart" ? [block.descriptor] : [],
    );
    expect(descriptors).toEqual([
      { kind: "contentControl", controlType: "checkbox", checked: true },
      {
        kind: "contentControl",
        controlType: "date",
        value: "2026-08-18T00:00:00Z",
      },
      { kind: "contentControl", controlType: "index" },
    ]);
  });

  it("round-trips a non-TOC gallery through the residue channel: the docPartObj degrades to richText on read and is restored on write", () => {
    // The restorable tier's first consumer (document-schema.js's residue channel): a Cover Pages SDT reads back as a richText control carrying its w:docPartObj verbatim in descriptor.source, and the writer re-emits the element from that residue in place of the default w:richText type element — so the same-format pair loses the gallery name no longer.
    const coverPage = el("w:sdt", {}, [
      el("w:sdtPr", {}, [
        el("w:alias", { "w:val": "Title" }),
        el("w:docPartObj", {}, [
          el("w:docPartGallery", { "w:val": "Cover Pages" }),
        ]),
      ]),
      el("w:sdtContent", {}, [para("Title page")]),
    ]);
    const { before, after, written } = roundTrip(docxPackage([coverPage]));
    expect(after).toEqual(before);
    const descriptor = before[0]?.blocks[0];
    expect(
      descriptor?.kind === "constructStart" ? descriptor.descriptor : undefined,
    ).toEqual({
      kind: "contentControl",
      controlType: "richText",
      alias: "Title",
      source: {
        format: "docx",
        xml: '<w:docPartObj><w:docPartGallery w:val="Cover Pages"></w:docPartGallery></w:docPartObj>',
      },
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const galleries =
      document === undefined
        ? []
        : elementsWithTag([document], "w:docPartGallery");
    expect(
      galleries.map(
        (gallery) =>
          gallery.attributes.find((attribute) => attribute.name === "w:val")
            ?.value,
      ),
    ).toEqual(["Cover Pages"]);
  });

  it("does not restore gallery residue on a controlType the reader never mints it on: a hand-built plainText control keeps its w:text element", () => {
    // Restoration is gated on the controlType the reader mints the residue on (richText, constructs.ts's degradation verdict), not on residue shape alone: a hand-built descriptor of any other controlType carrying docPartObj-shaped docx residue keeps its own semantic type element rather than having it silently replaced, and the residue stays quarantined for the same-format consumer that owns it.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "constructStart",
              descriptor: {
                kind: "contentControl",
                controlType: "plainText",
                source: {
                  format: "docx",
                  xml: '<w:docPartObj><w:docPartGallery w:val="Cover Pages"></w:docPartGallery></w:docPartObj>',
                },
              },
            },
            { kind: "paragraph", runs: [{ text: "plain" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const root = document === undefined ? [] : [document];
    expect(elementsWithTag(root, "w:text")).toHaveLength(1);
    expect(elementsWithTag(root, "w:docPartObj")).toHaveLength(0);
  });

  it("round-trips a tracked insertion and a tracked deletion, keeping the deleted text as deleted text, and wraps each paragraph's own runs rather than the paragraph itself", () => {
    const ins = el(
      "w:ins",
      { "w:id": "1", "w:author": "Ada", "w:date": "2026-08-18T09:00:00Z" },
      [para("added")],
    );
    const del = el("w:del", { "w:id": "2", "w:author": "Grace" }, [
      el("w:p", {}, [el("w:r", {}, [el("w:delText", {}, [txt("removed")])])]),
    ]);
    const { before, after, written } = roundTrip(docxPackage([ins, del]));
    expect(after).toEqual(before);
    const document = rootElement(written.parts["word/document.xml"]);
    const root = document === undefined ? [] : [document];
    expect(elementsWithTag(root, "w:delText")).toHaveLength(1);
    // CT_RunTrackChange (reached through EG_RunLevelElts) has no w:p in its content model: w:ins/w:del must wrap the paragraph's own runs, never the w:p element itself, and CT_TrackChange's own w:author is required on every one of them.
    for (const element of [
      ...elementsWithTag(root, "w:ins"),
      ...elementsWithTag(root, "w:del"),
    ]) {
      expect(
        element.children.some(
          (child) => child.type === "element" && child.tag === "w:p",
        ),
      ).toBe(false);
      expect(element.attributes.some((a) => a.name === "w:author")).toBe(true);
    }
  });

  it("mints its own author for a tracked change whose descriptor carries none, rather than omitting the required attribute", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: { kind: "provenance", change: "insertion" },
      },
      { kind: "paragraph", runs: [{ text: "anonymous" }] },
      { kind: "constructEnd" },
    ];
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks,
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const insEls = elementsWithTag(
      document === undefined ? [] : [document],
      "w:ins",
    );
    expect(insEls.length).toBeGreaterThan(0);
    for (const element of insEls) {
      const author = element.attributes.find(
        (a) => a.name === "w:author",
      )?.value;
      expect(author).toBeTruthy();
    }
  });

  it("threads a tracked change through a nested bookmark down to the paragraph it wraps, rather than dropping it", () => {
    const blocks: ContentBlock[] = [
      {
        kind: "constructStart",
        descriptor: { kind: "provenance", change: "insertion", author: "Ada" },
      },
      {
        kind: "constructStart",
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "intro" },
      },
      { kind: "paragraph", runs: [{ text: "nested" }] },
      { kind: "constructEnd" },
      { kind: "constructEnd" },
    ];
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks,
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    expect(
      body?.type === "element"
        ? body.children.map((child) =>
            child.type === "element" ? child.tag : child.type,
          )
        : undefined,
    ).toEqual(["w:bookmarkStart", "w:p", "w:bookmarkEnd", "w:sectPr"]);
    const descriptors =
      readDocxContent(written).sections[0]?.blocks.flatMap((block) =>
        block.kind === "constructStart" ? [block.descriptor] : [],
      ) ?? [];
    expect(descriptors).toContainEqual({
      kind: "anchor",
      anchorType: "bookmark",
      name: "intro",
    });
    expect(descriptors).toContainEqual({
      kind: "provenance",
      change: "insertion",
      author: "Ada",
    });
  });

  it("round-trips a move pair as its own two provenance changes", () => {
    const moveFrom = el("w:p", {}, [
      el("w:moveFrom", { "w:id": "1", "w:author": "Ada" }, [
        el("w:r", {}, [el("w:delText", {}, [txt("moved")])]),
      ]),
    ]);
    const moveTo = el("w:p", {}, [
      el("w:moveTo", { "w:id": "2", "w:author": "Ada" }, [
        el("w:r", {}, [el("w:t", {}, [txt("moved")])]),
      ]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([moveFrom, moveTo]));
    const descriptors = (sections[0]?.blocks ?? []).flatMap((block) =>
      block.kind === "constructStart" ? [block.descriptor] : [],
    );
    expect(descriptors).toEqual([
      { kind: "provenance", change: "moveFrom", author: "Ada" },
      { kind: "provenance", change: "moveTo", author: "Ada" },
    ]);
  });

  it("round-trips a bookmark spanning several paragraphs", () => {
    const source = docxPackage([
      el("w:bookmarkStart", { "w:id": "1", "w:name": "intro" }),
      para("one"),
      para("two"),
      el("w:bookmarkEnd", { "w:id": "1" }),
      para("outside"),
    ]);
    const sections = expectStableRoundTrip(source);
    expect(sections[0]?.blocks.map((block) => block.kind)).toEqual([
      "constructStart",
      "paragraph",
      "paragraph",
      "constructEnd",
      "paragraph",
    ]);
  });

  it("round-trips a bookmark Word wrote inside a heading paragraph as a block-level pair around it", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:bookmarkStart", { "w:id": "3", "w:name": "_Toc9" }),
        el("w:r", {}, [el("w:t", {}, [txt("Chapter")])]),
        el("w:bookmarkEnd", { "w:id": "3" }),
      ]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    expect(
      body?.type === "element"
        ? body.children.map((child) =>
            child.type === "element" ? child.tag : child.type,
          )
        : undefined,
    ).toEqual(["w:bookmarkStart", "w:p", "w:bookmarkEnd", "w:sectPr"]);
  });

  it("round-trips a bookmark whose extent is a sub-sequence of one paragraph's runs, as a run-level construct extent", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("before ")])]),
        el("w:bookmarkStart", { "w:id": "4", "w:name": "midway" }),
        el("w:r", {}, [el("w:t", {}, [txt("marked")])]),
        el("w:bookmarkEnd", { "w:id": "4" }),
        el("w:r", {}, [el("w:t", {}, [txt(" after")])]),
      ]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const paragraph = before[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "midway" },
        startRun: 1,
        endRun: 2,
      },
    ]);
    // The writer puts the halves back between the runs the range names — inside the paragraph, never around it.
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    const paragraphElement =
      body?.type === "element"
        ? body.children.find(
            (child) => child.type === "element" && child.tag === "w:p",
          )
        : undefined;
    const tags =
      paragraphElement?.type === "element"
        ? paragraphElement.children.map((child) =>
            child.type === "element" ? child.tag : child.type,
          )
        : undefined;
    expect(tags).toEqual([
      "w:r",
      "w:bookmarkStart",
      "w:r",
      "w:bookmarkEnd",
      "w:r",
    ]);
  });

  it("round-trips two bookmarks whose run-level extents cross, keeping both", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("one ")])]),
        el("w:bookmarkStart", { "w:id": "1", "w:name": "first" }),
        el("w:r", {}, [el("w:t", {}, [txt("two ")])]),
        el("w:bookmarkStart", { "w:id": "2", "w:name": "second" }),
        el("w:r", {}, [el("w:t", {}, [txt("three ")])]),
        el("w:bookmarkEnd", { "w:id": "1" }),
        el("w:r", {}, [el("w:t", {}, [txt(" four")])]),
        el("w:bookmarkEnd", { "w:id": "2" }),
      ]),
    ]);
    const sections = expectStableRoundTrip(source);
    const paragraph = sections[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "first" },
        startRun: 1,
        endRun: 3,
      },
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "second" },
        startRun: 2,
        endRun: 4,
      },
    ]);
  });

  it("round-trips a point run extent and one reaching the paragraph's tail", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("unmarked ")])]),
        el("w:bookmarkStart", { "w:id": "5", "w:name": "tail" }),
        el("w:r", {}, [el("w:t", {}, [txt("marked")])]),
        el("w:bookmarkStart", { "w:id": "6", "w:name": "point" }),
        el("w:bookmarkEnd", { "w:id": "6" }),
        el("w:r", {}, [el("w:t", {}, [txt(" also")])]),
        el("w:bookmarkEnd", { "w:id": "5" }),
      ]),
    ]);
    const sections = expectStableRoundTrip(source);
    const paragraph = sections[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "tail" },
        startRun: 1,
        endRun: 3,
      },
      {
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "point" },
        startRun: 2,
        endRun: 2,
      },
    ]);
  });

  it("writes a point run extent's own halves as a start-then-end pair, not an inverted one", () => {
    // WordprocessingML pairs w:bookmarkStart/End by w:id with start-before-end ordering, so the ORDER of a point extent's own two halves is load-bearing for every consumer that pairs by id and order (Word included): the boundary convention of emitting closes before opens exists for two DIFFERENT extents meeting at one boundary, and applied to a point's own halves it would put the bookmarkEnd first. The written order of the neighbouring range extent is pinned too — its close lands after the last run it covers, the point pair between the runs its position names.
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("unmarked ")])]),
        el("w:bookmarkStart", { "w:id": "5", "w:name": "tail" }),
        el("w:r", {}, [el("w:t", {}, [txt("marked")])]),
        el("w:bookmarkStart", { "w:id": "6", "w:name": "point" }),
        el("w:bookmarkEnd", { "w:id": "6" }),
        el("w:r", {}, [el("w:t", {}, [txt(" also")])]),
        el("w:bookmarkEnd", { "w:id": "5" }),
      ]),
    ]);
    const { written } = roundTrip(source);
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    const paragraphElement =
      body?.type === "element"
        ? body.children.find(
            (child) => child.type === "element" && child.tag === "w:p",
          )
        : undefined;
    expect(writtenBookmarkOrder(paragraphElement)).toEqual([
      "run",
      "start(tail)",
      "run",
      "start(point)",
      "end(point)",
      "run",
      "end(tail)",
    ]);
  });

  it("writes two point run extents sharing one run position with each start before its own end", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("one ")])]),
        el("w:bookmarkStart", { "w:id": "1", "w:name": "first" }),
        el("w:bookmarkEnd", { "w:id": "1" }),
        el("w:bookmarkStart", { "w:id": "2", "w:name": "second" }),
        el("w:bookmarkEnd", { "w:id": "2" }),
        el("w:r", {}, [el("w:t", {}, [txt("two")])]),
      ]),
    ]);
    const { written } = roundTrip(source);
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    const paragraphElement =
      body?.type === "element"
        ? body.children.find(
            (child) => child.type === "element" && child.tag === "w:p",
          )
        : undefined;
    expect(writtenBookmarkOrder(paragraphElement)).toEqual([
      "run",
      "start(first)",
      "end(first)",
      "start(second)",
      "end(second)",
      "run",
    ]);
  });

  it("writes a non-writable run-level construct extent as its paragraph's own content, with no markers", () => {
    // The kinds readDocxContent produces at run level that this writer has no spelling for: a run-scoped content control (a legacy w:ffData form field) would need its control payload rebuilt from the descriptor, and a comment or note reference points into parts this writer does not emit. Its runs write as ordinary content and only the descriptor is lost — the same content-preserving policy the block-level foreign constructs above follow.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "plain " }, { text: "controlled" }],
              constructs: [
                {
                  descriptor: {
                    kind: "contentControl",
                    controlType: "checkbox",
                    checked: true,
                  },
                  startRun: 1,
                  endRun: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    expect(
      elementsWithTag(
        document === undefined ? [] : [document],
        "w:bookmarkStart",
      ),
    ).toHaveLength(0);
    expect(
      elementsWithTag(document === undefined ? [] : [document], "w:ffData"),
    ).toHaveLength(0);
    const roundTripped = readDocxContent(written).sections[0]?.blocks[0];
    expect(
      roundTripped?.kind === "paragraph"
        ? roundTripped.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("plain controlled");
  });

  it("round-trips a mid-paragraph complex field as a field run extent, re-emitting its fldChar characters between the runs the range names", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("Page ")])]),
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
        el("w:r", {}, [
          el("w:instrText", { "xml:space": "preserve" }, [txt(" NUMPAGES ")]),
        ]),
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
        el("w:r", {}, [el("w:t", {}, [txt("10")])]),
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
        el("w:r", {}, [el("w:t", {}, [txt(" of pages")])]),
      ]),
    ]);
    const { before, after } = roundTrip(source);
    expect(after).toEqual(before);
    const paragraph = before[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "field", instruction: " NUMPAGES " },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("round-trips a mid-paragraph w:fldSimple's field extent through the writer's own fldChar spelling, which reads back as the same extent", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("Today is ")])]),
        el("w:fldSimple", { "w:instr": " DATE " }, [
          el("w:r", {}, [el("w:t", {}, [txt("2026-08-20")])]),
        ]),
        el("w:r", {}, [el("w:t", {}, [txt(".")])]),
      ]),
    ]);
    const { before, after } = roundTrip(source);
    expect(after).toEqual(before);
    const paragraph = before[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: { kind: "field", instruction: " DATE " },
        startRun: 1,
        endRun: 2,
      },
    ]);
  });

  it("round-trips an internal @w:anchor link extent, wrapping exactly the runs the range names in one w:hyperlink", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:t", {}, [txt("See ")])]),
        el("w:hyperlink", { "w:anchor": "target" }, [
          el("w:r", {}, [el("w:t", {}, [txt("the section")])]),
          el("w:r", {}, [el("w:t", {}, [txt(" below")])]),
        ]),
        el("w:r", {}, [el("w:t", {}, [txt(" for details")])]),
      ]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const paragraph = before[0]?.blocks[0];
    expect(
      paragraph?.kind === "paragraph" ? paragraph.constructs : undefined,
    ).toEqual([
      {
        descriptor: {
          kind: "link",
          target: { kind: "internal", anchor: "target" },
        },
        startRun: 1,
        endRun: 3,
      },
    ]);
    // The wrap covers exactly the link's own two runs, never the text either side.
    const document = rootElement(written.parts["word/document.xml"]);
    const hyperlinks = elementsWithTag(
      document === undefined ? [] : [document],
      "w:hyperlink",
    );
    expect(hyperlinks).toHaveLength(1);
    expect(
      hyperlinks[0]?.type === "element"
        ? hyperlinks[0].attributes.find((a) => a.name === "w:anchor")?.value
        : undefined,
    ).toBe("target");
    expect(
      hyperlinks[0]?.type === "element"
        ? hyperlinks[0].children.filter(
            (child) => child.type === "element" && child.tag === "w:r",
          ).length
        : 0,
    ).toBe(2);
  });

  it("writes a crossing internal link extent's runs as plain content rather than a mis-nested wrap", () => {
    // Two internal links whose ranges cross cannot both wrap (nesting w:hyperlink inside w:hyperlink is not WordprocessingML), and Word itself cannot produce the shape — only a hand-built ContentDocument can. The earlier link wraps; the crossing one's runs stay plain and only its descriptor is lost, the same content-preserving policy an unwritable construct kind follows.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "first" },
                  },
                  startRun: 0,
                  endRun: 3,
                },
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "second" },
                  },
                  startRun: 1,
                  endRun: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const hyperlinks = elementsWithTag(
      document === undefined ? [] : [document],
      "w:hyperlink",
    );
    expect(hyperlinks).toHaveLength(1);
    const roundTripped = readDocxContent(written).sections[0]?.blocks[0];
    expect(
      roundTripped?.kind === "paragraph"
        ? roundTripped.runs.map((run) => run.text).join("")
        : undefined,
    ).toBe("abc");
  });

  it("resolves two overlapping internal links by the earliest-starting extent, regardless of the constructs array's own order", () => {
    // The winner is decided by sorting the extents by startRun (ties broken by the LONGER extent first), never by the order they happen to appear in `constructs` — this paragraph lists the later-starting, shorter link FIRST specifically to prove the sort, not the array order, decides the winner.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "later-shorter" },
                  },
                  startRun: 1,
                  endRun: 3,
                },
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "earlier-longer" },
                  },
                  startRun: 0,
                  endRun: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const hyperlinks = elementsWithTag(
      document === undefined ? [] : [document],
      "w:hyperlink",
    );
    expect(hyperlinks).toHaveLength(1);
    expect(
      hyperlinks[0]?.type === "element"
        ? hyperlinks[0].attributes.find((a) => a.name === "w:anchor")?.value
        : undefined,
    ).toBe("earlier-longer");
  });

  it("wraps two non-overlapping internal links independently, without one's own wrap falsely blocking the other", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "a" },
                { text: "b" },
                { text: "between" },
                { text: "c" },
                { text: "d" },
              ],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "first-pair" },
                  },
                  startRun: 0,
                  endRun: 2,
                },
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "second-pair" },
                  },
                  startRun: 3,
                  endRun: 5,
                },
              ],
            },
          ],
        },
      ],
    });
    const document = rootElement(written.parts["word/document.xml"]);
    const hyperlinks = elementsWithTag(
      document === undefined ? [] : [document],
      "w:hyperlink",
    );
    expect(hyperlinks).toHaveLength(2);
    expect(
      hyperlinks.map(
        (h) => h.attributes.find((a) => a.name === "w:anchor")?.value,
      ),
    ).toEqual(["first-pair", "second-pair"]);
    expect(
      hyperlinks.map(
        (h) =>
          h.children.filter(
            (child) => child.type === "element" && child.tag === "w:r",
          ).length,
      ),
    ).toEqual([2, 2]);
  });

  it("refuses a run-level extent whose range does not name real runs, rather than writing markers at a made-up position", () => {
    const faulty = {
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "paragraph" as const,
              runs: [{ text: "x" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor" as const,
                    anchorType: "bookmark" as const,
                    name: "beyond",
                  },
                  startRun: 0,
                  endRun: 5,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(() => buildDocxPackageFromContent(faulty)).toThrow(
      /run-level construct extent/,
    );
  });

  it("round-trips a multi-paragraph complex field, putting its characters back inside the extent's own paragraphs", () => {
    const source = docxPackage([
      el("w:p", {}, [
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "begin" })]),
        el("w:r", {}, [el("w:instrText", {}, [txt(' TOC \\o "1-3" \\h ')])]),
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "separate" })]),
        el("w:r", {}, [el("w:t", {}, [txt("Chapter 1")])]),
      ]),
      para("Chapter 2"),
      el("w:p", {}, [
        el("w:r", {}, [el("w:fldChar", { "w:fldCharType": "end" })]),
      ]),
    ]);
    const { before, after, written } = roundTrip(source);
    expect(after).toEqual(before);
    const start = after[0]?.blocks[0];
    expect(
      start?.kind === "constructStart" ? start.descriptor : undefined,
    ).toEqual({ kind: "field", instruction: ' TOC \\o "1-3" \\h ' });
    const document = rootElement(written.parts["word/document.xml"]);
    const body = document === undefined ? undefined : document.children[0];
    // The field's own characters live inside the extent's paragraphs, so the body gains no paragraph of its own for them.
    expect(
      body?.type === "element"
        ? body.children.filter(
            (child) => child.type === "element" && child.tag === "w:p",
          ).length
        : undefined,
    ).toBe(3);
  });

  it("round-trips a simple field that is a paragraph's whole content", () => {
    const sections = expectStableRoundTrip(
      docxPackage([
        el("w:p", {}, [
          el("w:fldSimple", { "w:instr": " PAGE " }, [
            el("w:r", {}, [el("w:t", {}, [txt("4")])]),
          ]),
        ]),
      ]),
    );
    const start = sections[0]?.blocks[0];
    expect(
      start?.kind === "constructStart" ? start.descriptor : undefined,
    ).toEqual({ kind: "field", instruction: " PAGE " });
  });

  // The kinds readDocxContent never produces, which a ContentDocument from another codec still can. Each writes its content and drops only the descriptor, since WordprocessingML has no block-level element for any of them — what must never happen is an element written where it does not parse.
  it.each([
    [
      "a block-scoped link",
      {
        kind: "link",
        target: { kind: "external", uri: "https://example.com" },
      },
    ],
    ["a named division", { kind: "division", name: "part-one" }],
    [
      "a format-change provenance",
      { kind: "provenance", change: "formatChange", author: "Ada" },
    ],
    [
      "a footnote anchor",
      { kind: "anchor", anchorType: "footnote", name: "1" },
    ],
  ] satisfies [string, ConstructDescriptor][])(
    "writes %s as its own content, with no wrapper element and no lost paragraph",
    (_label, descriptor) => {
      const blocks: ContentBlock[] = [
        { kind: "constructStart", descriptor },
        { kind: "paragraph", runs: [{ text: "inside" }] },
        { kind: "constructEnd" },
      ];
      const written = buildDocxPackageFromContent({
        sections: [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks,
          },
        ],
      });
      const roundTripped = readDocxContent(written).sections[0]?.blocks ?? [];
      expect(roundTripped.map((block) => block.kind)).toEqual(["paragraph"]);
      const paragraph = roundTripped[0];
      expect(
        paragraph?.kind === "paragraph" ? paragraph.runs[0]?.text : undefined,
      ).toBe("inside");
    },
  );

  it("round-trips constructs nested inside each other, and inside a table cell", () => {
    // A content control wrapping a wholly tracked-inserted paragraph — Word's own nesting order, since CT_RunTrackChange has no w:p in its content model and so can never be the structural outer element around a block-level w:sdt.
    const trackedParagraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:rPr", {}, [el("w:ins", { "w:id": "1", "w:author": "Ada" })]),
      ]),
      el("w:ins", { "w:id": "2", "w:author": "Ada" }, [
        el("w:r", {}, [el("w:t", {}, [txt("controlled")])]),
      ]),
    ]);
    const outer = el("w:sdt", {}, [
      el("w:sdtPr", {}, [el("w:richText")]),
      el("w:sdtContent", {}, [trackedParagraph]),
    ]);
    const cellControl = el("w:sdt", {}, [
      el("w:sdtPr", {}, [el("w:text")]),
      el("w:sdtContent", {}, [para("in a cell")]),
    ]);
    const table = el("w:tbl", {}, [
      el("w:tblGrid", {}, [el("w:gridCol", { "w:w": "2880" })]),
      el("w:tr", {}, [el("w:tc", {}, [cellControl])]),
    ]);
    const sections = expectStableRoundTrip(docxPackage([outer, table]));
    for (const section of sections) {
      expect(findConstructMarkerImbalance(section.blocks)).toBeUndefined();
    }
  });
});

describe("buildDocxPackageFromContent: styles, numbering, comments, footnotes, endnotes, headers/footers (#968)", () => {
  const HEADER_REL =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header";

  it("writes a real word/styles.xml entry for every referenced styleId, so a w:pStyle reference resolves instead of dangling", () => {
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [el("w:pStyle", { "w:val": "IntenseQuote" })]),
      el("w:r", {}, [el("w:t", {}, [txt("quoted")])]),
    ]);
    // No word/styles.xml at all in the source — the exact defect the issue reports.
    const { after, written } = fullRoundTrip(docxPackage([paragraph]));
    const stylesRoot = rootElement(written.parts["word/styles.xml"]);
    expect(stylesRoot).toBeDefined();
    const styleIds =
      stylesRoot === undefined
        ? []
        : elementsWithTag([stylesRoot], "w:style").map((style) =>
            attr(style, "w:styleId"),
          );
    expect(styleIds).toEqual(
      expect.arrayContaining([
        "Normal",
        "DefaultParagraphFont",
        "IntenseQuote",
      ]),
    );
    const relTypes = elementsWithTag(
      [rootElement(written.parts["word/_rels/document.xml.rels"])!],
      "Relationship",
    ).map((rel) => attr(rel, "Type"));
    expect(relTypes).toEqual(
      expect.arrayContaining([
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
      ]),
    );
    const firstBlock = after.sections[0]?.blocks[0];
    expect(
      firstBlock?.kind === "paragraph" ? firstBlock.styleId : undefined,
    ).toBe("IntenseQuote");
  });

  it("round-trips word/numbering.xml's own abstractNum/num level definitions", () => {
    const abstractNum = el("w:abstractNum", { "w:abstractNumId": "0" }, [
      el("w:lvl", { "w:ilvl": "0" }, [
        el("w:start", { "w:val": "1" }),
        el("w:numFmt", { "w:val": "bullet" }),
        el("w:lvlText", { "w:val": "•" }),
      ]),
    ]);
    const num = el("w:num", { "w:numId": "1" }, [
      el("w:abstractNumId", { "w:val": "0" }),
    ]);
    const paragraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:numPr", {}, [
          el("w:ilvl", { "w:val": "0" }),
          el("w:numId", { "w:val": "1" }),
        ]),
      ]),
      el("w:r", {}, [el("w:t", {}, [txt("bulleted")])]),
    ]);
    const source = docxPackage([paragraph], {
      "word/numbering.xml": {
        kind: "xml",
        nodes: [el("w:numbering", {}, [abstractNum, num])],
      },
    });
    const { before, after, written } = fullRoundTrip(source);
    expect(written.parts["word/numbering.xml"]).toBeDefined();
    expect(after.numbering).toEqual(before.numbering);
    expect(after.numbering["1"]?.levels["0"]).toEqual({
      format: "bullet",
      text: "•",
      startAt: 1,
    });
  });

  it("omits word/numbering.xml entirely for a document with no lists", () => {
    const { written } = fullRoundTrip(docxPackage([para("plain")]));
    expect(written.parts["word/numbering.xml"]).toBeUndefined();
  });

  it("round-trips a comment's extent, reference mark, author, and text through word/comments.xml", () => {
    const paragraph = el("w:p", {}, [
      el("w:commentRangeStart", { "w:id": "7" }),
      el("w:r", {}, [el("w:t", {}, [txt("commented text")])]),
      el("w:commentRangeEnd", { "w:id": "7" }),
      el("w:r", {}, [el("w:commentReference", { "w:id": "7" })]),
    ]);
    const source = docxPackage([paragraph], {
      "word/comments.xml": {
        kind: "xml",
        nodes: [
          el("w:comments", {}, [
            el("w:comment", { "w:id": "7", "w:author": "A Reviewer" }, [
              el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("a note")])])]),
            ]),
          ]),
        ],
      },
    });
    const { before, after, written } = fullRoundTrip(source);
    expect(written.parts["word/comments.xml"]).toBeDefined();
    expect(after.comments).toEqual(before.comments);
    expect(after.comments).toEqual([
      { id: "7", author: "A Reviewer", text: "a note" },
    ]);
    expect(after.sections).toEqual(before.sections);
  });

  it("mints a comment id past the highest explicit numeric id, leaving a non-numeric id untouched", () => {
    // A hand-built DocxContent, not a round trip: readDocxContent always carries every comment's own real w:id, so the minting path (comment.id undefined) is only ever exercised by content built by hand.
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [],
        },
      ],
      comments: [
        { id: "5", author: "A", text: "first" },
        { text: "second" },
        { id: "abc", text: "third" },
      ],
    });
    const root = rootElement(written.parts["word/comments.xml"]);
    const comments = childrenWithTag(root!, "w:comment");
    expect(comments.map((c) => attr(c, "w:id"))).toEqual(["5", "6", "abc"]);
  });

  it("writes the exact footnotes.xml/endnotes.xml boilerplate, and mints a footnote id past the highest explicit numeric id", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [],
        },
      ],
      footnotes: [
        { id: "2", text: "a" },
        { text: "b" },
        { id: "9", type: "custom", text: "c" },
      ],
    });
    const root = rootElement(written.parts["word/footnotes.xml"]);
    if (root === undefined) {
      throw new Error("expected a word/footnotes.xml root element");
    }
    expect(root.children[0]).toEqual(
      el("w:footnote", { "w:type": "separator", "w:id": "-1" }, [
        el("w:p", {}, [el("w:r", {}, [el("w:separator")])]),
      ]),
    );
    expect(root.children[1]).toEqual(
      el("w:footnote", { "w:type": "continuationSeparator", "w:id": "0" }, [
        el("w:p", {}, [el("w:r", {}, [el("w:continuationSeparator")])]),
      ]),
    );
    const notes = childrenWithTag(root, "w:footnote").slice(2);
    // Explicit ids are 2 and 9, so the minted id for the id-less middle note is 10, not one past 2 — every explicit id counts toward the floor, regardless of array position.
    expect(notes.map((n) => attr(n, "w:id"))).toEqual(["2", "10", "9"]);
    // w:type is written only when the source recorded one other than the ordinary "normal" implied by its absence.
    expect(notes[0]?.attributes.some((a) => a.name === "w:type")).toBe(false);
    expect(notes[1]?.attributes.some((a) => a.name === "w:type")).toBe(false);
    expect(attr(notes[2]!, "w:type")).toBe("custom");
  });

  it("round-trips a footnote and an endnote reference mark and body through their own parts", () => {
    const paragraph = el("w:p", {}, [
      el("w:r", {}, [el("w:t", {}, [txt("see")])]),
      el("w:r", {}, [el("w:footnoteReference", { "w:id": "1" })]),
      el("w:r", {}, [el("w:endnoteReference", { "w:id": "1" })]),
    ]);
    const source = docxPackage([paragraph], {
      "word/footnotes.xml": {
        kind: "xml",
        nodes: [
          el("w:footnotes", {}, [
            el("w:footnote", { "w:id": "1" }, [
              el("w:p", {}, [
                el("w:r", {}, [el("w:t", {}, [txt("footnote body")])]),
              ]),
            ]),
          ]),
        ],
      },
      "word/endnotes.xml": {
        kind: "xml",
        nodes: [
          el("w:endnotes", {}, [
            el("w:endnote", { "w:id": "1" }, [
              el("w:p", {}, [
                el("w:r", {}, [el("w:t", {}, [txt("endnote body")])]),
              ]),
            ]),
          ]),
        ],
      },
    });
    const { before, after, written } = fullRoundTrip(source);
    expect(written.parts["word/footnotes.xml"]).toBeDefined();
    expect(written.parts["word/endnotes.xml"]).toBeDefined();
    expect(after.footnotes).toEqual(before.footnotes);
    expect(after.endnotes).toEqual(before.endnotes);
    expect(after.footnotes).toEqual([{ id: "1", text: "footnote body" }]);
    expect(after.endnotes).toEqual([{ id: "1", text: "endnote body" }]);
    expect(after.sections).toEqual(before.sections);
  });

  it("round-trips a header part and its section-level default reference", () => {
    const finalSectPr = el("w:sectPr", {}, [
      el("w:headerReference", { "w:type": "default", "r:id": "rIdHeader1" }),
      el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
      el("w:pgMar", {
        "w:top": "1440",
        "w:right": "1440",
        "w:bottom": "1440",
        "w:left": "1440",
      }),
    ]);
    const body = el("w:body", {}, [para("body text"), finalSectPr]);
    const source: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
        "word/_rels/document.xml.rels": {
          kind: "xml",
          nodes: [
            el("Relationships", {}, [
              el("Relationship", {
                Id: "rIdHeader1",
                Type: HEADER_REL,
                Target: "header1.xml",
              }),
            ]),
          ],
        },
        "word/header1.xml": {
          kind: "xml",
          nodes: [
            el("w:hdr", {}, [
              el("w:p", {}, [
                el("w:r", {}, [el("w:t", {}, [txt("Running header")])]),
              ]),
            ]),
          ],
        },
      },
    };
    const { before, after, written } = fullRoundTrip(source);
    expect(written.parts["word/header1.xml"]).toBeDefined();
    expect(written.parts["word/_rels/header1.xml.rels"]).toBeUndefined();
    expect(after.headerFooterParts).toEqual(before.headerFooterParts);
    expect(after.sectionHeaderFooters).toEqual(before.sectionHeaderFooters);
    expect(after.headerFooterParts).toEqual([
      {
        path: "word/header1.xml",
        kind: "header",
        blocks: [{ kind: "paragraph", runs: [{ text: "Running header" }] }],
      },
    ]);
    expect(after.sectionHeaderFooters).toEqual([
      { header: { default: "word/header1.xml" } },
    ]);
  });

  it("writes an image inside a header through that header's own relationships, not the document's", () => {
    const drawing = el("w:drawing", {}, [
      el("wp:inline", {}, [
        el("wp:extent", { cx: "914400", cy: "914400" }),
        el("a:graphic", {}, [
          el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
            el("pic:pic", {}, [
              el("pic:blipFill", {}, [el("a:blip", { "r:embed": "rIdImg" })]),
            ]),
          ]),
        ]),
      ]),
    ]);
    const finalSectPr = el("w:sectPr", {}, [
      el("w:headerReference", { "w:type": "default", "r:id": "rIdHeader1" }),
      el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
      el("w:pgMar", {
        "w:top": "1440",
        "w:right": "1440",
        "w:bottom": "1440",
        "w:left": "1440",
      }),
    ]);
    const body = el("w:body", {}, [para("body text"), finalSectPr]);
    const source: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [el("w:document", {}, [body])],
        },
        "word/_rels/document.xml.rels": {
          kind: "xml",
          nodes: [
            el("Relationships", {}, [
              el("Relationship", {
                Id: "rIdHeader1",
                Type: HEADER_REL,
                Target: "header1.xml",
              }),
            ]),
          ],
        },
        "word/header1.xml": {
          kind: "xml",
          nodes: [el("w:hdr", {}, [el("w:p", {}, [el("w:r", {}, [drawing])])])],
        },
        "word/_rels/header1.xml.rels": {
          kind: "xml",
          nodes: [
            el("Relationships", {}, [
              el("Relationship", {
                Id: "rIdImg",
                Type: IMAGE_REL,
                Target: "media/image1.png",
              }),
            ]),
          ],
        },
        "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
      },
    };
    const { before, after, written } = fullRoundTrip(source);
    expect(written.parts["word/_rels/header1.xml.rels"]).toBeDefined();
    expect(after.headerFooterParts).toEqual(before.headerFooterParts);
    const headerPart = after.headerFooterParts[0];
    const image = headerPart?.blocks.find((block) => block.kind === "image");
    expect(image?.kind).toBe("image");
  });

  it("writes ONE media file for one payload referenced from many header parts, not one per part", () => {
    // The resource-exhaustion shape the security review of this PR named: a hostile package of N header/footer parts all referencing the same S-byte image must not become N x S of decoded media on round trip. Two headers carrying one payload here; the assertion is the byte-level consequence — exactly one word/media part, and both header relationships pointing at it.
    const headerImage = (embedId: string): XmlElement =>
      el("w:drawing", {}, [
        el("wp:inline", {}, [
          el("wp:extent", { cx: "914400", cy: "914400" }),
          el("a:graphic", {}, [
            el("a:graphicData", { uri: PICTURE_GRAPHIC_URI }, [
              el("pic:pic", {}, [
                el("pic:blipFill", {}, [el("a:blip", { "r:embed": embedId })]),
              ]),
            ]),
          ]),
        ]),
      ]);
    const sectPr = el("w:sectPr", {}, [
      el("w:headerReference", { "w:type": "default", "r:id": "rIdHeader1" }),
      el("w:headerReference", { "w:type": "even", "r:id": "rIdHeader2" }),
      el("w:pgSz", { "w:w": "12240", "w:h": "15840" }),
      el("w:pgMar", {
        "w:top": "1440",
        "w:right": "1440",
        "w:bottom": "1440",
        "w:left": "1440",
      }),
    ]);
    const source: Package = {
      parts: {
        "word/document.xml": {
          kind: "xml",
          nodes: [
            el("w:document", {}, [
              el("w:body", {}, [para("body text"), sectPr]),
            ]),
          ],
        },
        "word/_rels/document.xml.rels": {
          kind: "xml",
          nodes: [
            el("Relationships", {}, [
              el("Relationship", {
                Id: "rIdHeader1",
                Type: HEADER_REL,
                Target: "header1.xml",
              }),
              el("Relationship", {
                Id: "rIdHeader2",
                Type: HEADER_REL,
                Target: "header2.xml",
              }),
            ]),
          ],
        },
        "word/header1.xml": {
          kind: "xml",
          nodes: [
            el("w:hdr", {}, [
              el("w:p", {}, [el("w:r", {}, [headerImage("rIdImgA")])]),
            ]),
          ],
        },
        "word/_rels/header1.xml.rels": {
          kind: "xml",
          nodes: [
            el("Relationships", {}, [
              el("Relationship", {
                Id: "rIdImgA",
                Type: IMAGE_REL,
                Target: "media/image1.png",
              }),
            ]),
          ],
        },
        "word/header2.xml": {
          kind: "xml",
          nodes: [
            el("w:hdr", {}, [
              el("w:p", {}, [el("w:r", {}, [headerImage("rIdImgB")])]),
            ]),
          ],
        },
        "word/_rels/header2.xml.rels": {
          kind: "xml",
          nodes: [
            el("Relationships", {}, [
              el("Relationship", {
                Id: "rIdImgB",
                Type: IMAGE_REL,
                Target: "media/image2.png",
              }),
            ]),
          ],
        },
        "word/media/image1.png": { kind: "binary", base64: TINY_PNG_BASE64 },
        "word/media/image2.png": { kind: "binary", base64: TINY_PNG_BASE64 },
      },
    };
    const { written } = fullRoundTrip(source);
    const mediaFiles = Object.keys(written.parts).filter((path) =>
      path.startsWith("word/media/"),
    );
    expect(mediaFiles).toEqual(["word/media/image1.png"]);
    const header1Rels = written.parts["word/_rels/header1.xml.rels"];
    const header2Rels = written.parts["word/_rels/header2.xml.rels"];
    expect(header1Rels).toBeDefined();
    expect(header2Rels).toBeDefined();
  });
});

describe("buildDocxPackageFromContent: optional part emission, relationships, and content-type overrides", () => {
  const OFFICE_REL_NS =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  function relsOf(
    written: Package,
  ): { type: string; target: string; targetMode: string | undefined }[] {
    const relsRoot = rootElement(written.parts["word/_rels/document.xml.rels"]);
    if (relsRoot === undefined) {
      throw new Error("expected document rels part");
    }
    return elementsWithTag([relsRoot], "Relationship").map((rel) => ({
      type: attr(rel, "Type") ?? "",
      target: attr(rel, "Target") ?? "",
      targetMode: attr(rel, "TargetMode"),
    }));
  }

  function overridesOf(
    written: Package,
  ): { partName: string; contentType: string }[] {
    const typesRoot = rootElement(written.parts["[Content_Types].xml"]);
    if (typesRoot === undefined) {
      throw new Error("expected content types part");
    }
    return elementsWithTag([typesRoot], "Override").map((override) => ({
      partName: attr(override, "PartName") ?? "",
      contentType: attr(override, "ContentType") ?? "",
    }));
  }

  function fullyLoadedSource(): Package {
    const listParagraph = el("w:p", {}, [
      el("w:pPr", {}, [
        el("w:numPr", {}, [
          el("w:ilvl", { "w:val": "0" }),
          el("w:numId", { "w:val": "1" }),
        ]),
      ]),
      el("w:r", {}, [el("w:t", {}, [txt("bulleted")])]),
    ]);
    return docxPackage([listParagraph], {
      "word/numbering.xml": {
        kind: "xml",
        nodes: [
          el("w:numbering", {}, [
            el("w:abstractNum", { "w:abstractNumId": "0" }, [
              el("w:lvl", { "w:ilvl": "0" }, [
                el("w:start", { "w:val": "1" }),
                el("w:numFmt", { "w:val": "bullet" }),
                el("w:lvlText", { "w:val": "•" }),
              ]),
            ]),
            el("w:num", { "w:numId": "1" }, [
              el("w:abstractNumId", { "w:val": "0" }),
            ]),
          ]),
        ],
      },
      "word/comments.xml": {
        kind: "xml",
        nodes: [
          el("w:comments", {}, [
            el("w:comment", { "w:id": "1", "w:author": "A Reviewer" }, [
              el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("a note")])])]),
            ]),
          ]),
        ],
      },
      "word/footnotes.xml": {
        kind: "xml",
        nodes: [
          el("w:footnotes", {}, [
            el("w:footnote", { "w:id": "1" }, [
              el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("fn body")])])]),
            ]),
          ]),
        ],
      },
      "word/endnotes.xml": {
        kind: "xml",
        nodes: [
          el("w:endnotes", {}, [
            el("w:endnote", { "w:id": "1" }, [
              el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt("en body")])])]),
            ]),
          ]),
        ],
      },
    });
  }

  it("writes internal relationships for styles, numbering, comments, footnotes, and endnotes exactly, with no external target mode", () => {
    const { written } = fullRoundTrip(fullyLoadedSource());
    const internal = relsOf(written).filter(
      (rel) => rel.type !== `${OFFICE_REL_NS}/hyperlink`,
    );
    expect(internal).toEqual([
      {
        type: `${OFFICE_REL_NS}/styles`,
        target: "styles.xml",
        targetMode: undefined,
      },
      {
        type: `${OFFICE_REL_NS}/numbering`,
        target: "numbering.xml",
        targetMode: undefined,
      },
      {
        type: `${OFFICE_REL_NS}/comments`,
        target: "comments.xml",
        targetMode: undefined,
      },
      {
        type: `${OFFICE_REL_NS}/footnotes`,
        target: "footnotes.xml",
        targetMode: undefined,
      },
      {
        type: `${OFFICE_REL_NS}/endnotes`,
        target: "endnotes.xml",
        targetMode: undefined,
      },
    ]);
  });

  it("declares each optional part's Override with its exact part path and content type", () => {
    const { written } = fullRoundTrip(fullyLoadedSource());
    const overridePairs = overridesOf(written).map((o) => [
      o.partName,
      o.contentType,
    ]);
    expect(overridePairs).toEqual(
      expect.arrayContaining([
        [
          "/word/document.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
        ],
        [
          "/word/styles.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml",
        ],
        [
          "/word/numbering.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml",
        ],
        [
          "/word/comments.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
        ],
        [
          "/word/footnotes.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
        ],
        [
          "/word/endnotes.xml",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml",
        ],
      ]),
    );
  });

  it("omits the comments, footnotes, and endnotes parts, relationships, and overrides when there are none", () => {
    const { written } = fullRoundTrip(docxPackage([para("plain")]));
    expect(written.parts["word/comments.xml"]).toBeUndefined();
    expect(written.parts["word/footnotes.xml"]).toBeUndefined();
    expect(written.parts["word/endnotes.xml"]).toBeUndefined();
    const relTypes = relsOf(written).map((rel) => rel.type);
    expect(relTypes).not.toContain(`${OFFICE_REL_NS}/comments`);
    expect(relTypes).not.toContain(`${OFFICE_REL_NS}/footnotes`);
    expect(relTypes).not.toContain(`${OFFICE_REL_NS}/endnotes`);
    const overrideNames = overridesOf(written).map((o) => o.partName);
    expect(overrideNames).not.toContain("/word/comments.xml");
    expect(overrideNames).not.toContain("/word/footnotes.xml");
    expect(overrideNames).not.toContain("/word/endnotes.xml");
  });

  it("numbers each header and footer part override by its own emission index and kind", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text: "body" }] }],
        },
      ],
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [{ kind: "paragraph", runs: [{ text: "running head" }] }],
        },
        {
          path: "word/footer2.xml",
          kind: "footer",
          blocks: [{ kind: "paragraph", runs: [{ text: "running foot" }] }],
        },
      ],
    });
    expect(overridesOf(written)).toEqual(
      expect.arrayContaining([
        {
          partName: "/word/header1.xml",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
        },
        {
          partName: "/word/footer2.xml",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
        },
      ]),
    );
  });

  it("collects a style id referenced only by a header part's blocks into styles.xml", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text: "body" }] }],
        },
      ],
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [
            {
              kind: "paragraph",
              styleId: "Heading1",
              runs: [{ text: "styled head" }],
            },
          ],
        },
      ],
    });
    const stylesRoot = rootElement(written.parts["word/styles.xml"]);
    if (stylesRoot === undefined) {
      throw new Error("expected styles part");
    }
    const styleIds = elementsWithTag([stylesRoot], "w:style").map(
      (style) => attr(style, "w:styleId") ?? "",
    );
    expect(styleIds).toContain("Heading1");
  });

  it("writes one empty letter-sized section for content carrying no sections at all", () => {
    const written = buildDocxPackageFromContent({ sections: [] });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    if (documentRoot === undefined) {
      throw new Error("expected document part");
    }
    const body = childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    expect(elementsWithTag([body], "w:p")).toEqual([]);
    const sectPr = childrenWithTag(body, "w:sectPr")[0];
    expect(sectPr).toBeDefined();
    const pgSz =
      sectPr === undefined ? undefined : childrenWithTag(sectPr, "w:pgSz")[0];
    expect(pgSz === undefined ? undefined : attr(pgSz, "w:w")).toBe("12240");
    expect(pgSz === undefined ? undefined : attr(pgSz, "w:h")).toBe("15840");
    const pgMar =
      sectPr === undefined ? undefined : childrenWithTag(sectPr, "w:pgMar")[0];
    expect(pgMar === undefined ? undefined : attr(pgMar, "w:top")).toBe("1440");
  });
});

describe("buildDocxPackageFromContent: page-break materialisation and lifted-image placement", () => {
  function bodyOf(written: Package): XmlElement {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    return body;
  }

  function elementChildren(node: XmlElement): XmlElement[] {
    return node.children.filter(
      (child): child is XmlElement => child.type === "element",
    );
  }

  function image(): ContentBlock {
    return {
      kind: "image",
      format: "png",
      base64: TINY_PNG_BASE64,
      widthPt: 10,
      heightPt: 10,
    };
  }

  it("materialises a pending page break before a leading image as one break paragraph carrying the drawing", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "pageBreak" }, image()],
        },
      ],
    });
    const body = bodyOf(written);
    const paragraphs = elementChildren(body).filter(
      (child) => child.tag === "w:p",
    );
    expect(paragraphs).toHaveLength(1);
    const pPr = childrenWithTag(paragraphs[0]!, "w:pPr")[0];
    expect(
      pPr === undefined ? [] : childrenWithTag(pPr, "w:pageBreakBefore"),
    ).toHaveLength(1);
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    expect(runs).toHaveLength(1);
    expect(
      runs[0] === undefined ? [] : elementsWithTag([runs[0]], "w:drawing"),
    ).toHaveLength(1);
  });

  it("keeps a page break at the very end of the flow as a trailing break paragraph", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "paragraph", runs: [{ text: "last text" }] },
            { kind: "pageBreak" },
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    expect(paragraphs).toHaveLength(2);
    const pPr = childrenWithTag(paragraphs[1]!, "w:pPr")[0];
    expect(
      pPr === undefined ? [] : childrenWithTag(pPr, "w:pageBreakBefore"),
    ).toHaveLength(1);
    expect(childrenWithTag(paragraphs[1]!, "w:r")).toEqual([]);
  });

  it("places a leading image in a paragraph of its own", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [image()] }],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    expect(paragraphs).toHaveLength(1);
    expect(childrenWithTag(paragraphs[0]!, "w:r")).toHaveLength(1);
    expect(elementsWithTag([paragraphs[0]!], "w:drawing")).toHaveLength(1);
  });

  it("returns lifted images to their paragraph's trailing empty runs in order, rather than fresh ones", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "head" }, { text: "" }, { text: "" }],
            },
            image(),
            image(),
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    expect(paragraphs).toHaveLength(1);
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    // Both drawings ride inside the two trailing empty runs themselves, so no fourth run appears.
    expect(runs).toHaveLength(3);
    expect(elementsWithTag([runs[1]!], "w:drawing")).toHaveLength(1);
    expect(elementsWithTag([runs[2]!], "w:drawing")).toHaveLength(1);
  });

  it("does not reuse a trailing run that carries text for a lifted image", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "paragraph", runs: [{ text: "full text" }] },
            image(),
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    expect(runs).toHaveLength(2);
    expect(elementsWithTag([runs[0]!], "w:t")).toHaveLength(1);
    expect(elementsWithTag([runs[1]!], "w:drawing")).toHaveLength(1);
  });

  it("does not reuse a trailing empty run that sits inside an external hyperlink", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "lead" },
                { text: "", hyperlink: "https://example.com/target" },
              ],
            },
            image(),
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    const hyperlinks = childrenWithTag(paragraphs[0]!, "w:hyperlink");
    expect(hyperlinks).toHaveLength(1);
    // The drawing must not land inside the hyperlink's own wrapped run.
    expect(elementsWithTag([hyperlinks[0]!], "w:drawing")).toHaveLength(0);
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    expect(elementsWithTag([runs[runs.length - 1]!], "w:drawing")).toHaveLength(
      1,
    );
  });

  it("keeps trailing-run reuse aligned when bookmark markers interleave the runs", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "bookmark",
                    name: "Mark",
                  },
                  startRun: 0,
                  endRun: 2,
                },
              ],
            },
            image(),
          ],
        },
      ],
    });
    const paragraphs = elementChildren(bodyOf(written)).filter(
      (child) => child.tag === "w:p",
    );
    const runs = childrenWithTag(paragraphs[0]!, "w:r");
    expect(runs).toHaveLength(2);
    expect(elementsWithTag([runs[1]!], "w:drawing")).toHaveLength(1);
  });
});

describe("buildDocxPackageFromContent: internal link wrap precedence and guards", () => {
  function internalHyperlinks(
    written: Package,
  ): { anchor: string | undefined; runCount: number }[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    return elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:hyperlink",
    )
      .filter((hyperlink) =>
        hyperlink.attributes.some((a) => a.name === "w:anchor"),
      )
      .map((hyperlink) => ({
        anchor: hyperlink.attributes.find((a) => a.name === "w:anchor")?.value,
        runCount: hyperlink.children.filter(
          (child) => child.type === "element" && child.tag === "w:r",
        ).length,
      }));
  }

  it("resolves two internal links sharing one start run in favour of the longer extent", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "b" }, { text: "c" }],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "short" },
                  },
                  startRun: 0,
                  endRun: 2,
                },
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "long" },
                  },
                  startRun: 0,
                  endRun: 3,
                },
              ],
            },
          ],
        },
      ],
    });
    expect(internalHyperlinks(written)).toEqual([
      { anchor: "long", runCount: 3 },
    ]);
  });

  it("leaves an internal link plain when its own runs already carry an external hyperlink", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "outside" },
                { text: "linked", hyperlink: "https://example.com/target" },
              ],
              constructs: [
                {
                  descriptor: {
                    kind: "link",
                    target: { kind: "internal", anchor: "internal" },
                  },
                  startRun: 0,
                  endRun: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    // No w:anchor wrapper at all: the slice carries the external hyperlink's own w:hyperlink element, so the internal wrap is refused.
    expect(internalHyperlinks(written)).toEqual([]);
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const external = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:hyperlink",
    ).filter((hyperlink) =>
      hyperlink.attributes.some((a) => a.name === "r:id"),
    );
    expect(external).toHaveLength(1);
  });
});

describe("buildDocxPackageFromContent: run content, styles part, note parts, and control property XML", () => {
  function bodyParagraph(written: Package): XmlElement {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    const paragraph =
      body === undefined
        ? undefined
        : body.children.find(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:p",
          );
    if (paragraph === undefined) {
      throw new Error("expected a body paragraph");
    }
    return paragraph;
  }

  function firstRun(paragraph: XmlElement): XmlElement {
    const run = childrenWithTag(paragraph, "w:r")[0];
    if (run === undefined) {
      throw new Error("expected a run");
    }
    return run;
  }

  it("splits a run's text into w:t, w:tab, and w:br children exactly, each w:t preserving space", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "paragraph", runs: [{ text: "a\tb\nc" }] }],
        },
      ],
    });
    const run = firstRun(bodyParagraph(written));
    const summary = run.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => ({
        tag: child.tag,
        space: attr(child, "xml:space"),
        text: child.children
          .map((grandChild) =>
            grandChild.type === "text" ? grandChild.value : "",
          )
          .join(""),
      }));
    expect(summary).toEqual([
      { tag: "w:t", space: "preserve", text: "a" },
      { tag: "w:tab", space: undefined, text: "" },
      { tag: "w:t", space: "preserve", text: "b" },
      { tag: "w:br", space: undefined, text: "" },
      { tag: "w:t", space: "preserve", text: "c" },
    ]);
  });

  it("writes an empty-text run as one empty space-preserving w:t", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "paragraph", runs: [{ text: "" }] }],
        },
      ],
    });
    const run = firstRun(bodyParagraph(written));
    const textElement = childrenWithTag(run, "w:t")[0];
    expect(textElement).toBeDefined();
    expect(
      textElement === undefined ? undefined : attr(textElement, "xml:space"),
    ).toBe("preserve");
    expect(textElement?.children).toEqual([]);
  });

  it("writes one styles.xml w:style entry per referenced id, excluding Normal itself, with the basedOn scaffolding", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "paragraph", styleId: "Normal", runs: [{ text: "plain" }] },
            {
              kind: "paragraph",
              styleId: "Heading1",
              runs: [{ text: "head" }],
            },
          ],
        },
      ],
    });
    const stylesRoot = rootElement(written.parts["word/styles.xml"]);
    if (stylesRoot === undefined) {
      throw new Error("expected styles part");
    }
    expect(stylesRoot.tag).toBe("w:styles");
    expect(attr(stylesRoot, "xmlns:w")).toBe(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    );
    const styles = elementsWithTag([stylesRoot], "w:style");
    // The fixed Normal/DefaultParagraphFont scaffolding plus exactly one referenced entry — referencing Normal itself adds nothing.
    expect(styles.map((style) => attr(style, "w:styleId"))).toEqual([
      "Normal",
      "DefaultParagraphFont",
      "Heading1",
    ]);
    const heading = styles[2]!;
    expect(attr(heading, "w:type")).toBe("paragraph");
    expect(
      elementsWithTag([heading], "w:name").map((n) => attr(n, "w:val")),
    ).toEqual(["Heading1"]);
    expect(
      elementsWithTag([heading], "w:basedOn").map((n) => attr(n, "w:val")),
    ).toEqual(["Normal"]);
  });

  it("writes the comments part's root, one comment per entry, and mints a second id past the highest explicit one", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "paragraph", runs: [{ text: "body" }] }],
        },
      ],
      comments: [
        { id: "5", author: "First", text: "explicit five" },
        { id: "9", author: "Second", text: "explicit nine" },
        { author: "Third", text: "minted" },
        { author: "Fourth", text: "minted again" },
      ],
    });
    const commentsRoot = rootElement(written.parts["word/comments.xml"]);
    if (commentsRoot === undefined) {
      throw new Error("expected comments part");
    }
    expect(commentsRoot.tag).toBe("w:comments");
    expect(attr(commentsRoot, "xmlns:w")).toBe(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    );
    const entries = elementsWithTag([commentsRoot], "w:comment");
    expect(entries.map((entry) => attr(entry, "w:id"))).toEqual([
      "5",
      "9",
      "10",
      "11",
    ]);
    expect(
      entries.map((entry) =>
        elementsWithTag([entry], "w:t").map((t) =>
          t.children.map((c) => (c.type === "text" ? c.value : "")).join(""),
        ),
      ),
    ).toEqual([
      ["explicit five"],
      ["explicit nine"],
      ["minted"],
      ["minted again"],
    ]);
  });

  it("writes the endnotes part under its own root tag, keeping a note's non-normal type attribute", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "paragraph", runs: [{ text: "body" }] }],
        },
      ],
      endnotes: [
        { id: "2", type: "continuationNotice", text: "continues" },
        { text: "minted endnote" },
      ],
    });
    const notesRoot = rootElement(written.parts["word/endnotes.xml"]);
    if (notesRoot === undefined) {
      throw new Error("expected endnotes part");
    }
    expect(notesRoot.tag).toBe("w:endnotes");
    expect(attr(notesRoot, "xmlns:w")).toBe(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    );
    const entries = elementsWithTag([notesRoot], "w:endnote");
    // Word's own separator/continuationSeparator boilerplate carries ids -1 and 0 ahead of the real notes.
    expect(entries.map((entry) => attr(entry, "w:id"))).toEqual([
      "-1",
      "0",
      "2",
      "3",
    ]);
    expect(attr(entries[2]!, "w:type")).toBe("continuationNotice");
    expect(attr(entries[3]!, "w:type")).toBeUndefined();
  });

  it("spells a drop-down control's list w:dropDownList and a check-box's unchecked state w14:val 0", () => {
    const control = (descriptor: ConstructDescriptor): ContentBlock[] => [
      { kind: "constructStart", descriptor },
      { kind: "paragraph", runs: [{ text: "inside" }] },
      { kind: "constructEnd" },
    ];
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...control({
              kind: "contentControl",
              controlType: "dropDown",
              options: ["first choice", "second choice"],
            }),
            ...control({
              kind: "contentControl",
              controlType: "checkbox",
              checked: false,
            }),
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const sdtPrs = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    );
    expect(sdtPrs).toHaveLength(2);
    const dropDown = childrenWithTag(sdtPrs[0]!, "w:dropDownList")[0];
    expect(dropDown).toBeDefined();
    expect(
      dropDown === undefined
        ? []
        : elementsWithTag([dropDown], "w:listItem").map((item) => [
            attr(item, "w:displayText"),
            attr(item, "w:value"),
          ]),
    ).toEqual([
      ["first choice", "first choice"],
      ["second choice", "second choice"],
    ]);
    const checked = elementsWithTag([sdtPrs[1]!], "w14:checked")[0];
    expect(checked === undefined ? undefined : attr(checked, "w14:val")).toBe(
      "0",
    );
  });

  it("keeps a plainText control's own w:text element rather than the richText fallback", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "contentControl", controlType: "plainText" },
            },
            { kind: "paragraph", runs: [{ text: "typed" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const sdtPrs = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    );
    expect(sdtPrs).toHaveLength(1);
    expect(
      sdtPrs[0]!.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toContain("w:text");
  });
});

describe("buildDocxPackageFromContent: internal link wrap boundary shapes", () => {
  function paragraphWithLinks(
    runs: { text: string; hyperlink?: string }[],
    constructs: {
      anchor: string;
      startRun: number;
      endRun: number;
    }[],
  ): Package {
    return buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs,
              constructs: constructs.map((extent) => ({
                descriptor: {
                  kind: "link" as const,
                  target: { kind: "internal" as const, anchor: extent.anchor },
                },
                startRun: extent.startRun,
                endRun: extent.endRun,
              })),
            },
          ],
        },
      ],
    });
  }

  function anchorHyperlinks(
    written: Package,
  ): { anchor: string; runs: string }[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    return elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:hyperlink",
    )
      .filter((hyperlink) =>
        hyperlink.attributes.some((a) => a.name === "w:anchor"),
      )
      .map((hyperlink) => ({
        anchor:
          hyperlink.attributes.find((a) => a.name === "w:anchor")?.value ?? "",
        runs: hyperlink.children
          .filter(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:r",
          )
          .map((run) =>
            run.children
              .filter(
                (c): c is XmlElement => c.type === "element" && c.tag === "w:t",
              )
              .map((t) =>
                t.children
                  .map((x) => (x.type === "text" ? x.value : ""))
                  .join(""),
              )
              .join(""),
          )
          .join(","),
      }));
  }

  const runs4 = [{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }];

  it("wraps each of two adjacent internal links, losing neither descriptor", () => {
    const written = paragraphWithLinks(runs4, [
      { anchor: "one", startRun: 0, endRun: 2 },
      { anchor: "two", startRun: 2, endRun: 4 },
    ]);
    expect(anchorHyperlinks(written)).toEqual([
      { anchor: "one", runs: "a,b" },
      { anchor: "two", runs: "c,d" },
    ]);
  });

  it("leaves a crossing internal link plain while the earlier-starting extent wraps", () => {
    const written = paragraphWithLinks(runs4, [
      { anchor: "one", startRun: 0, endRun: 2 },
      { anchor: "crosses", startRun: 1, endRun: 3 },
    ]);
    expect(anchorHyperlinks(written)).toEqual([{ anchor: "one", runs: "a,b" }]);
  });

  it("writes a zero-width internal link plain, both at a run boundary and at the paragraph's start", () => {
    // A zero-width extent covers no run at all: at startRun 0 its end's position lookup (endRun - 1) names no run, and at startRun 1 its end resolves to the run BEFORE its own start, so either way there is no slice to wrap and the descriptor alone is lost.
    const atStart = paragraphWithLinks(
      [{ text: "a" }, { text: "b" }],
      [{ anchor: "zero-at-start", startRun: 0, endRun: 0 }],
    );
    expect(anchorHyperlinks(atStart)).toEqual([]);
    const betweenRuns = paragraphWithLinks(
      [{ text: "a" }, { text: "b" }],
      [{ anchor: "zero-between", startRun: 1, endRun: 1 }],
    );
    expect(anchorHyperlinks(betweenRuns)).toEqual([]);
  });

  it("writes an internal link whose start names no run plain rather than wrapping the tail", () => {
    // startRun === endRun === runs.length passes the extent contract (only endRun > runs.length is beyond it), so the start's lookup finds no element and the link is dropped rather than wrapping a tail slice it never named.
    const written = paragraphWithLinks(
      [{ text: "a" }, { text: "b" }],
      [{ anchor: "past-the-end", startRun: 2, endRun: 2 }],
    );
    expect(anchorHyperlinks(written)).toEqual([]);
  });

  it("wraps an internal link covering exactly one run", () => {
    const written = paragraphWithLinks(
      [{ text: "a" }, { text: "b" }],
      [{ anchor: "solo", startRun: 1, endRun: 2 }],
    );
    expect(anchorHyperlinks(written)).toEqual([{ anchor: "solo", runs: "b" }]);
  });
});

describe("buildDocxPackageFromContent: media and embedded-object emission", () => {
  function imageBlock(
    format: "png" | "jpeg" | "gif",
    base64: string,
  ): Extract<ContentBlock, { kind: "image" }> {
    return { kind: "image", format, base64, widthPt: 72, heightPt: 36 };
  }

  function documentRels(written: Package): XmlElement[] {
    const relsRoot = rootElement(written.parts["word/_rels/document.xml.rels"]);
    if (relsRoot === undefined) {
      throw new Error("expected document rels part");
    }
    return elementsWithTag([relsRoot], "Relationship");
  }

  function contentTypesDefaults(
    written: Package,
  ): { extension: string; contentType: string }[] {
    const typesRoot = rootElement(written.parts["[Content_Types].xml"]);
    if (typesRoot === undefined) {
      throw new Error("expected content types part");
    }
    return elementsWithTag([typesRoot], "Default").map((entry) => ({
      extension: attr(entry, "Extension") ?? "",
      contentType: attr(entry, "ContentType") ?? "",
    }));
  }

  function blipEmbeds(written: Package): string[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    return elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "a:blip",
    ).map((blip) => attr(blip, "r:embed") ?? "");
  }

  it("names each raster format's media file with its own extension and declares the matching content-type Default", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            imageBlock("jpeg", "jpegbytes"),
            imageBlock("gif", "gifbytes"),
          ],
        },
      ],
    });
    expect(Object.keys(written.parts)).toEqual(
      expect.arrayContaining([
        "word/media/image1.jpeg",
        "word/media/image2.gif",
      ]),
    );
    const defaults = contentTypesDefaults(written);
    expect(defaults).toContainEqual({
      extension: "jpeg",
      contentType: "image/jpeg",
    });
    expect(defaults).toContainEqual({
      extension: "gif",
      contentType: "image/gif",
    });
    expect(defaults.filter((entry) => entry.extension === "png")).toEqual([]);
    const imageRels = documentRels(written).filter(
      (rel) => attr(rel, "Type") === IMAGE_REL,
    );
    expect(imageRels.map((rel) => attr(rel, "Target"))).toEqual([
      "media/image1.jpeg",
      "media/image2.gif",
    ]);
  });

  it("shares one media file and one relationship across an image repeated in the document", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            imageBlock("png", TINY_PNG_BASE64),
            imageBlock("png", TINY_PNG_BASE64),
          ],
        },
      ],
    });
    const mediaFiles = Object.keys(written.parts).filter((name) =>
      name.startsWith("word/media/"),
    );
    expect(mediaFiles).toEqual(["word/media/image1.png"]);
    expect(new Set(blipEmbeds(written)).size).toBe(1);
    expect(
      documentRels(written).filter((rel) => attr(rel, "Type") === IMAGE_REL),
    ).toHaveLength(1);
  });

  it("refuses an svg image block rather than writing a blip no Word can render", () => {
    expect(() =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              imageBlock("png", TINY_PNG_BASE64),
              { ...imageBlock("png", TINY_PNG_BASE64), format: "svg" },
            ],
          },
        ],
      }),
    ).toThrow(
      /an image block in svg format has no OOXML blip this writer can produce/,
    );
  });

  const embeddedWordprocessing = (): Extract<
    ContentBlock,
    { kind: "embeddedObject" }
  >["document"] => ({
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [{ kind: "paragraph", runs: [{ text: "nested" }] }],
      },
    ],
  });

  function embeddedObjectBlock(
    document: ReturnType<typeof embeddedWordprocessing>,
    widthPt = 100,
  ): Extract<ContentBlock, { kind: "embeddedObject" }> {
    return {
      kind: "embeddedObject",
      objectKind: "wordprocessing",
      document,
      // The frame's origin is part of the schema's Box, but this writer reads only the extent: w:dxaOrig/w:dyaOrig carry the width and height, and nothing emits xPt/yPt.
      frame: { xPt: 0, yPt: 0, widthPt, heightPt: 60 },
    };
  }

  function oleObjects(written: Package): XmlElement[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    return elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "o:OLEObject",
    );
  }

  it("serialises an embedded wordprocessing document into one shared payload part with Word's own activation attributes", () => {
    const nested = embeddedWordprocessing();
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [embeddedObjectBlock(nested), embeddedObjectBlock(nested)],
        },
      ],
    });
    const embeddingFiles = Object.keys(written.parts).filter((name) =>
      name.startsWith("word/embeddings/"),
    );
    expect(embeddingFiles).toEqual(["word/embeddings/oleObject1.docx"]);
    const objects = oleObjects(written);
    expect(objects).toHaveLength(2);
    for (const object of objects) {
      expect(attr(object, "Type")).toBe("Embed");
      expect(attr(object, "ProgID")).toBe("Word.Document.12");
      expect(attr(object, "DrawAspect")).toBe("Content");
      expect(attr(object, "r:id")).toBe(
        objects[0] === undefined ? "" : attr(objects[0], "r:id"),
      );
    }
    const objectElements = elementsWithTag(
      rootElement(written.parts["word/document.xml"]) === undefined
        ? []
        : [rootElement(written.parts["word/document.xml"])!],
      "w:object",
    );
    expect(objectElements.map((element) => attr(element, "w:dxaOrig"))).toEqual(
      ["2000", "2000"],
    );
    expect(objectElements.map((element) => attr(element, "w:dyaOrig"))).toEqual(
      ["1200", "1200"],
    );
    const typesRoot = rootElement(written.parts["[Content_Types].xml"]);
    const overrides =
      typesRoot === undefined
        ? []
        : elementsWithTag([typesRoot], "Override").map((o) => [
            attr(o, "PartName") ?? "",
            attr(o, "ContentType") ?? "",
          ]);
    expect(overrides).toContainEqual([
      "/word/embeddings/oleObject1.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });

  it("numbers distinct embedded payloads sequentially", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            embeddedObjectBlock(embeddedWordprocessing(), 100),
            embeddedObjectBlock(
              {
                kind: "wordprocessing",
                metadata: {},
                sections: [
                  {
                    pageSize: { widthPt: 612, heightPt: 792 },
                    margins: {
                      topPt: 72,
                      rightPt: 72,
                      bottomPt: 72,
                      leftPt: 72,
                    },
                    blocks: [{ kind: "paragraph", runs: [{ text: "other" }] }],
                  },
                ],
              },
              120,
            ),
          ],
        },
      ],
    });
    const embeddingFiles = Object.keys(written.parts).filter((name) =>
      name.startsWith("word/embeddings/"),
    );
    expect(embeddingFiles).toEqual([
      "word/embeddings/oleObject1.docx",
      "word/embeddings/oleObject2.docx",
    ]);
  });

  it("refuses an embedded drawing document with the exact reason", () => {
    expect(() =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              {
                kind: "embeddedObject",
                objectKind: "drawing",
                document: { kind: "drawing", metadata: {}, pages: [] },
                frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 60 },
              },
            ],
          },
        ],
      }),
    ).toThrow(
      /an embedded object carrying a drawing document has no OOXML OLE payload this writer can produce/,
    );
  });

  it("refuses an embedded presentation with no injected serialiser, and serialises it through the port when one is injected", () => {
    const presentation: Extract<
      ContentBlock,
      { kind: "embeddedObject" }
    >["document"] = {
      kind: "presentation",
      metadata: {},
      slides: [],
    };
    const block: Extract<ContentBlock, { kind: "embeddedObject" }> = {
      kind: "embeddedObject",
      objectKind: "presentation",
      document: presentation,
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 60 },
    };
    expect(() =>
      buildDocxPackageFromContent({
        sections: [{ ...emptyBodySection(), blocks: [block] }],
      }),
    ).toThrow(
      /an embedded object carrying a presentation document has no serialiser/,
    );
    const written = buildDocxPackageFromContent(
      { sections: [{ ...emptyBodySection(), blocks: [block] }] },
      {
        serialiseEmbeddedPresentation: () =>
          new Uint8Array([1, 2, 3, 4]).slice(),
      },
    );
    expect(Object.keys(written.parts)).toContain(
      "word/embeddings/oleObject1.pptx",
    );
    const object = oleObjects(written)[0];
    expect(object === undefined ? "" : attr(object, "ProgID")).toBe(
      "PowerPoint.Show.12",
    );
  });
});

describe("buildDocxPackageFromContent: run and paragraph property XML exactness", () => {
  function singleParagraph(written: Package): XmlElement {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    const paragraph =
      body === undefined
        ? undefined
        : body.children.find(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:p",
          );
    if (paragraph === undefined) {
      throw new Error("expected a body paragraph");
    }
    return paragraph;
  }

  function runProperties(
    written: Package,
  ): { tag: string; val: string | undefined }[] {
    const paragraph = singleParagraph(written);
    const run = childrenWithTag(paragraph, "w:r")[0];
    if (run === undefined) {
      throw new Error("expected a run");
    }
    const rPr = childrenWithTag(run, "w:rPr")[0];
    if (rPr === undefined) {
      throw new Error("expected run properties");
    }
    return rPr.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => ({ tag: child.tag, val: attr(child, "w:val") }));
  }

  function paragraphProperties(
    written: Package,
  ): { tag: string; attrs: Record<string, string> }[] {
    const paragraph = singleParagraph(written);
    const pPr = childrenWithTag(paragraph, "w:pPr")[0];
    if (pPr === undefined) {
      throw new Error("expected paragraph properties");
    }
    return pPr.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => ({
        tag: child.tag,
        attrs: Object.fromEntries(
          child.attributes.map((attribute) => [
            attribute.name,
            attribute.value,
          ]),
        ),
      }));
  }

  it("spells every resolved run toggle with its own on/off w:val, including the explicit off spellings", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [
                {
                  text: "styled",
                  bold: true,
                  italic: false,
                  strike: true,
                  underline: true,
                  direction: "rtl",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(runProperties(written)).toEqual([
      { tag: "w:b", val: "1" },
      { tag: "w:i", val: "0" },
      { tag: "w:strike", val: "1" },
      { tag: "w:u", val: "single" },
      { tag: "w:rtl", val: "1" },
    ]);
  });

  it("spells a resolved left-to-right run's direction with the rtl off spelling and an absent underline as none", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "plain", underline: false, direction: "ltr" }],
            },
          ],
        },
      ],
    });
    expect(runProperties(written)).toEqual([
      { tag: "w:u", val: "none" },
      { tag: "w:rtl", val: "0" },
    ]);
  });

  it("writes a positive first-line indent as w:firstLine, a negative one as the signed inverse w:hanging, and zero as firstLine zero", () => {
    const build = (indentFirstLinePt: number) =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              {
                kind: "paragraph",
                runs: [{ text: "indented" }],
                indentFirstLinePt,
              },
            ],
          },
        ],
      });
    const positive = paragraphProperties(build(24));
    expect(positive.find((child) => child.tag === "w:ind")?.attrs).toEqual({
      "w:firstLine": "480",
    });
    const negative = paragraphProperties(build(-24));
    expect(negative.find((child) => child.tag === "w:ind")?.attrs).toEqual({
      "w:hanging": "480",
    });
    const zero = paragraphProperties(build(0));
    expect(zero.find((child) => child.tag === "w:ind")?.attrs).toEqual({
      "w:firstLine": "0",
    });
  });

  it("spells a paragraph's line spacing with the auto rule and its direction with the bidi on/off spelling", () => {
    const rtl = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: " rtl" }],
              lineSpacing: 1.5,
              direction: "rtl",
            },
          ],
        },
      ],
    });
    expect(paragraphProperties(rtl)).toEqual([
      { tag: "w:bidi", attrs: { "w:val": "1" } },
      { tag: "w:spacing", attrs: { "w:line": "360", "w:lineRule": "auto" } },
    ]);
    const ltr = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "ltr" }],
              lineSpacing: 2,
              direction: "ltr",
            },
          ],
        },
      ],
    });
    expect(paragraphProperties(ltr)).toEqual([
      { tag: "w:bidi", attrs: { "w:val": "0" } },
      { tag: "w:spacing", attrs: { "w:line": "480", "w:lineRule": "auto" } },
    ]);
  });
});

describe("buildDocxPackageFromContent: run-level construct marker XML exactness", () => {
  function bodyParagraph(written: Package): XmlElement {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    const paragraph =
      body === undefined
        ? undefined
        : body.children.find(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:p",
          );
    if (paragraph === undefined) {
      throw new Error("expected a body paragraph");
    }
    return paragraph;
  }

  function childTags(paragraph: XmlElement): string[] {
    return paragraph.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => child.tag);
  }

  it("mints increasing bookmark ids across two point bookmarks in one paragraph", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "marked" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "bookmark",
                    name: "one",
                  },
                  startRun: 0,
                  endRun: 0,
                },
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "bookmark",
                    name: "two",
                  },
                  startRun: 0,
                  endRun: 0,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    expect(childTags(paragraph)).toEqual([
      "w:bookmarkStart",
      "w:bookmarkEnd",
      "w:bookmarkStart",
      "w:bookmarkEnd",
      "w:r",
    ]);
    const ids = paragraph.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => attr(child, "w:id"))
      .filter((id): id is string => id !== undefined);
    expect(ids).toEqual(["1", "1", "2", "2"]);
    const names = paragraph.children
      .filter(
        (child): child is XmlElement =>
          child.type === "element" && child.tag === "w:bookmarkStart",
      )
      .map((child) => attr(child, "w:name"));
    expect(names).toEqual(["one", "two"]);
    // A point bookmark mutates nothing about the run it sits at: the run keeps exactly its own text child.
    const run = childrenWithTag(paragraph, "w:r")[0]!;
    expect(
      run.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:t"]);
  });

  it("writes a run-level field's characters with the begin/instruction/separate group at its opening boundary and the typed end at its closing boundary", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "result" }, { text: "after" }],
              constructs: [
                {
                  descriptor: { kind: "field", instruction: " PAGE " },
                  startRun: 0,
                  endRun: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    expect(childTags(paragraph)).toEqual([
      "w:r",
      "w:r",
      "w:r",
      "w:r",
      "w:r",
      "w:r",
    ]);
    const fldChars = elementsWithTag([paragraph], "w:fldChar").map((run) =>
      attr(run, "w:fldCharType"),
    );
    expect(fldChars).toEqual(["begin", "separate", "end"]);
    const instr = elementsWithTag([paragraph], "w:instrText")[0]!;
    expect(attr(instr, "xml:space")).toBe("preserve");
    expect(
      instr.children
        .map((child) => (child.type === "text" ? child.value : ""))
        .join(""),
    ).toBe(" PAGE ");
  });

  it("writes a point field's four characters as one adjacent group before the run at its own position", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "first" }, { text: "second" }],
              constructs: [
                {
                  descriptor: { kind: "field", instruction: "x" },
                  startRun: 1,
                  endRun: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    // The four characters all precede the second run, begin to end in order.
    const described = paragraph.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => {
        if (child.tag !== "w:r") {
          return child.tag;
        }
        const fldChar = childrenWithTag(child, "w:fldChar")[0];
        if (fldChar !== undefined) {
          return `fld:${attr(fldChar, "w:fldCharType")}`;
        }
        if (childrenWithTag(child, "w:instrText").length > 0) {
          return "instr";
        }
        return "run";
      });
    expect(described).toEqual([
      "run",
      "fld:begin",
      "instr",
      "fld:separate",
      "fld:end",
      "run",
    ]);
  });

  it("injects a note reference mark into the run at its own index and refuses one that names no run", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "before" }, { text: "" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "footnote",
                    name: "3",
                  },
                  startRun: 1,
                  endRun: 1,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    const secondRun = childrenWithTag(paragraph, "w:r")[1]!;
    expect(
      secondRun.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:t", "w:footnoteReference"]);
    const reference = childrenWithTag(secondRun, "w:footnoteReference")[0]!;
    expect(attr(reference, "w:id")).toBe("3");
    expect(() =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              {
                kind: "paragraph",
                runs: [{ text: "only" }],
                constructs: [
                  {
                    descriptor: {
                      kind: "anchor",
                      anchorType: "comment",
                      name: "9",
                    },
                    startRun: 1,
                    endRun: 1,
                  },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow(
      /a comment reference at run index 1 of a paragraph does not name a real run/,
    );
  });

  it("writes a comment extent's halves with the comments.xml id verbatim", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [{ text: "a" }, { text: "b" }],
              constructs: [
                {
                  descriptor: {
                    kind: "anchor",
                    anchorType: "comment",
                    name: "4",
                  },
                  startRun: 0,
                  endRun: 2,
                },
              ],
            },
          ],
        },
      ],
    });
    const paragraph = bodyParagraph(written);
    expect(childTags(paragraph)).toEqual([
      "w:commentRangeStart",
      "w:r",
      "w:r",
      "w:commentRangeEnd",
    ]);
    expect(
      attr(childrenWithTag(paragraph, "w:commentRangeStart")[0]!, "w:id"),
    ).toBe("4");
    expect(
      attr(childrenWithTag(paragraph, "w:commentRangeEnd")[0]!, "w:id"),
    ).toBe("4");
  });
});

describe("buildDocxPackageFromContent: table grid and vertical-merge arithmetic", () => {
  interface TableFixtureCell {
    blocks: ContentBlock[];
    rowSpan?: number;
    colSpan?: number;
    borders?: Extract<
      ContentBlock,
      { kind: "table" }
    >["rows"][number]["cells"][number]["borders"];
  }

  interface TableFixtureRow {
    cells: TableFixtureCell[];
    heightPt?: number;
    isHeader?: boolean;
  }

  function tableOf(
    rows: TableFixtureRow[],
    columnWidthsPt: number[] = [100, 100],
  ): Extract<ContentBlock, { kind: "table" }> {
    return {
      kind: "table",
      rows,
      columns: columnWidthsPt.map((widthPt) => ({ widthPt })),
    };
  }

  function writtenTable(written: Package): XmlElement {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const table =
      documentRoot === undefined
        ? undefined
        : elementsWithTag([documentRoot], "w:tbl")[0];
    if (table === undefined) {
      throw new Error("expected a table");
    }
    return table;
  }

  function cellShapes(
    written: Package,
  ): { span: string | undefined; merge: string | undefined }[][] {
    const rows = elementsWithTag([writtenTable(written)], "w:tr");
    return rows.map((row) =>
      elementsWithTag([row], "w:tc").map((cell) => {
        const tcPr = childrenWithTag(cell, "w:tcPr")[0];
        if (tcPr === undefined) {
          return { span: undefined, merge: undefined };
        }
        const gridSpan = childrenWithTag(tcPr, "w:gridSpan")[0];
        const vMerge = childrenWithTag(tcPr, "w:vMerge")[0];
        return {
          span: gridSpan === undefined ? undefined : attr(gridSpan, "w:val"),
          merge:
            vMerge === undefined
              ? undefined
              : (attr(vMerge, "w:val") ?? "(bare)"),
        };
      }),
    );
  }

  it("restarts a vertical merge's anchor, continues its covered rows, and treats the row after the merge as a fresh anchor", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf([
              { cells: [{ blocks: [], rowSpan: 2 }, { blocks: [] }] },
              { cells: [{ blocks: [] }, { blocks: [] }] },
              { cells: [{ blocks: [] }, { blocks: [] }] },
            ]),
          ],
        },
      ],
    });
    expect(cellShapes(written)).toEqual([
      [
        { merge: "restart", span: undefined },
        { merge: undefined, span: undefined },
      ],
      [
        { merge: "(bare)", span: undefined },
        { merge: undefined, span: undefined },
      ],
      [
        { merge: undefined, span: undefined },
        { merge: undefined, span: undefined },
      ],
    ]);
  });

  it("continues both columns of two side-by-side vertical merges at their own grid columns", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf([
              {
                cells: [
                  { blocks: [], rowSpan: 2 },
                  { blocks: [], rowSpan: 2 },
                ],
              },
              { cells: [{ blocks: [] }, { blocks: [] }] },
            ]),
          ],
        },
      ],
    });
    expect(cellShapes(written)).toEqual([
      [
        { merge: "restart", span: undefined },
        { merge: "restart", span: undefined },
      ],
      [
        { merge: "(bare)", span: undefined },
        { merge: "(bare)", span: undefined },
      ],
    ]);
  });

  it("continues a merge at the grid column a leading colSpan anchor skips past", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf(
              [
                {
                  cells: [
                    { blocks: [], colSpan: 2, rowSpan: 2 },
                    { blocks: [] },
                    { blocks: [], rowSpan: 2 },
                  ],
                },
                { cells: [{ blocks: [] }, { blocks: [] }, { blocks: [] }] },
              ],
              [100, 100, 100],
            ),
          ],
        },
      ],
    });
    expect(cellShapes(written)).toEqual([
      [
        { merge: "restart", span: "2" },
        { merge: "restart", span: undefined },
      ],
      [
        { merge: "(bare)", span: "2" },
        { merge: "(bare)", span: undefined },
      ],
    ]);
  });

  it("writes each of a cell's four border edges under its own side tag", () => {
    const border = (style?: "solid" | "dashed" | "dotted" | "double") => ({
      style,
      widthPt: 1,
      color: rgbHexToColor("112233"),
    });
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf([
              {
                cells: [
                  {
                    blocks: [],
                    borders: {
                      top: border(),
                      left: border("dashed"),
                      bottom: border("dotted"),
                      right: border("double"),
                    },
                  },
                ],
              },
            ]),
          ],
        },
      ],
    });
    const edges = elementsWithTag([writtenTable(written)], "w:tcBorders");
    expect(edges).toHaveLength(1);
    expect(
      edges[0]!.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => [child.tag, attr(child, "w:val"), attr(child, "w:sz")]),
    ).toEqual([
      ["w:top", "single", "8"],
      ["w:left", "dashed", "8"],
      ["w:bottom", "dotted", "8"],
      ["w:right", "double", "8"],
    ]);
  });

  it("writes a row's own height in the trPr/trHeight spelling and the grid's column widths in twips", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf([{ cells: [{ blocks: [] }], heightPt: 30 }], [72, 144]),
          ],
        },
      ],
    });
    const table = writtenTable(written);
    const row = elementsWithTag([table], "w:tr")[0]!;
    const trPr = childrenWithTag(row, "w:trPr")[0]!;
    expect(attr(childrenWithTag(trPr, "w:trHeight")[0]!, "w:val")).toBe("600");
    const grid = childrenWithTag(table, "w:tblGrid")[0]!;
    expect(
      elementsWithTag([grid], "w:gridCol").map((col) => attr(col, "w:w")),
    ).toEqual(["1440", "2880"]);
  });

  it("writes a header row as a bare w:tblHeader, after the row's own w:trHeight", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf(
              [
                { cells: [{ blocks: [] }], heightPt: 30, isHeader: true },
                { cells: [{ blocks: [] }] },
              ],
              [72],
            ),
          ],
        },
      ],
    });
    const rows = elementsWithTag([writtenTable(written)], "w:tr");
    const headerTrPr = childrenWithTag(rows[0]!, "w:trPr")[0]!;
    expect(
      headerTrPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:trHeight", "w:tblHeader"]);
    expect(
      attr(childrenWithTag(headerTrPr, "w:tblHeader")[0]!, "w:val"),
    ).toBeUndefined();
    expect(childrenWithTag(rows[1]!, "w:trPr")).toHaveLength(0);
  });

  it("writes a header row carrying no height as a w:trPr holding w:tblHeader alone", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            tableOf([{ cells: [{ blocks: [] }], isHeader: true }], [72]),
          ],
        },
      ],
    });
    const row = elementsWithTag([writtenTable(written)], "w:tr")[0]!;
    const trPr = childrenWithTag(row, "w:trPr")[0]!;
    expect(
      trPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:tblHeader"]);
  });
});

describe("buildDocxPackageFromContent: tracked-change paragraph marks and ids", () => {
  function bodyParagraphs(written: Package): XmlElement[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    return body.children.filter(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:p",
    );
  }

  const insertion = {
    kind: "provenance" as const,
    change: "insertion" as const,
    author: "Editor",
    dateIso: "2026-09-16T10:00:00Z",
  };

  it("marks both the paragraph mark and the runs of every paragraph in a tracked-change extent, minting one id per element", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "constructStart", descriptor: insertion },
            { kind: "paragraph", runs: [{ text: "first" }] },
            { kind: "paragraph", runs: [{ text: "second" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraphs = bodyParagraphs(written);
    expect(paragraphs).toHaveLength(2);
    const ids: string[] = [];
    for (const paragraph of paragraphs) {
      const pPr = childrenWithTag(paragraph, "w:pPr")[0]!;
      const rPr = childrenWithTag(pPr, "w:rPr")[0]!;
      const markChange = elementsWithTag([rPr], "w:ins")[0]!;
      expect(attr(markChange, "w:author")).toBe("Editor");
      expect(attr(markChange, "w:date")).toBe("2026-09-16T10:00:00Z");
      ids.push(attr(markChange, "w:id") ?? "");
      const runWrapper = childrenWithTag(paragraph, "w:ins")[0]!;
      expect(attr(runWrapper, "w:author")).toBe("Editor");
      ids.push(attr(runWrapper, "w:id") ?? "");
    }
    expect(ids).toEqual(["1", "2", "3", "4"]);
  });

  it("gives a tracked paragraph with no other properties an empty pPr carrying only the change", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "constructStart", descriptor: insertion },
            { kind: "paragraph", runs: [{ text: "bare" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraph = bodyParagraphs(written)[0]!;
    const pPr = childrenWithTag(paragraph, "w:pPr")[0]!;
    expect(
      pPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:rPr"]);
  });

  it("falls back to the unknown author spelling when a change carries none, and omits w:date when there is no date", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: {
                ...insertion,
                author: undefined,
                dateIso: undefined,
              },
            },
            { kind: "paragraph", runs: [{ text: "anon" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraph = bodyParagraphs(written)[0]!;
    const wrapper = childrenWithTag(paragraph, "w:ins")[0]!;
    expect(attr(wrapper, "w:author")).toBe("Unknown");
    expect(
      wrapper.attributes.find((attribute) => attribute.name === "w:date"),
    ).toBeUndefined();
  });

  it("writes a moveFrom change under its own tag and leaves a formatChange extent's content unwrapped", () => {
    const moveWritten = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { ...insertion, change: "moveFrom" },
            },
            { kind: "paragraph", runs: [{ text: "moved" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const moveParagraph = bodyParagraphs(moveWritten)[0]!;
    expect(childrenWithTag(moveParagraph, "w:moveFrom")).toHaveLength(1);

    const formatWritten = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { ...insertion, change: "formatChange" },
            },
            {
              kind: "paragraph",
              styleId: "Styled",
              runs: [{ text: "reformatted" }],
            },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const formatParagraph = bodyParagraphs(formatWritten)[0]!;
    expect(childrenWithTag(formatParagraph, "w:ins")).toHaveLength(0);
    expect(childrenWithTag(formatParagraph, "w:del")).toHaveLength(0);
    const pPr = childrenWithTag(formatParagraph, "w:pPr")[0]!;
    expect(
      elementsWithTag([pPr], "w:pStyle").map((style) => attr(style, "w:val")),
    ).toEqual(["Styled"]);
    expect(childrenWithTag(pPr, "w:rPr")).toHaveLength(0);
  });

  it("deletes a tracked deletion's runs through the delText spelling", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { ...insertion, change: "deletion" },
            },
            { kind: "paragraph", runs: [{ text: "gone" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraph = bodyParagraphs(written)[0]!;
    const wrapper = childrenWithTag(paragraph, "w:del")[0]!;
    expect(
      elementsWithTag([wrapper], "w:delText").map((t) =>
        t.children
          .map((child) => (child.type === "text" ? child.value : ""))
          .join(""),
      ),
    ).toEqual(["gone"]);
  });
});

describe("buildDocxPackageFromContent: content-control property edges", () => {
  function sdtProperties(written: Package): XmlElement[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    return elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    );
  }

  function controlBlocks(descriptor: ConstructDescriptor): ContentBlock[] {
    return [
      { kind: "constructStart", descriptor },
      { kind: "paragraph", runs: [{ text: "inside" }] },
      { kind: "constructEnd" },
    ];
  }

  it("writes the alias, tag, and each lock spelling under their own elements", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "richText",
              alias: "Named",
              tag: "tagged",
              lock: "both",
            }),
          ],
        },
      ],
    });
    const sdtPr = sdtProperties(written)[0]!;
    expect(
      sdtPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => [child.tag, attr(child, "w:val")]),
    ).toEqual([
      ["w:alias", "Named"],
      ["w:tag", "tagged"],
      ["w:lock", "sdtContentLocked"],
      ["w:richText", undefined],
    ]);
  });

  it("spells an index control as the table-of-contents docPartObj gallery with its unique marker", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({ kind: "contentControl", controlType: "index" }),
          ],
        },
      ],
    });
    const sdtPr = sdtProperties(written)[0]!;
    const docPartObj = childrenWithTag(sdtPr, "w:docPartObj")[0]!;
    expect(
      elementsWithTag([docPartObj], "w:docPartGallery").map((gallery) =>
        attr(gallery, "w:val"),
      ),
    ).toEqual(["Table of Contents"]);
    expect(childrenWithTag(docPartObj, "w:docPartUnique")).toHaveLength(1);
  });

  it("spells a combo box under its own tag with the same list items a drop-down carries", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "comboBox",
              options: ["alpha", "beta"],
            }),
          ],
        },
      ],
    });
    const sdtPr = sdtProperties(written)[0]!;
    const comboBox = childrenWithTag(sdtPr, "w:comboBox")[0]!;
    expect(comboBox).toBeDefined();
    expect(
      elementsWithTag([comboBox], "w:listItem").map((item) => [
        attr(item, "w:displayText"),
        attr(item, "w:value"),
      ]),
    ).toEqual([
      ["alpha", "alpha"],
      ["beta", "beta"],
    ]);
  });

  it("writes a date control's full date when carried and no attribute when absent", () => {
    const withDate = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "date",
              value: "2026-09-16T09:00:00Z",
            }),
          ],
        },
      ],
    });
    const dateElement = childrenWithTag(
      sdtProperties(withDate)[0]!,
      "w:date",
    )[0]!;
    expect(attr(dateElement, "w:fullDate")).toBe("2026-09-16T09:00:00Z");
    const withoutDate = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({ kind: "contentControl", controlType: "date" }),
          ],
        },
      ],
    });
    const bareDate = childrenWithTag(
      sdtProperties(withoutDate)[0]!,
      "w:date",
    )[0]!;
    expect(bareDate.attributes).toEqual([]);
  });

  it("re-emits a degraded gallery's docPartObj residue in place of the richText element and refuses residue that is not XML", () => {
    const galleryResidue = `<w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj>`;
    const restored = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "richText",
              source: { format: "docx", xml: galleryResidue },
            }),
          ],
        },
      ],
    });
    const sdtPr = sdtProperties(restored)[0]!;
    const docPartObj = childrenWithTag(sdtPr, "w:docPartObj")[0]!;
    expect(
      elementsWithTag([docPartObj], "w:docPartGallery").map((gallery) =>
        attr(gallery, "w:val"),
      ),
    ).toEqual(["Table of Contents"]);

    expect(() =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              ...controlBlocks({
                kind: "contentControl",
                controlType: "richText",
                source: { format: "docx", xml: "not xml <" },
              }),
            ],
          },
        ],
      }),
    ).toThrow(/carries docx residue that does not parse as XML: not xml </);
  });

  it("keeps the semantic type element for residue that is not a restorable gallery shape", () => {
    const build = (xml: string) =>
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              ...controlBlocks({
                kind: "contentControl",
                controlType: "richText",
                source: { format: "docx", xml },
              }),
            ],
          },
        ],
      });
    // Two top-level nodes: not the single element a restoration requires.
    const twoNodes = build("<w:docPartObj/><w:docPartObj/>");
    expect(
      sdtProperties(twoNodes)[0]!
        .children.filter(
          (child): child is XmlElement => child.type === "element",
        )
        .map((child) => child.tag),
    ).toEqual(["w:richText"]);
    // One element of the wrong tag: same fallback.
    const wrongTag = build("<w:alias/>");
    expect(
      sdtProperties(wrongTag)[0]!
        .children.filter(
          (child): child is XmlElement => child.type === "element",
        )
        .map((child) => child.tag),
    ).toEqual(["w:richText"]);
  });

  it("ignores docx residue on a control that is not richText, since the gate is the mint condition", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            ...controlBlocks({
              kind: "contentControl",
              controlType: "plainText",
              source: {
                format: "docx",
                xml: '<w:docPartObj><w:docPartGallery w:val="Table of Contents"/></w:docPartObj>',
              },
            }),
          ],
        },
      ],
    });
    expect(
      sdtProperties(written)[0]!
        .children.filter(
          (child): child is XmlElement => child.type === "element",
        )
        .map((child) => child.tag),
    ).toEqual(["w:text"]);
  });
});

describe("buildDocxPackageFromContent: flow assembly and section breaks", () => {
  function bodyElements(written: Package): { tag: string; summary: string }[] {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    return body.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => {
        if (child.tag === "w:p") {
          const pPr = childrenWithTag(child, "w:pPr")[0];
          const breakBefore =
            pPr !== undefined &&
            childrenWithTag(pPr, "w:pageBreakBefore").length > 0;
          const hasSectPr =
            pPr !== undefined && childrenWithTag(pPr, "w:sectPr").length > 0;
          const runCount = childrenWithTag(child, "w:r").length;
          const objectCount = elementsWithTag([child], "w:object").length;
          const drawingCount = elementsWithTag([child], "w:drawing").length;
          return {
            tag: "w:p",
            summary: `p${breakBefore ? "+break" : ""}${hasSectPr ? "+sectPr" : ""}:r${runCount}:o${objectCount}:d${drawingCount}`,
          };
        }
        return { tag: child.tag, summary: "" };
      });
  }

  it("clears the pending page break once the table before the next paragraph has carried it", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "pageBreak" },
            {
              kind: "table",
              rows: [{ cells: [{ blocks: [] }] }],
              columns: [{ widthPt: 100 }],
            },
            { kind: "paragraph", runs: [{ text: "after" }] },
          ],
        },
      ],
    });
    expect(bodyElements(written)).toEqual([
      { tag: "w:p", summary: "p+break:r0:o0:d0" },
      { tag: "w:tbl", summary: "" },
      { tag: "w:p", summary: "p:r1:o0:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
  });

  it("materialises a pending break before an embedded object, then places the object inside that break paragraph", () => {
    const nested: Extract<
      ContentBlock,
      { kind: "embeddedObject" }
    >["document"] = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "pageBreak" },
            {
              kind: "embeddedObject",
              objectKind: "wordprocessing",
              document: nested,
              frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 60 },
            },
          ],
        },
      ],
    });
    expect(bodyElements(written)).toEqual([
      { tag: "w:p", summary: "p+break:r1:o1:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
  });

  it("appends an embedded object with no trailing empty run to its preceding paragraph, and one with no paragraph at all to a fresh paragraph", () => {
    const nested = (
      text: string,
    ): Extract<ContentBlock, { kind: "embeddedObject" }>["document"] => ({
      kind: "wordprocessing",
      metadata: {},
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text }] }],
        },
      ],
    });
    const object = (
      text: string,
    ): Extract<ContentBlock, { kind: "embeddedObject" }> => ({
      kind: "embeddedObject",
      objectKind: "wordprocessing",
      document: nested(text),
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 60 },
    });
    const attached = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "paragraph", runs: [{ text: "host" }] },
            object("first"),
          ],
        },
      ],
    });
    expect(bodyElements(attached)).toEqual([
      { tag: "w:p", summary: "p:r2:o1:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
    const fresh = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [object("second")] }],
    });
    expect(bodyElements(fresh)).toEqual([
      { tag: "w:p", summary: "p:r1:o1:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
  });

  it("collects a paragraph styleId referenced only inside a table cell into the styles part", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "table",
              rows: [
                {
                  cells: [
                    {
                      blocks: [
                        {
                          kind: "paragraph",
                          styleId: "CellStyle",
                          runs: [{ text: "cell" }],
                        },
                      ],
                    },
                  ],
                },
              ],
              columns: [{ widthPt: 100 }],
            },
          ],
        },
      ],
    });
    const stylesRoot = rootElement(written.parts["word/styles.xml"]);
    expect(
      stylesRoot === undefined
        ? []
        : elementsWithTag([stylesRoot], "w:style").map((style) =>
            attr(style, "w:styleId"),
          ),
    ).toEqual(["Normal", "DefaultParagraphFont", "CellStyle"]);
  });

  it("writes a block-scoped comment extent as the same-id range pair around its paragraphs", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "anchor", anchorType: "comment", name: "7" },
            },
            { kind: "paragraph", runs: [{ text: "commented" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined ? [] : childrenWithTag(documentRoot, "w:body");
    const bodyChildren =
      body[0] === undefined
        ? []
        : body[0].children.filter(
            (child): child is XmlElement => child.type === "element",
          );
    expect(bodyChildren.map((child) => child.tag)).toEqual([
      "w:commentRangeStart",
      "w:p",
      "w:commentRangeEnd",
      "w:sectPr",
    ]);
    expect(attr(bodyChildren[0]!, "w:id")).toBe("7");
    const rangeEnd = bodyChildren.find(
      (child) => child.tag === "w:commentRangeEnd",
    )!;
    expect(attr(rangeEnd, "w:id")).toBe("7");
  });

  it("places a field's characters inside the sdt-wrapped paragraph its extent contains", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "field", instruction: "f" },
            },
            {
              kind: "constructStart",
              descriptor: { kind: "contentControl", controlType: "richText" },
            },
            { kind: "paragraph", runs: [{ text: "inner" }] },
            { kind: "constructEnd" },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    const sdt =
      body === undefined ? undefined : childrenWithTag(body, "w:sdt")[0];
    if (sdt === undefined) {
      throw new Error("expected an sdt");
    }
    const paragraph = elementsWithTag([sdt], "w:p")[0]!;
    const described = paragraph.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => {
        if (child.tag !== "w:r") {
          return child.tag;
        }
        const fldChar = childrenWithTag(child, "w:fldChar")[0];
        if (fldChar !== undefined) {
          return `fld:${attr(fldChar, "w:fldCharType")}`;
        }
        if (childrenWithTag(child, "w:instrText").length > 0) {
          return "instr";
        }
        return "run";
      });
    expect(described).toEqual([
      "fld:begin",
      "instr",
      "fld:separate",
      "run",
      "fld:end",
    ]);
  });

  it("wraps a field extent with no paragraph in its own minted opening and closing paragraphs", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "field", instruction: "empty" },
            },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const described = bodyElements(written);
    expect(described).toEqual([
      { tag: "w:p", summary: "p:r3:o0:d0" },
      { tag: "w:p", summary: "p:r1:o0:d0" },
      { tag: "w:sectPr", summary: "" },
    ]);
  });

  it("keeps a section break's fldChar-free paragraph choice away from a trailing table's cell paragraphs", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            { kind: "paragraph", runs: [{ text: "last of section one" }] },
            {
              kind: "table",
              rows: [{ cells: [{ blocks: [] }] }],
              columns: [{ widthPt: 100 }],
            },
          ],
        },
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text: "section two" }] }],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    // The first section's sectPr rides the paragraph before the table, never a cell's paragraph inside it; the final section's sectPr is a direct body child.
    const table = childrenWithTag(body, "w:tbl")[0]!;
    expect(elementsWithTag([table], "w:sectPr")).toEqual([]);
    const paragraphs = body.children.filter(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:p",
    );
    const firstParagraphPPr = childrenWithTag(paragraphs[0]!, "w:pPr")[0]!;
    expect(childrenWithTag(firstParagraphPPr, "w:sectPr")).toHaveLength(1);
    const directSectPr = childrenWithTag(body, "w:sectPr");
    expect(directSectPr).toHaveLength(1);
  });

  it("appends the section break into a closing paragraph's existing properties and mints a pPr for one carrying none", () => {
    const styledSection = (
      paragraphBlock: ContentBlock,
    ): ReturnType<typeof buildDocxPackageFromContent> extends never
      ? never
      : Package => {
      return buildDocxPackageFromContent({
        sections: [
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [paragraphBlock],
          },
          {
            pageSize: { widthPt: 612, heightPt: 792 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [{ kind: "paragraph", runs: [{ text: "tail" }] }],
          },
        ],
      });
    };
    const styled = styledSection({
      kind: "paragraph",
      styleId: "Tail",
      runs: [{ text: "closing" }],
    });
    const styledRoot = rootElement(styled.parts["word/document.xml"]);
    const styledBody =
      styledRoot === undefined
        ? undefined
        : childrenWithTag(styledRoot, "w:body")[0];
    const styledParagraph =
      styledBody === undefined
        ? undefined
        : styledBody.children.find(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:p",
          );
    if (styledParagraph === undefined) {
      throw new Error("expected a paragraph");
    }
    const styledPPr = childrenWithTag(styledParagraph, "w:pPr")[0]!;
    expect(
      styledPPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:pStyle", "w:sectPr"]);

    const plain = styledSection({
      kind: "paragraph",
      runs: [{ text: "closing" }],
    });
    const plainRoot = rootElement(plain.parts["word/document.xml"]);
    const plainBody =
      plainRoot === undefined
        ? undefined
        : childrenWithTag(plainRoot, "w:body")[0];
    const plainParagraph =
      plainBody === undefined
        ? undefined
        : plainBody.children.find(
            (child): child is XmlElement =>
              child.type === "element" && child.tag === "w:p",
          );
    if (plainParagraph === undefined) {
      throw new Error("expected a paragraph");
    }
    const plainPPr = childrenWithTag(plainParagraph, "w:pPr")[0]!;
    expect(
      plainPPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:sectPr"]);
  });

  it("gives a mid-document section with no paragraph of its own an empty paragraph carrying the break", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [
            {
              kind: "table",
              rows: [{ cells: [{ blocks: [] }] }],
              columns: [{ widthPt: 100 }],
            },
          ],
        },
        {
          pageSize: { widthPt: 612, heightPt: 792 },
          margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
          blocks: [{ kind: "paragraph", runs: [{ text: "after" }] }],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    const children = body.children.filter(
      (child): child is XmlElement => child.type === "element",
    );
    expect(children.map((child) => child.tag)).toEqual([
      "w:tbl",
      "w:p",
      "w:p",
      "w:sectPr",
    ]);
    const empty = children[1]!;
    expect(childrenWithTag(empty, "w:r")).toHaveLength(0);
    const pPr = childrenWithTag(empty, "w:pPr")[0]!;
    expect(childrenWithTag(pPr, "w:sectPr")).toHaveLength(1);
  });
});

describe("buildDocxPackageFromContent: part scaffolding XML exactness", () => {
  function partNodes(written: Package, name: string): XmlNode[] {
    const part = written.parts[name];
    if (part?.kind !== "xml") {
      throw new Error(`expected xml part ${name}`);
    }
    return part.nodes;
  }

  function declarationOf(
    written: Package,
    name: string,
  ): { name: string; value: string }[] {
    const declaration = partNodes(written, name)[0];
    if (declaration?.type !== "declaration") {
      throw new Error(`expected a declaration in ${name}`);
    }
    return declaration.attributes;
  }

  it("leads every xml part with the standalone UTF-8 declaration", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }],
        },
      ],
    });
    expect(declarationOf(written, "word/document.xml")).toEqual([
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ]);
    expect(declarationOf(written, "word/styles.xml")).toEqual([
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ]);
  });

  it("declares the document root's namespace set and ignorable extensions exactly, with the body as its one child", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
    });
    const root = rootElement(written.parts["word/document.xml"]);
    if (root === undefined) {
      throw new Error("expected document root");
    }
    expect(root.tag).toBe("w:document");
    expect(attr(root, "mc:Ignorable")).toBe("w14 w15");
    expect(attr(root, "xmlns:w")).toBe(
      "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    );
    expect(attr(root, "xmlns:r")).toBe(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    );
    expect(attr(root, "xmlns:w14")).toBe(
      "http://schemas.microsoft.com/office/word/2010/wordml",
    );
    expect(
      root.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:body"]);
  });

  it("writes each header and footer part under its own root tag and namespace set, and registers its document relationship", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [{ kind: "paragraph", runs: [{ text: "head" }] }],
        },
        {
          path: "word/footer2.xml",
          kind: "footer",
          blocks: [{ kind: "paragraph", runs: [{ text: "foot" }] }],
        },
      ],
    });
    const headerRoot = rootElement(written.parts["word/header1.xml"]);
    const footerRoot = rootElement(written.parts["word/footer2.xml"]);
    if (headerRoot === undefined || footerRoot === undefined) {
      throw new Error("expected header and footer parts");
    }
    expect(headerRoot.tag).toBe("w:hdr");
    expect(footerRoot.tag).toBe("w:ftr");
    for (const partRoot of [headerRoot, footerRoot]) {
      expect(attr(partRoot, "xmlns:w")).toBe(
        "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
      );
      expect(attr(partRoot, "xmlns:pic")).toBe(
        "http://schemas.openxmlformats.org/drawingml/2006/picture",
      );
      expect(attr(partRoot, "mc:Ignorable")).toBe("w14 w15");
    }
    const relsRoot = rootElement(written.parts["word/_rels/document.xml.rels"]);
    const headerFooterRels =
      relsRoot === undefined
        ? []
        : elementsWithTag([relsRoot], "Relationship").map((rel) => ({
            type: attr(rel, "Type") ?? "",
            target: attr(rel, "Target") ?? "",
          }));
    expect(headerFooterRels).toContainEqual({
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header",
      target: "header1.xml",
    });
    expect(headerFooterRels).toContainEqual({
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer",
      target: "footer2.xml",
    });
  });

  it("emits a header-only image's media file, part-local relationships, and content-type default", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 72,
              heightPt: 36,
            },
          ],
        },
      ],
    });
    expect(Object.keys(written.parts)).toContain("word/media/image1.png");
    expect(Object.keys(written.parts)).toContain("word/_rels/header1.xml.rels");
    const headerRels = rootElement(
      written.parts["word/_rels/header1.xml.rels"],
    );
    const imageRels =
      headerRels === undefined
        ? []
        : elementsWithTag([headerRels], "Relationship").filter(
            (rel) => attr(rel, "Type") === IMAGE_REL,
          );
    expect(imageRels).toHaveLength(1);
    expect(attr(imageRels[0]!, "Target")).toBe("media/image1.png");
    const typesRoot = rootElement(written.parts["[Content_Types].xml"]);
    expect(
      typesRoot === undefined
        ? []
        : elementsWithTag([typesRoot], "Default").map((entry) => [
            attr(entry, "Extension") ?? "",
            attr(entry, "ContentType") ?? "",
          ]),
    ).toContainEqual(["png", "image/png"]);
  });

  it("writes a comment's author attribute and body paragraph under the comments root", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
      comments: [{ id: "1", author: "Reviewer", text: "body text" }],
    });
    const commentsRoot = rootElement(written.parts["word/comments.xml"]);
    if (commentsRoot === undefined) {
      throw new Error("expected comments part");
    }
    const comment = elementsWithTag([commentsRoot], "w:comment")[0]!;
    expect(attr(comment, "w:author")).toBe("Reviewer");
    const paragraph = childrenWithTag(comment, "w:p")[0]!;
    const run = childrenWithTag(paragraph, "w:r")[0]!;
    expect(
      elementsWithTag([run], "w:t").map((t) =>
        t.children
          .map((child) => (child.type === "text" ? child.value : ""))
          .join(""),
      ),
    ).toEqual(["body text"]);
  });

  it("writes the footnotes part under its own root, minting successive ids past nothing when none is explicit", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
      footnotes: [{ text: "first minted" }, { text: "second minted" }],
    });
    const notesRoot = rootElement(written.parts["word/footnotes.xml"]);
    if (notesRoot === undefined) {
      throw new Error("expected footnotes part");
    }
    expect(notesRoot.tag).toBe("w:footnotes");
    const entries = elementsWithTag([notesRoot], "w:footnote");
    expect(entries.map((entry) => attr(entry, "w:id"))).toEqual([
      "-1",
      "0",
      "1",
      "2",
    ]);
    expect(entries.map((entry) => attr(entry, "w:type"))).toEqual([
      "separator",
      "continuationSeparator",
      undefined,
      undefined,
    ]);
  });

  it("writes the created and modified timestamps with the W3CDTF type attribute", () => {
    const written = buildDocxPackageFromContent({
      metadata: {
        createdIso: "2026-09-16T08:00:00Z",
        modifiedIso: "2026-09-16T09:00:00Z",
      },
      sections: [{ ...emptyBodySection(), blocks: [] }],
    });
    const coreRoot = rootElement(written.parts["docProps/core.xml"]);
    if (coreRoot === undefined) {
      throw new Error("expected core properties part");
    }
    const created = elementsWithTag([coreRoot], "dcterms:created")[0]!;
    expect(attr(created, "xsi:type")).toBe("dcterms:W3CDTF");
    const modified = elementsWithTag([coreRoot], "dcterms:modified")[0]!;
    expect(attr(modified, "xsi:type")).toBe("dcterms:W3CDTF");
  });
});

describe("buildDocxPackageFromContent: cross-part payload sharing, minting order, and remaining property edges", () => {
  function bodyOf(written: Package): XmlElement {
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const body =
      documentRoot === undefined
        ? undefined
        : childrenWithTag(documentRoot, "w:body")[0];
    if (body === undefined) {
      throw new Error("expected body");
    }
    return body;
  }

  const nestedWordprocessing = (): Extract<
    ContentBlock,
    { kind: "embeddedObject" }
  >["document"] => ({
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [{ kind: "paragraph", runs: [{ text: "nested" }] }],
      },
    ],
  });

  const embeddedBlock = (): Extract<
    ContentBlock,
    { kind: "embeddedObject" }
  > => ({
    kind: "embeddedObject",
    objectKind: "wordprocessing",
    document: nestedWordprocessing(),
    frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 60 },
  });

  it("content-addresses one embedded payload across a header part and the body: one file, one override, two part-local relationships", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [embeddedBlock()],
        },
      ],
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [embeddedBlock()],
        },
      ],
    });
    const embeddingFiles = Object.keys(written.parts).filter((name) =>
      name.startsWith("word/embeddings/"),
    );
    expect(embeddingFiles).toEqual(["word/embeddings/oleObject1.docx"]);
    const headerRels = rootElement(
      written.parts["word/_rels/header1.xml.rels"],
    );
    const headerOleRel =
      headerRels === undefined
        ? []
        : elementsWithTag([headerRels], "Relationship").filter(
            (rel) =>
              attr(rel, "Type") ===
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject",
          );
    expect(headerOleRel.map((rel) => attr(rel, "Target"))).toEqual([
      "embeddings/oleObject1.docx",
    ]);
    const documentRels = rootElement(
      written.parts["word/_rels/document.xml.rels"],
    );
    const bodyOleRel =
      documentRels === undefined
        ? []
        : elementsWithTag([documentRels], "Relationship").filter(
            (rel) =>
              attr(rel, "Type") ===
              "http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject",
          );
    expect(bodyOleRel.map((rel) => attr(rel, "Target"))).toEqual([
      "embeddings/oleObject1.docx",
    ]);
  });

  it("sorts the styles part's collected ids, whatever order the document first referenced them in", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            { kind: "paragraph", styleId: "Zebra", runs: [{ text: "z" }] },
            { kind: "paragraph", styleId: "Alpha", runs: [{ text: "a" }] },
          ],
        },
      ],
    });
    const stylesRoot = rootElement(written.parts["word/styles.xml"]);
    expect(
      stylesRoot === undefined
        ? []
        : elementsWithTag([stylesRoot], "w:style").map((style) =>
            attr(style, "w:styleId"),
          ),
    ).toEqual(["Normal", "DefaultParagraphFont", "Alpha", "Zebra"]);
  });

  it("keeps a tracked paragraph's own properties alongside the change on its paragraph mark", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: {
                kind: "provenance",
                change: "insertion",
                author: "Editor",
              },
            },
            {
              kind: "paragraph",
              styleId: "Styled",
              runs: [{ text: "kept" }],
            },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraph = bodyOf(written).children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:p",
    );
    if (paragraph === undefined) {
      throw new Error("expected a paragraph");
    }
    const pPr = childrenWithTag(paragraph, "w:pPr")[0]!;
    expect(
      pPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:pStyle", "w:rPr"]);
  });

  it("aligns lifted-image placement through a hyperlink-wrapped run without reusing it", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "intro" },
                { text: "", hyperlink: "https://example.com/a" },
                { text: "" },
              ],
            },
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 72,
              heightPt: 36,
            },
          ],
        },
      ],
    });
    const paragraph = bodyOf(written).children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:p",
    );
    if (paragraph === undefined) {
      throw new Error("expected a paragraph");
    }
    const runChildren = paragraph.children.filter(
      (child): child is XmlElement => child.type === "element",
    );
    // The drawing lands in the trailing PLAIN empty run; the hyperlink wrapper keeps exactly its own run and gains nothing.
    const hyperlink = runChildren.find((child) => child.tag === "w:hyperlink");
    if (hyperlink === undefined) {
      throw new Error("expected a hyperlink run");
    }
    expect(
      hyperlink.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toEqual(["w:r"]);
    expect(elementsWithTag([hyperlink], "w:drawing")).toHaveLength(0);
    const runs = runChildren.filter((child) => child.tag === "w:r");
    const lastRun = runs[runs.length - 1]!;
    expect(elementsWithTag([lastRun], "w:drawing")).toHaveLength(1);
    // The drawing reuses the paragraph's own trailing empty run: no fresh run is minted beside it, so the paragraph still carries exactly its two direct w:r children (the hyperlink wrapper holds the third).
    expect(
      paragraph.children.filter(
        (child): child is XmlElement =>
          child.type === "element" && child.tag === "w:r",
      ),
    ).toHaveLength(2);
  });

  it("never reuses an empty hyperlink-wrapped run itself for a lifted image, only plain empty runs", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "paragraph",
              runs: [
                { text: "", hyperlink: "https://example.com/b" },
                { text: "" },
              ],
            },
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: 72,
              heightPt: 36,
            },
          ],
        },
      ],
    });
    const paragraph = bodyOf(written).children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:p",
    );
    if (paragraph === undefined) {
      throw new Error("expected a paragraph");
    }
    const hyperlink = paragraph.children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:hyperlink",
    );
    if (hyperlink === undefined) {
      throw new Error("expected a hyperlink run");
    }
    expect(elementsWithTag([hyperlink], "w:drawing")).toHaveLength(0);
  });

  it("writes a list control with no options as its own element with no list items", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "contentControl", controlType: "comboBox" },
            },
            { kind: "paragraph", runs: [{ text: "choose" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const sdtPr = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    )[0]!;
    const comboBox = childrenWithTag(sdtPr, "w:comboBox")[0]!;
    expect(childrenWithTag(comboBox, "w:listItem")).toHaveLength(0);
  });

  it("spells a checked check-box's state w14:val 1", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: {
                kind: "contentControl",
                controlType: "checkbox",
                checked: true,
              },
            },
            { kind: "paragraph", runs: [{ text: "ticked" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const sdtPr = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    )[0]!;
    expect(attr(elementsWithTag([sdtPr], "w14:checked")[0]!, "w14:val")).toBe(
      "1",
    );
  });

  it("writes a push-button control as the richText fallback element", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "contentControl", controlType: "button" },
            },
            { kind: "paragraph", runs: [{ text: "press" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const sdtPr = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    )[0]!;
    expect(
      sdtPr.children
        .filter((child): child is XmlElement => child.type === "element")
        .map((child) => child.tag),
    ).toContain("w:richText");
  });

  it("carries the underlying parse error as the residue-refusal's cause", () => {
    let thrown: Error | undefined;
    try {
      buildDocxPackageFromContent({
        sections: [
          {
            ...emptyBodySection(),
            blocks: [
              {
                kind: "constructStart",
                descriptor: {
                  kind: "contentControl",
                  controlType: "richText",
                  source: { format: "docx", xml: "not xml <" },
                },
              },
              { kind: "paragraph", runs: [{ text: "x" }] },
              { kind: "constructEnd" },
            ],
          },
        ],
      });
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown?.message).toMatch(/does not parse as XML/);
    expect(thrown?.cause).toBeInstanceOf(Error);
  });

  it("restores a docPartList residue exactly as it restores a docPartObj one", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: {
                kind: "contentControl",
                controlType: "richText",
                source: {
                  format: "docx",
                  xml: '<w:docPartList><w:docPartGallery w:val="Table of Contents"/></w:docPartList>',
                },
              },
            },
            { kind: "paragraph", runs: [{ text: "listed" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const documentRoot = rootElement(written.parts["word/document.xml"]);
    const sdtPr = elementsWithTag(
      documentRoot === undefined ? [] : [documentRoot],
      "w:sdtPr",
    )[0]!;
    const docPartList = childrenWithTag(sdtPr, "w:docPartList")[0]!;
    expect(
      elementsWithTag([docPartList], "w:docPartGallery").map((gallery) =>
        attr(gallery, "w:val"),
      ),
    ).toEqual(["Table of Contents"]);
  });

  it("writes a block-scoped field's instruction with space preservation and its characters after any paragraph properties", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "field", instruction: " TOC " },
            },
            {
              kind: "paragraph",
              styleId: "Fielded",
              runs: [{ text: "inside" }],
            },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraph = bodyOf(written).children.find(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:p",
    );
    if (paragraph === undefined) {
      throw new Error("expected a paragraph");
    }
    const described = paragraph.children
      .filter((child): child is XmlElement => child.type === "element")
      .map((child) => {
        if (child.tag !== "w:r") {
          return child.tag;
        }
        const fldChar = childrenWithTag(child, "w:fldChar")[0];
        if (fldChar !== undefined) {
          return `fld:${attr(fldChar, "w:fldCharType")}`;
        }
        if (childrenWithTag(child, "w:instrText").length > 0) {
          return "instr";
        }
        return "run";
      });
    expect(described).toEqual([
      "w:pPr",
      "fld:begin",
      "instr",
      "fld:separate",
      "run",
      "fld:end",
    ]);
    const instr = elementsWithTag([paragraph], "w:instrText")[0]!;
    expect(attr(instr, "xml:space")).toBe("preserve");
  });

  it("closes a no-paragraph field extent's minted paragraph with a typed end character", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: { kind: "field", instruction: "empty" },
            },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const paragraphs = bodyOf(written).children.filter(
      (child): child is XmlElement =>
        child.type === "element" && child.tag === "w:p",
    );
    const closing = paragraphs[paragraphs.length - 1]!;
    const fldChars = elementsWithTag([closing], "w:fldChar");
    expect(fldChars.map((run) => attr(run, "w:fldCharType"))).toEqual(["end"]);
  });

  it("mints increasing ids across two block-scoped bookmarks", () => {
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "constructStart",
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "blockOne",
              },
            },
            { kind: "paragraph", runs: [{ text: "one" }] },
            { kind: "constructEnd" },
            {
              kind: "constructStart",
              descriptor: {
                kind: "anchor",
                anchorType: "bookmark",
                name: "blockTwo",
              },
            },
            { kind: "paragraph", runs: [{ text: "two" }] },
            { kind: "constructEnd" },
          ],
        },
      ],
    });
    const starts = elementsWithTag([bodyOf(written)], "w:bookmarkStart");
    expect(starts.map((start) => attr(start, "w:id"))).toEqual(["1", "2"]);
    expect(starts.map((start) => attr(start, "w:name"))).toEqual([
      "blockOne",
      "blockTwo",
    ]);
  });

  it("mints comment ids from one when no comment carries an explicit id", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
      comments: [
        { author: "First", text: "one" },
        { author: "Second", text: "two" },
      ],
    });
    const commentsRoot = rootElement(written.parts["word/comments.xml"]);
    expect(
      commentsRoot === undefined
        ? []
        : elementsWithTag([commentsRoot], "w:comment").map((comment) =>
            attr(comment, "w:id"),
          ),
    ).toEqual(["1", "2"]);
  });

  it("omits w:type for a note whose recorded type is the ordinary normal", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
      endnotes: [{ id: "3", type: "normal", text: "plain note" }],
    });
    const notesRoot = rootElement(written.parts["word/endnotes.xml"]);
    const entries =
      notesRoot === undefined
        ? []
        : elementsWithTag([notesRoot], "w:endnote").filter(
            (note) => attr(note, "w:id") === "3",
          );
    expect(attr(entries[0]!, "w:type")).toBeUndefined();
  });

  it("writes a header part's runs as live w:t content, never as deleted text", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [{ kind: "paragraph", runs: [{ text: "running head" }] }],
        },
      ],
    });
    const headerRoot = rootElement(written.parts["word/header1.xml"]);
    if (headerRoot === undefined) {
      throw new Error("expected header root");
    }
    expect(elementsWithTag([headerRoot], "w:delText")).toHaveLength(0);
    expect(
      elementsWithTag([headerRoot], "w:t").map((t) =>
        t.children
          .map((child) => (child.type === "text" ? child.value : ""))
          .join(""),
      ),
    ).toEqual(["running head"]);
  });

  it("emits a header part's embedded object as a real embeddings file with its override", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
      headerFooterParts: [
        {
          path: "word/header1.xml",
          kind: "header",
          blocks: [embeddedBlock()],
        },
      ],
    });
    expect(Object.keys(written.parts)).toContain(
      "word/embeddings/oleObject1.docx",
    );
    const typesRoot = rootElement(written.parts["[Content_Types].xml"]);
    expect(
      typesRoot === undefined
        ? []
        : elementsWithTag([typesRoot], "Override").map(
            (override) => attr(override, "PartName") ?? "",
          ),
    ).toContain("/word/embeddings/oleObject1.docx");
  });
});

describe("buildDocxPackageFromContent: note part body structure", () => {
  it("writes each note's text as its own paragraph-run-text triple inside the note element", () => {
    const written = buildDocxPackageFromContent({
      sections: [{ ...emptyBodySection(), blocks: [] }],
      footnotes: [{ id: "4", text: "the note body" }],
    });
    const notesRoot = rootElement(written.parts["word/footnotes.xml"]);
    if (notesRoot === undefined) {
      throw new Error("expected footnotes root");
    }
    const note = elementsWithTag([notesRoot], "w:footnote").find(
      (entry) => attr(entry, "w:id") === "4",
    );
    if (note === undefined) {
      throw new Error("expected the carried note");
    }
    const paragraph = childrenWithTag(note, "w:p")[0]!;
    const run = childrenWithTag(paragraph, "w:r")[0]!;
    expect(
      elementsWithTag([run], "w:t").map((t) =>
        t.children
          .map((child) => (child.type === "text" ? child.value : ""))
          .join(""),
      ),
    ).toEqual(["the note body"]);
  });
});
