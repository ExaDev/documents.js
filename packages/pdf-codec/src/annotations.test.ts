import { describe, expect, it } from "vitest";
import { NOTES_ANNOTATION_AUTHOR } from "./notes-annotation-author";
import { readPdf } from "./read";
import { annotationsPdf, FixtureBuilder } from "./test-support/pdf";

const HELVETICA_FONT_DICT_FOR_ANNOT_FIXTURES =
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

// A minimal one-page PDF whose single /Annots entry is exactly the given raw PDF dict literal (minus its own outer << >>, e.g. "/Type /Annot /Subtype /Highlight /Rect [10 10 50 20] /QuadPoints [1 2 3 4]") -- isolates one annotation-dict shape at a time from annotationsPdf()'s own fixture, whose entries are all otherwise well-formed.
function pdfWithOneAnnotation(annotDictBody: string): Uint8Array<ArrayBuffer> {
  const b = new FixtureBuilder().header();
  b.object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  b.object(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  b.object(
    3,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R /Annots [6 0 R] >>",
  );
  b.object(4, HELVETICA_FONT_DICT_FOR_ANNOT_FIXTURES);
  b.stream(5, "<< /Length 0 >>", new Uint8Array(0));
  b.object(6, `<< ${annotDictBody} >>`);
  b.classicXrefAndTrailer(6, "/Root 1 0 R");
  return b.bytes();
}

function markupPdfWithQuadPoints(
  quadPointsLiteral: string,
): Uint8Array<ArrayBuffer> {
  return pdfWithOneAnnotation(
    `/Type /Annot /Subtype /Highlight /Rect [10 10 50 20] /QuadPoints ${quadPointsLiteral}`,
  );
}

// Annotations (#721 phase 4): genuine third-party sticky notes (/Subtype /Text without this package's own presenter-notes marker), FreeText and the /QuadPoints markup family, and the opaque kinds (Stamp, Ink, ...) carried as quarantined residue -- the annotation row's marker-plus-body and residue verdicts. Link, FileAttachment, and Widget annotations are skipped here: they are owned by the link items, the attachments table, and the AcroForm field tree respectively.

describe("readPdf: annotations", () => {
  it("reads a genuine sticky note with its contents, author, and modification date", () => {
    const doc = readPdf(annotationsPdf());
    const sticky = doc.pages[0]!.annotations?.find((a) => a.subtype === "Text");
    expect(sticky).toEqual({
      subtype: "Text",
      xPt: 10,
      yPt: 60,
      widthPt: 16,
      heightPt: 16,
      contents: "A real reviewer note",
      author: "Reviewer",
      modifiedIso: "2026-08-19T14:03:00Z",
    });
  });

  it("reads a FreeText annotation's typed contents as its body", () => {
    const doc = readPdf(annotationsPdf());
    const freeText = doc.pages[0]!.annotations?.find(
      (a) => a.subtype === "FreeText",
    );
    expect(freeText).toMatchObject({
      subtype: "FreeText",
      contents: "Typed remark",
      author: "Reviewer",
    });
    // A markup-family subtype's fields, never the opaque-residue fallback's -- pins that FreeText is genuinely recognised via SEMANTIC_SUBTYPES, not merely carrying its own literal subtype string through unaffected by that classification.
    expect(freeText?.source).toBeUndefined();
    // FreeText here carries no /QuadPoints at all -- markupFields must tolerate that rather than assuming every semantic subtype has one.
    expect(freeText?.quads).toBeUndefined();
  });

  it("omits quads for a markup annotation whose /QuadPoints has too few numbers for even one quad", () => {
    const doc = readPdf(markupPdfWithQuadPoints("[1 2 3 4]"));
    const highlight = doc.pages[0]!.annotations?.find(
      (a) => a.subtype === "Highlight",
    );
    expect(highlight?.quads).toBeUndefined();
  });

  it("omits quads for a markup annotation whose /QuadPoints is empty -- a length that is both below 8 and already a multiple of 8, so only the length check (not the multiple-of-8 check) can be what rejects it", () => {
    const doc = readPdf(markupPdfWithQuadPoints("[]"));
    const highlight = doc.pages[0]!.annotations?.find(
      (a) => a.subtype === "Highlight",
    );
    expect(highlight?.quads).toBeUndefined();
  });

  it("omits quads for a markup annotation whose /QuadPoints length isn't a multiple of 8", () => {
    const doc = readPdf(
      markupPdfWithQuadPoints("[1 2 3 4 5 6 7 8 9 10 11 12]"),
    );
    const highlight = doc.pages[0]!.annotations?.find(
      (a) => a.subtype === "Highlight",
    );
    expect(highlight?.quads).toBeUndefined();
  });

  it("reads a markup annotation's /QuadPoints transformed into page space", () => {
    const doc = readPdf(annotationsPdf());
    const highlight = doc.pages[0]!.annotations?.find(
      (a) => a.subtype === "Highlight",
    );
    expect(highlight).toMatchObject({
      subtype: "Highlight",
      contents: "Marked passage",
      author: "Second reviewer",
    });
    expect(highlight?.quads).toEqual([
      [
        { xPt: 12, yPt: 42 },
        { xPt: 60, yPt: 42 },
        { xPt: 60, yPt: 30 },
        { xPt: 12, yPt: 30 },
      ],
    ]);
  });

  it("reads an Underline markup annotation's /QuadPoints transformed into page space", () => {
    const doc = readPdf(annotationsPdf());
    const underline = doc.pages[0]!.annotations?.find(
      (a) => a.subtype === "Underline",
    );
    expect(underline).toMatchObject({
      subtype: "Underline",
      contents: "Underlined text",
      author: "Third reviewer",
    });
    expect(underline?.quads).toEqual([
      [
        { xPt: 20, yPt: 82 },
        { xPt: 80, yPt: 82 },
        { xPt: 80, yPt: 70 },
        { xPt: 20, yPt: 70 },
      ],
    ]);
  });

  it("reads a StrikeOut markup annotation's /QuadPoints transformed into page space", () => {
    const doc = readPdf(annotationsPdf());
    const strikeOut = doc.pages[0]!.annotations?.find(
      (a) => a.subtype === "StrikeOut",
    );
    expect(strikeOut).toMatchObject({
      subtype: "StrikeOut",
      contents: "Struck text",
      author: "Third reviewer",
    });
    expect(strikeOut?.quads).toEqual([
      [
        { xPt: 90, yPt: 82 },
        { xPt: 150, yPt: 82 },
        { xPt: 150, yPt: 70 },
        { xPt: 90, yPt: 70 },
      ],
    ]);
  });

  it("reads a Squiggly markup annotation's /QuadPoints transformed into page space", () => {
    const doc = readPdf(annotationsPdf());
    const squiggly = doc.pages[0]!.annotations?.find(
      (a) => a.subtype === "Squiggly",
    );
    expect(squiggly).toMatchObject({
      subtype: "Squiggly",
      contents: "Squiggly text",
      author: "Third reviewer",
    });
    expect(squiggly?.quads).toEqual([
      [
        { xPt: 20, yPt: 97 },
        { xPt: 80, yPt: 97 },
        { xPt: 80, yPt: 85 },
        { xPt: 20, yPt: 85 },
      ],
    ]);
  });

  it("carries an opaque annotation kind as quarantined PDF-syntax residue", () => {
    const doc = readPdf(annotationsPdf());
    const stamp = doc.pages[0]!.annotations?.find((a) => a.subtype === "Stamp");
    expect(stamp).toMatchObject({
      subtype: "Stamp",
      xPt: 100,
      yPt: 20,
      widthPt: 40,
      heightPt: 20,
      contents: "Approved",
    });
    expect(stamp?.source?.format).toBe("pdf");
    expect(stamp?.source?.xml).toContain("/Stamp");
    expect(stamp?.source?.xml).toContain("/Contents");
  });

  it("leaves annotations absent when a page carries none", () => {
    const doc = readPdf(annotationsPdf());
    expect(doc.pages[1]!.annotations).toBeUndefined();
  });

  it("reports a diagnostic and skips an annotation that carries no /Rect", () => {
    const diagnostics: unknown[] = [];
    const doc = readPdf(
      pdfWithOneAnnotation("/Type /Annot /Subtype /Highlight"),
      { sink: (d) => diagnostics.push(d) },
    );
    expect(doc.pages[0]!.annotations).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "pdf/annotation-missing-rect",
        message: "a /Highlight annotation carries no /Rect; skipping it",
      }),
    ]);
  });

  it.each(["Link", "FileAttachment", "Widget", "Popup"])(
    "skips a bare %s annotation entirely, since another reader owns that kind",
    (subtype) => {
      const doc = readPdf(
        pdfWithOneAnnotation(
          `/Type /Annot /Subtype /${subtype} /Rect [10 10 50 20]`,
        ),
      );
      expect(doc.pages[0]!.annotations).toBeUndefined();
    },
  );

  it("does not skip a non-Text annotation even when its /T happens to equal the presenter-notes marker author", () => {
    const doc = readPdf(
      pdfWithOneAnnotation(
        `/Type /Annot /Subtype /FreeText /Rect [10 10 50 20] /T (${NOTES_ANNOTATION_AUTHOR})`,
      ),
    );
    // The presenter-notes skip check is specifically subtype === "Text"; a FreeText annotation must never be excluded by it, no matter what its /T reads.
    expect(doc.pages[0]!.annotations).toHaveLength(1);
  });

  it("omits contents, author, and modification date entirely -- not as present keys holding undefined -- when a semantic annotation carries none of /Contents, /T, or /M", () => {
    const doc = readPdf(
      pdfWithOneAnnotation(
        "/Type /Annot /Subtype /Highlight /Rect [10 10 50 20] /QuadPoints [10 20 50 20 50 10 10 10]",
      ),
    );
    const highlight = doc.pages[0]!.annotations?.find(
      (a) => a.subtype === "Highlight",
    );
    expect(highlight).toBeDefined();
    expect(Object.hasOwn(highlight!, "contents")).toBe(false);
    expect(Object.hasOwn(highlight!, "author")).toBe(false);
    expect(Object.hasOwn(highlight!, "modifiedIso")).toBe(false);
  });
});
