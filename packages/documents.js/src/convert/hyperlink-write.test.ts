import type { ContentDocument } from "document-schema.js";

import { describe, expect, it } from "vitest";
import { decodePackage as decodeOdfPackage } from "odf.js";
import { decodePackage as decodeOoxmlPackage } from "ooxml.js";
import { buildOdtPackage } from "../edit/odt/content";
import { buildDocxPackage } from "../edit/docx/content";
import { buildPptxPackage } from "../edit/pptx/content";
import { markdownToDocx, markdownToOdt } from "./convert";

function docWithHyperlink(): ContentDocument {
  return {
    kind: "wordprocessing",
    metadata: {},
    sections: [
      {
        pageSize: { widthPt: 612, heightPt: 792 },
        margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
        blocks: [
          {
            kind: "paragraph",
            runs: [{ text: "Visit ", hyperlink: "https://example.org" }],
          },
        ],
      },
    ],
  };
}

describe("hyperlink write: odt text:a", () => {
  it("buildOdtPackage wraps a hyperlinked run in text:a xlink:href", () => {
    const pkg = buildOdtPackage(docWithHyperlink());
    const contentPart = pkg.parts["content.xml"];
    expect(contentPart?.kind).toBe("xml");
    const xml = JSON.stringify(contentPart);
    expect(xml).toContain("text:a");
    expect(xml).toContain("https://example.org");
    expect(xml).toContain("xlink:type");
  });
});

describe("hyperlink write: docx w:hyperlink", () => {
  it("buildDocxPackage wraps a hyperlinked run in w:hyperlink with an external relationship", () => {
    const pkg = buildDocxPackage(docWithHyperlink());
    const docPart = pkg.parts["word/document.xml"];
    expect(docPart?.kind).toBe("xml");
    const docXml = JSON.stringify(docPart);
    expect(docXml).toContain("w:hyperlink");
    // The relationship exists in document.xml.rels targeting the URL with TargetMode External.
    const rels = pkg.parts["word/_rels/document.xml.rels"];
    expect(rels?.kind).toBe("xml");
    const relsXml = JSON.stringify(rels);
    expect(relsXml).toContain("https://example.org");
    expect(relsXml).toContain("TargetMode");
  });
});

describe("hyperlink write: pptx a:hlinkClick", () => {
  it("buildPptxPackage wraps a hyperlinked run in a:hlinkClick with an external slide relationship", () => {
    const content: ContentDocument = {
      kind: "presentation",
      metadata: {},
      slides: [
        {
          size: { widthPt: 720, heightPt: 540 },
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 50 },
              insetLeftPt: 7.2,
              insetTopPt: 3.6,
              insetRightPt: 7.2,
              insetBottomPt: 3.6,
              blocks: [
                {
                  kind: "paragraph",
                  runs: [{ text: "Visit", hyperlink: "https://example.org" }],
                },
              ],
            },
          ],
          notes: "",
        },
      ],
    };
    const pkg = buildPptxPackage(content);
    const slidePart = pkg.parts["ppt/slides/slide1.xml"];
    expect(slidePart?.kind).toBe("xml");
    const slideXml = JSON.stringify(slidePart);
    expect(slideXml).toContain("a:hlinkClick");

    const rels = pkg.parts["ppt/slides/_rels/slide1.xml.rels"];
    expect(rels?.kind).toBe("xml");
    const relsXml = JSON.stringify(rels);
    expect(relsXml).toContain("https://example.org");
    expect(relsXml).toContain("TargetMode");
  });
});

// markdown-codec's own lower/inline.ts already emits ContentRun.hyperlink for a markdown link, so once buildDocxPackage/buildOdtPackage learned to write run.hyperlink (above), a markdown link crossing the markdownToDocx/markdownToOdt bridge started carrying its own URL through for free -- no markdown-specific code needed on either side.
describe("hyperlink write: markdown bridges inherit it for free", () => {
  it("markdownToDocx wraps the link in w:hyperlink with an external relationship", () => {
    const md = new TextEncoder().encode(
      "Visit [Example](https://example.org) now.",
    );
    const pkg = decodeOoxmlPackage(markdownToDocx(md));
    const docXml = JSON.stringify(pkg.parts["word/document.xml"]);
    expect(docXml).toContain("w:hyperlink");
    const relsXml = JSON.stringify(pkg.parts["word/_rels/document.xml.rels"]);
    expect(relsXml).toContain("https://example.org");
    expect(relsXml).toContain("TargetMode");
  });

  it("markdownToOdt wraps the link in text:a xlink:href", () => {
    const md = new TextEncoder().encode(
      "Visit [Example](https://example.org) now.",
    );
    const pkg = decodeOdfPackage(markdownToOdt(md));
    const xml = JSON.stringify(pkg.parts["content.xml"]);
    expect(xml).toContain("text:a");
    expect(xml).toContain("https://example.org");
  });
});
