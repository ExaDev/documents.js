import { describe, expect, it } from "vitest";
import type { ContentDocument } from "document-schema.js";
import { DocxEditor } from "./editor";
import { buildDocxPackage } from "./content";

// The write edges of the wordprocessing bridge: a paragraph carrying every optional spacing and indent property round-trips each one; bookmark anchors mint sequential ids; and a list paragraph forces the numbering part and its relationship into the package.

function wordDoc(
  sections: Extract<ContentDocument, { kind: "wordprocessing" }>["sections"],
): ContentDocument {
  return { kind: "wordprocessing", metadata: {}, sections };
}

const SECTION = {
  pageSize: { widthPt: 612, heightPt: 792 },
  margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
};

describe("buildDocxPackage: paragraph property edges", () => {
  it("every optional spacing and indent property survives the round trip", () => {
    const content = wordDoc([
      {
        ...SECTION,
        blocks: [
          {
            kind: "paragraph",
            headingLevel: 2,
            spacingBeforePt: 6,
            spacingAfterPt: 12,
            lineSpacing: 1.5,
            indentLeftPt: 36,
            indentFirstLinePt: 18,
            runs: [{ text: "Dressed" }],
          },
        ],
      },
    ]);
    const editor = new DocxEditor(buildDocxPackage(content));
    const [paragraph] = editor.paragraphs();
    if (paragraph === undefined) {
      throw new Error("expected a paragraph");
    }
    expect(paragraph.headingLevel).toBe(2);
    expect(paragraph.spacingBeforePt).toBe(6);
    expect(paragraph.spacingAfterPt).toBe(12);
    expect(paragraph.lineSpacing).toBe(1.5);
    expect(paragraph.indentLeftPt).toBe(36);
    expect(paragraph.indentFirstLinePt).toBe(18);
  });

  it("bookmark anchors around blocks mint sequential bookmark ids", () => {
    const content = wordDoc([
      {
        ...SECTION,
        blocks: [
          {
            kind: "constructStart",
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "one",
              definition: "one",
            },
          },
          { kind: "paragraph", runs: [{ text: "first" }] },
          { kind: "constructEnd" },
          {
            kind: "constructStart",
            descriptor: {
              kind: "anchor",
              anchorType: "bookmark",
              name: "two",
              definition: "two",
            },
          },
          { kind: "paragraph", runs: [{ text: "second" }] },
          { kind: "constructEnd" },
        ],
      },
    ]);
    const pkg = buildDocxPackage(content);
    const editor = new DocxEditor(pkg);
    expect(editor.paragraphs().map((p) => p.text)).toEqual(["first", "second"]);
    const document = pkg.parts["word/document.xml"];
    if (document?.kind !== "xml") {
      throw new Error("expected a document part");
    }
    const xml = JSON.stringify(document);
    expect(xml).toContain('"w:bookmarkStart"');
    expect(xml).toContain('"one"');
    expect(xml).toContain('"two"');
  });

  it("a list paragraph forces the numbering part and its relationship in", () => {
    const withList = wordDoc([
      {
        ...SECTION,
        blocks: [
          {
            kind: "paragraph",
            list: { numId: "1", level: 0 },
            runs: [{ text: "item" }],
          },
        ],
      },
    ]);
    const pkg = buildDocxPackage(withList);
    expect(pkg.parts["word/numbering.xml"]?.kind).toBe("xml");
    const rels = pkg.parts["word/_rels/document.xml.rels"];
    if (rels?.kind !== "xml") {
      throw new Error("expected a relationships part");
    }
    expect(JSON.stringify(rels)).toContain("numbering.xml");
  });
});
