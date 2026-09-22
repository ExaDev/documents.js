import { decodePackage } from "documents.js";
import { describe, expect, it } from "vitest";
import { el, txt, xmlDeclaration } from "./ooxml-fixture";
import {
  buildCommentsPart,
  buildDocxWithExtras,
  buildFooterPart,
  buildFootnotesPart,
  buildHeaderPart,
  buildNumberingPart,
  DOCX_EXTRAS_FIXTURE,
} from "./docx-extras-fixture";

const WORDML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function paragraphWithText(text: string) {
  return el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt(text)])])]);
}

// Pins the exact XML each of the five extra-part builders produces, called directly with no editor/package/encode-decode round trip involved — otherwise nothing ever asserts on this fixture's own structure beyond whatever documents.js's readDocxExtras happens to surface, which never touches internal plumbing like a comment/footnote's own w:id or a numbering level's w:ilvl/w:abstractNumId.
describe("buildCommentsPart", () => {
  it("declares one authored and one unauthored comment", () => {
    expect(buildCommentsPart()).toEqual({
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
});

describe("buildFootnotesPart", () => {
  it("declares a skippable separator footnote alongside the real one", () => {
    expect(buildFootnotesPart()).toEqual({
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
});

describe("buildHeaderPart", () => {
  it("declares the fixture's own header text", () => {
    expect(buildHeaderPart()).toEqual({
      kind: "xml",
      nodes: [
        xmlDeclaration(),
        el("w:hdr", { "xmlns:w": WORDML_NS }, [
          paragraphWithText(DOCX_EXTRAS_FIXTURE.headerText),
        ]),
      ],
    });
  });
});

describe("buildFooterPart", () => {
  it("declares the fixture's own footer text", () => {
    expect(buildFooterPart()).toEqual({
      kind: "xml",
      nodes: [
        xmlDeclaration(),
        el("w:ftr", { "xmlns:w": WORDML_NS }, [
          paragraphWithText(DOCX_EXTRAS_FIXTURE.footerText),
        ]),
      ],
    });
  });
});

describe("buildNumberingPart", () => {
  it("declares one abstract numbering definition bound to numId", () => {
    expect(buildNumberingPart()).toEqual({
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
});

describe("buildDocxWithExtras", () => {
  it("wires all five extra parts into a real docx alongside the ordinary body paragraph", () => {
    const pkg = decodePackage(buildDocxWithExtras());

    expect(pkg.parts["word/comments.xml"]).toEqual(buildCommentsPart());
    expect(pkg.parts["word/footnotes.xml"]).toEqual(buildFootnotesPart());
    expect(pkg.parts["word/header1.xml"]).toEqual(buildHeaderPart());
    expect(pkg.parts["word/footer1.xml"]).toEqual(buildFooterPart());
    expect(pkg.parts["word/numbering.xml"]).toEqual(buildNumberingPart());

    const document = pkg.parts["word/document.xml"];
    if (document?.kind !== "xml") {
      throw new Error("expected word/document.xml to be an xml part");
    }
    expect(JSON.stringify(document.nodes)).toContain(
      "An ordinary body paragraph.",
    );
  });
});
