import { describe, expect, it } from "vitest";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import type { DocxDocument } from "./read-schemas";
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
