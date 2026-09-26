import { describe, expect, it } from "vitest";
import type { ContentBlock, ContentSection } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag, elementsWithTag, rootElement } from "../util";
import { buildDocxPackageFromContent } from "./write";
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
function emptyBodySection(): ContentSection {
  return {
    pageSize: { widthPt: 612, heightPt: 792 },
    margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
    blocks: [],
  };
}

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
