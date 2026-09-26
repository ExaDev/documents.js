import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentSection } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import {
  assertNeverRasterImageFormat,
  buildDocxPackageFromContent,
} from "./write";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const IMAGE_REL =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
function emptyBodySection(): ContentSection {
  return {
    pageSize: { widthPt: 612, heightPt: 792 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: [],
  };
}

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
    // Two different widths, chosen only to prove the sequential numbering below doesn't depend on the payload's own frame size.
    const FIRST_EMBED_WIDTH_PT = 100;
    const SECOND_EMBED_WIDTH_PT = 120;
    const written = buildDocxPackageFromContent({
      sections: [
        {
          ...emptyBodySection(),
          blocks: [
            embeddedObjectBlock(embeddedWordprocessing(), FIRST_EMBED_WIDTH_PT),
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
              SECOND_EMBED_WIDTH_PT,
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
    // An arbitrary, easily distinguishable placeholder byte sequence for the injected fake serialiser's output below: its exact values carry no format meaning, they only need to land on disk as their own bytes.
    const ARBITRARY_PAYLOAD_BYTE_THIRD = 3;
    const ARBITRARY_PAYLOAD_BYTE_FOURTH = 4;
    const ARBITRARY_PAYLOAD_BYTES = [
      1,
      2,
      ARBITRARY_PAYLOAD_BYTE_THIRD,
      ARBITRARY_PAYLOAD_BYTE_FOURTH,
    ];
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
          new Uint8Array(ARBITRARY_PAYLOAD_BYTES).slice(),
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

describe("assertNeverRasterImageFormat", () => {
  it("throws naming the unhandled format, proving mediaExtension's own exhaustiveness guard actually fires at runtime", () => {
    let caught: unknown;
    try {
      assertNeverRasterImageFormat("bogus" as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe(
      'mediaExtension: unhandled image format "bogus"',
    );
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
