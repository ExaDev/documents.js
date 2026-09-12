import { bytesToBase64 } from "documents.js";
import { el, encodePackage, ODF_MEDIA_TYPES, txt } from "odf.js";

// A minimal, hand-authored standalone .odf (OpenDocument Formula): content.xml IS the bare MathML root with no office:document-content wrapper at all -- the genuine LibreOffice shape odf.js's own src/typed/formula/read.ts confirms against a real UNO-produced file, not this package's own guess. Exists so outline_document can be exercised against a real document.kind === "formula" source, the one ContentDocument variant document-outline.js's buildOutline projects as a single group whose sole leaf child is the bare ContentFormula itself (no "kind" field), which is what outline.ts's own leafKind falls back to its "mathml" in leaf check for.
function enc(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

export function odfFormulaBytes(): Uint8Array<ArrayBuffer> {
  const mathRoot = el("math", { xmlns: "http://www.w3.org/1998/Math/MathML" }, [
    el("mn", {}, [txt("1")]),
  ]);
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
