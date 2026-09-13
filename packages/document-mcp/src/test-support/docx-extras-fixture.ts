// A real docx that carries every field `readDocxExtras` (documents.js) reads and `readDocxContent`'s own `ContentDocument` cannot: comments, footnotes, headers, footers, and a numbering definition. `DocxEditor` has no write side for any of these -- comments/footnotes/headers/footers/numbering are none of them addressable through `DocxBody`/`DocxParagraph` -- so this builder starts from a real editor-built package and writes the four extra parts directly, at the exact conventional paths (`word/comments.xml`, `word/footnotes.xml`, `word/header1.xml`/`word/footer1.xml`, `word/numbering.xml`) documents.js's own reader resolves them from with no relationship indirection at all. Ported from document-cli's own src/test-support/docx-extras-fixture.ts.
import {
  createDocx,
  encodePackage,
  type XmlElement,
  type XmlPart,
} from "documents.js";
import { el, txt, xmlDeclaration } from "./ooxml-fixture";

const WORDML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function paragraphWithText(text: string): XmlElement {
  return el("w:p", {}, [el("w:r", {}, [el("w:t", {}, [txt(text)])])]);
}

// The comment/footnote/header/footer/numbering text this fixture declares -- exported so a test asserting against `readDocxExtras`'s own output states its expectations against named constants rather than string literals repeated at every call site.
export const DOCX_EXTRAS_FIXTURE = {
  commentAuthor: "Alice",
  commentWithAuthorText: "Looks good to me.",
  commentWithoutAuthorText: "No author on this one.",
  footnoteText: "See appendix A.",
  headerText: "Confidential Draft",
  footerText: "Page footer text",
  numId: "1",
  numberingLevel: { format: "decimal", text: "%1." },
} as const;

// Each of these five builders returns one extra part's own XmlPart in isolation, with no editor/package/encode-decode round trip involved -- kept as standalone exports (rather than inlined into buildDocxWithExtras below) so a test can assert directly on the exact structure each one produces.

export function buildCommentsPart(): XmlPart {
  return {
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
  };
}

// Declares a `w:type="separator"` footnote -- the horizontal rule Word always writes alongside real footnotes -- deliberately, since `readDocxExtras`'s own `readFootnotes` (ooxml.js) skips exactly that type; a fixture that omitted it would never exercise the skip at all.
export function buildFootnotesPart(): XmlPart {
  return {
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
  };
}

export function buildHeaderPart(): XmlPart {
  return {
    kind: "xml",
    nodes: [
      xmlDeclaration(),
      el("w:hdr", { "xmlns:w": WORDML_NS }, [
        paragraphWithText(DOCX_EXTRAS_FIXTURE.headerText),
      ]),
    ],
  };
}

export function buildFooterPart(): XmlPart {
  return {
    kind: "xml",
    nodes: [
      xmlDeclaration(),
      el("w:ftr", { "xmlns:w": WORDML_NS }, [
        paragraphWithText(DOCX_EXTRAS_FIXTURE.footerText),
      ]),
    ],
  };
}

export function buildNumberingPart(): XmlPart {
  return {
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
  };
}

// A real docx, comments/footnotes/headers/footers/numbering included.
export function buildDocxWithExtras(): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body
    .appendParagraph()
    .appendRun({ text: "An ordinary body paragraph." });
  const pkg = editor.toPackage();

  pkg.parts["word/comments.xml"] = buildCommentsPart();
  pkg.parts["word/footnotes.xml"] = buildFootnotesPart();
  pkg.parts["word/header1.xml"] = buildHeaderPart();
  pkg.parts["word/footer1.xml"] = buildFooterPart();
  pkg.parts["word/numbering.xml"] = buildNumberingPart();

  return encodePackage(pkg);
}
