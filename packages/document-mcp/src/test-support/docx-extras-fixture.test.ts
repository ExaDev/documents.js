import { decodePackage } from "documents.js";
import { describe, expect, it } from "vitest";
import { el, txt, xmlDeclaration } from "./ooxml-fixture";
import {
  buildDocxWithExtras,
  DOCX_EXTRAS_FIXTURE,
} from "./docx-extras-fixture";

const WORDML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function paragraphWithText(text: string) {
  return el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt(text)])])]);
}

// Pins the exact XML this fixture writes into each of its four hand-authored parts (comments/footnotes/headers-footers/numbering), decoded straight back from the real docx bytes it produces -- otherwise nothing ever asserts on this fixture's own structure beyond whatever documents.js's readDocxExtras happens to surface, which never touches internal plumbing like a comment/footnote's own w:id or a numbering level's w:ilvl/w:abstractNumId.
describe("buildDocxWithExtras", () => {
  const pkg = decodePackage(buildDocxWithExtras());

  it("writes word/comments.xml with one authored and one unauthored comment", () => {
    expect(pkg.parts["word/comments.xml"]).toEqual({
      kind: "xml",
      nodes: [
        xmlDeclaration(),
        el("w:comments", { "xmlns:w": WORDML_NS }, [
          el(
            "w:comment",
            { "w:id": "0", "w:author": DOCX_EXTRAS_FIXTURE.commentAuthor },
            [paragraphWithText(DOCX_EXTRAS_FIXTURE.commentWithAuthorText)],
          ),
          el("w:comment", { "w:id": "1" }, [
            paragraphWithText(DOCX_EXTRAS_FIXTURE.commentWithoutAuthorText),
          ]),
        ]),
      ],
    });
  });

  it("writes word/footnotes.xml with a skippable separator footnote alongside the real one", () => {
    expect(pkg.parts["word/footnotes.xml"]).toEqual({
      kind: "xml",
      nodes: [
        xmlDeclaration(),
        el("w:footnotes", { "xmlns:w": WORDML_NS }, [
          el("w:footnote", { "w:id": "-1", "w:type": "separator" }, [
            el("w:p", {}, [el("w:r", {}, [el("w:separator")])]),
          ]),
          el("w:footnote", { "w:id": "1" }, [
            paragraphWithText(DOCX_EXTRAS_FIXTURE.footnoteText),
          ]),
        ]),
      ],
    });
  });

  it("writes word/header1.xml with the fixture's own header text", () => {
    expect(pkg.parts["word/header1.xml"]).toEqual({
      kind: "xml",
      nodes: [
        xmlDeclaration(),
        el("w:hdr", { "xmlns:w": WORDML_NS }, [
          paragraphWithText(DOCX_EXTRAS_FIXTURE.headerText),
        ]),
      ],
    });
  });

  it("writes word/footer1.xml with the fixture's own footer text", () => {
    expect(pkg.parts["word/footer1.xml"]).toEqual({
      kind: "xml",
      nodes: [
        xmlDeclaration(),
        el("w:ftr", { "xmlns:w": WORDML_NS }, [
          paragraphWithText(DOCX_EXTRAS_FIXTURE.footerText),
        ]),
      ],
    });
  });

  it("writes word/numbering.xml with one abstract numbering definition bound to numId", () => {
    expect(pkg.parts["word/numbering.xml"]).toEqual({
      kind: "xml",
      nodes: [
        xmlDeclaration(),
        el("w:numbering", { "xmlns:w": WORDML_NS }, [
          el("w:abstractNum", { "w:abstractNumId": "0" }, [
            el("w:lvl", { "w:ilvl": "0" }, [
              el("w:start", { "w:val": "1" }),
              el("w:numFmt", {
                "w:val": DOCX_EXTRAS_FIXTURE.numberingLevel.format,
              }),
              el("w:lvlText", {
                "w:val": DOCX_EXTRAS_FIXTURE.numberingLevel.text,
              }),
            ]),
          ]),
          el("w:num", { "w:numId": DOCX_EXTRAS_FIXTURE.numId }, [
            el("w:abstractNumId", { "w:val": "0" }),
          ]),
        ]),
      ],
    });
  });

  it("also carries the ordinary body paragraph written before the extra parts", () => {
    const document = pkg.parts["word/document.xml"];
    if (document?.kind !== "xml") {
      throw new Error("expected word/document.xml to be an xml part");
    }
    const serialized = JSON.stringify(document.nodes);
    expect(serialized).toContain("An ordinary body paragraph.");
  });
});
