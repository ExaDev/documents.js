import { bytesToBase64 } from "documents.js";
import { el, encodePackage, ODF_MEDIA_TYPES } from "odf.js";

// A minimal, hand-authored standalone .odf (OpenDocument Formula): content.xml IS the bare MathML root with no office:document-content wrapper at all -- the genuine LibreOffice shape odf.js's own src/typed/formula/read.ts confirms against a real UNO-produced file, not this package's own guess. Exists so outline_document can be exercised against a real document.kind === "formula" source, the one ContentDocument variant document-outline.js's buildOutline projects as a single group whose sole leaf child is the bare ContentFormula itself (no "kind" field), which is what outline.ts's own leafKind falls back to its "mathml" in leaf check for.
//
// The MathML root carries no attributes and no children on purpose, not merely for brevity: odf.js's own readOdfFormulaMathMl (src/typed/formula/read.ts) locates this root purely by rootElement(nodes).tag matching "math"/"math:math" -- it never inspects the root's own attributes -- and copies root.children verbatim into ContentFormula.mathml, a field ContentDocumentSchema's own comment states is "Required even when the source carried no MathML of its own... such a formula carries an empty array, which keeps every existing constructor of this shape valid." Nothing this operation's outline projection reads is sensitive to that array's contents either: document-outline.js's own outlineLeafText derives a formula leaf's text from ContentFormula.presentation?.latex, a field this ODF reader never populates (see readOdfFormulaContent, which returns only mathml/starMath), so it is always "" regardless of what raw MathML the source file actually carried. A once-larger version of this fixture carried an xmlns attribute and a nested <mn>1</mn> child purely for "realism", with no assertion anywhere -- in this operation's own tests or in odf.js's -- that could ever observe either; both are gone rather than kept as untestable padding.
function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

export function odfFormulaBytes(): Uint8Array<ArrayBuffer> {
  const mathRoot = el("math", {}, []);
  return encodePackage({
    parts: {
      mimetype: {
        kind: "binary",
        base64: bytesToBase64(enc(ODF_MEDIA_TYPES.odf)),
      },
      "content.xml": { kind: "xml", nodes: [mathRoot] },
    },
  });
}
