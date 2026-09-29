import { describe, expect, it } from "vitest";
import {
  minimalClassicXrefPdf,
  nonZeroOriginMediaBoxPdf,
  rotatedPagePdf,
  twoPageMultiTextPdf,
} from "./pdf";

// The byte-level companion to the read-back suite: the fixture builders are themselves the wire-format contract for every downstream test that uses them, so their exact bytes are pinned. A mutated syntax string in a builder changes these bytes and fails here even when readPdf happens to recover the same document from the damaged output.

function decoded(bytes: Uint8Array<ArrayBuffer>): string {
  return new TextDecoder("latin1").decode(bytes);
}

describe("pdf fixture builders' exact bytes", () => {
  it("minimalClassicXrefPdf", () => {
    expect(decoded(minimalClassicXrefPdf())).toBe(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<<  /Length 35 >>\nstream\nBT /F1 12 Tf 10 50 Td (Hello) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000241 00000 n \n0000000311 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n397\n%%EOF",
    );
  });

  it("rotatedPagePdf adds the Rotate entry to the page dictionary only", () => {
    expect(decoded(rotatedPagePdf())).toBe(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Rotate 90 >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<<  /Length 35 >>\nstream\nBT /F1 12 Tf 10 50 Td (Hello) Tj ET\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000252 00000 n \n0000000322 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n408\n%%EOF",
    );
  });

  it("nonZeroOriginMediaBoxPdf keeps the default page geometry with the shifted box", () => {
    const text = decoded(nonZeroOriginMediaBoxPdf());
    expect(text).toContain("/MediaBox [50 50 250 150]");
    expect(text.startsWith("%PDF-1.4\n1 0 obj\n")).toBe(true);
    expect(text.endsWith("startxref\n399\n%%EOF")).toBe(true);
    expect(text).toContain("0000000243 00000 n \n");
  });

  it("twoPageMultiTextPdf carries both pages' objects and the two-kid page tree", () => {
    const text = decoded(twoPageMultiTextPdf());
    expect(text).toContain("/Kids [3 0 R 4 0 R] /Count 2");
    expect(text).toContain("BT /F1 12 Tf 10 50 Td (PageZero) Tj ET");
    expect(text).toContain("BT /F1 12 Tf 10 50 Td (First) Tj ET");
    expect(text).toContain("BT /F1 12 Tf 10 90 Td (Second) Tj ET");
    expect(text.endsWith("%%EOF")).toBe(true);
  });
});
