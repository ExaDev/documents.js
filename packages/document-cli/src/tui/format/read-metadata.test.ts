import {
  readDocxContent,
  readMarkdownContent,
  readOdgContent,
  readOdpContent,
  readOdsContent,
  readOdtContent,
  readPptxContent,
  type LayoutDocument,
  type LayoutMetadata,
} from "documents.js";
import { describe, expect, it } from "vitest";
import type { OpenDocument } from "../state/types.js";
import { createNewDocument } from "./open-document.js";
import { metadataFor } from "./read-metadata.js";

// Formats with a genuine live-view editor or a real toLayoutDocument() call are exercised through createNewDocument, comparing metadataFor's own result against the identical read call made directly in the test -- proving each case dispatches to its own format's real content reader rather than merely returning some object. documents.js's own editors have no metadata setter at all (see test-support/metadata-fixture.ts's own top-of-file comment), so a freshly created document's default metadata is what both sides read; what matters for this dispatch is that the two calls agree. The read-only-preview formats (xlsx/csv/svg/rtf/wpd/epub) build no real conversion here -- metadataFor's own logic for every one of them is the identical `doc.layout.metadata` property read already proven for pdf, so a stub layout carrying a recognisable metadata marker is enough to prove each case label reaches it.

function stubMetadata(marker: string): LayoutMetadata {
  return { title: marker };
}

function readOnlyPreviewDocument(
  format: "xlsx" | "csv" | "svg" | "rtf" | "wpd" | "epub",
  marker: string,
): OpenDocument {
  return {
    format,
    layout: { metadata: stubMetadata(marker) } as unknown as LayoutDocument,
    bytes: new Uint8Array(),
    path: "x",
  };
}

describe("metadataFor", () => {
  it("reads docx metadata through readDocxContent(doc.editor.toPackage())", () => {
    const doc = createNewDocument("docx");
    if (doc.format !== "docx") throw new Error("expected docx");
    expect(metadataFor(doc)).toEqual(
      readDocxContent(doc.editor.toPackage()).metadata,
    );
  });

  it("reads pptx metadata through readPptxContent(doc.editor.toPackage())", () => {
    const doc = createNewDocument("pptx");
    if (doc.format !== "pptx") throw new Error("expected pptx");
    expect(metadataFor(doc)).toEqual(
      readPptxContent(doc.editor.toPackage()).metadata,
    );
  });

  it("reads odt metadata through readOdtContent(doc.editor.toPackage())", () => {
    const doc = createNewDocument("odt");
    if (doc.format !== "odt") throw new Error("expected odt");
    expect(metadataFor(doc)).toEqual(
      readOdtContent(doc.editor.toPackage()).metadata,
    );
  });

  it("reads odp metadata through readOdpContent(doc.editor.toPackage())", () => {
    const doc = createNewDocument("odp");
    if (doc.format !== "odp") throw new Error("expected odp");
    expect(metadataFor(doc)).toEqual(
      readOdpContent(doc.editor.toPackage()).metadata,
    );
  });

  it("reads ods metadata through readOdsContent(doc.editor.toPackage())", () => {
    const doc = createNewDocument("ods");
    if (doc.format !== "ods") throw new Error("expected ods");
    expect(metadataFor(doc)).toEqual(
      readOdsContent(doc.editor.toPackage()).metadata,
    );
  });

  it("reads odg metadata through readOdgContent(doc.editor.toPackage())", () => {
    const doc = createNewDocument("odg");
    if (doc.format !== "odg") throw new Error("expected odg");
    expect(metadataFor(doc)).toEqual(
      readOdgContent(doc.editor.toPackage()).metadata,
    );
  });

  it("reads markdown metadata through readMarkdownContent(doc.editor.toMarkdownText())", () => {
    const doc = createNewDocument("markdown");
    if (doc.format !== "markdown") throw new Error("expected markdown");
    expect(metadataFor(doc)).toEqual(
      readMarkdownContent(doc.editor.toMarkdownText()).metadata,
    );
  });

  it("reads doc metadata directly off doc.editor.metadata", () => {
    const doc = createNewDocument("doc");
    if (doc.format !== "doc") throw new Error("expected doc");
    expect(metadataFor(doc)).toBe(doc.editor.metadata);
  });

  it("reads xls metadata directly off doc.editor.metadata", () => {
    const doc = createNewDocument("xls");
    if (doc.format !== "xls") throw new Error("expected xls");
    expect(metadataFor(doc)).toBe(doc.editor.metadata);
  });

  it("reads ppt metadata directly off doc.editor.metadata", () => {
    const doc = createNewDocument("ppt");
    if (doc.format !== "ppt") throw new Error("expected ppt");
    expect(metadataFor(doc)).toBe(doc.editor.metadata);
  });

  it("reads pdf metadata directly off doc.layout.metadata", () => {
    const doc = createNewDocument("pdf");
    if (doc.format !== "pdf") throw new Error("expected pdf");
    expect(metadataFor(doc)).toBe(doc.layout.metadata);
  });

  it("reads xlsx metadata directly off doc.layout.metadata", () => {
    const doc = readOnlyPreviewDocument("xlsx", "Xlsx Marker");
    expect(metadataFor(doc).title).toBe("Xlsx Marker");
  });

  it("reads csv metadata directly off doc.layout.metadata", () => {
    const doc = readOnlyPreviewDocument("csv", "Csv Marker");
    expect(metadataFor(doc).title).toBe("Csv Marker");
  });

  it("reads svg metadata directly off doc.layout.metadata", () => {
    const doc = readOnlyPreviewDocument("svg", "Svg Marker");
    expect(metadataFor(doc).title).toBe("Svg Marker");
  });

  it("reads rtf metadata directly off doc.layout.metadata", () => {
    const doc = readOnlyPreviewDocument("rtf", "Rtf Marker");
    expect(metadataFor(doc).title).toBe("Rtf Marker");
  });

  it("reads wpd metadata directly off doc.layout.metadata", () => {
    const doc = readOnlyPreviewDocument("wpd", "Wpd Marker");
    expect(metadataFor(doc).title).toBe("Wpd Marker");
  });

  it("reads epub metadata directly off doc.layout.metadata", () => {
    const doc = readOnlyPreviewDocument("epub", "Epub Marker");
    expect(metadataFor(doc).title).toBe("Epub Marker");
  });

  it("throws for odb, which has no document-level metadata concept", () => {
    const doc: OpenDocument = {
      format: "odb",
      tables: [],
      forms: [],
      reports: [],
      path: "a.odb",
    };
    expect(() => metadataFor(doc)).toThrow(/has no document-level metadata/);
  });
});
