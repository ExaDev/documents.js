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
    // A markup-family subtype's fields, never the opaque-residue fallback's -- pins that FreeText is genuinely recognised via SEMANTIC_SUBTYPES, not merely carrying its own literal subtype string through unaffected by that classification.
    expect(freeText?.source).toBeUndefined();
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
});
