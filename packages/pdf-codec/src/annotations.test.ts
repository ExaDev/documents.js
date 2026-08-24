import { describe, expect, it } from "vitest";
import { readPdf } from "./read";
import { annotationsPdf } from "./test-support/pdf";

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
});
