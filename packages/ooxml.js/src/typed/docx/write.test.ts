import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentSection } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { decodePackage, encodePackage } from "../../codec";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import { ptToEmu } from "../shared/units";
import { readDocxContent } from "./read";
import { buildDocxPackageFromContent } from "./write";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const PICTURE_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";

function docxPackage(
  bodyChildren: readonly XmlNode[],
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

function para(text: string, ...extra: readonly XmlNode[]): XmlNode {
  return el("w:p", {}, [...extra, el("w:r", {}, [el("w:t", {}, [txt(text)])])]);
}

// Read, write, read: the second read's sections are what every assertion compares against the first's.
function emptyBodySection(): ContentSection {
  return {
    pageSize: { widthPt: 612, heightPt: 792 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: [],
  };
}

const DRAWINGML_MAIN_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/main";

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
describe("buildDocxPackageFromContent: buildDrawing's fixed XML shape", () => {
  it("writes the zero offset, rect preset, distT/B/L/R zeros, and docPr id/name exactly, with alt text as descr", () => {
    // Arbitrary but distinct fixture dimensions, reused below when converting to the expected EMU extent so the assertion checks the same size the fixture sets.
    const IMAGE_WIDTH_PT = 100;
    const IMAGE_HEIGHT_PT = 50;
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            {
              kind: "image",
              format: "png",
              base64: TINY_PNG_BASE64,
              widthPt: IMAGE_WIDTH_PT,
              heightPt: IMAGE_HEIGHT_PT,
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

    const cx = String(ptToEmu(IMAGE_WIDTH_PT));
    const cy = String(ptToEmu(IMAGE_HEIGHT_PT));
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
