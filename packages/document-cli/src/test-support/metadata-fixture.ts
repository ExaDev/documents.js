// Real documents.js-editor-built fixtures carrying known LayoutMetadata, shared by metadata.test.ts and set-metadata.test.ts. Every format's own live-view editor (DocxEditor, OdtEditor, ...) has no metadata setter at all -- a genuine documents.js-level gap, restated in this repo's own set-metadata.ts and the TUI's own metadata.tsx -- so a fixture with real metadata baked in has no shortcut: build a plain document through the editor, read it back into a ContentDocument, patch `.metadata` directly, then rebuild through that format's own buildXPackage. This is exactly the "ContentDocument full rebuild" write path set-metadata.ts itself implements, applied once here to seed a starting fixture rather than to patch an existing one.

import {
  type LayoutDocument,
  type LayoutMetadata,
  buildDocxPackage,
  buildOdtPackage,
  createDocx,
  createOdt,
  decodeDocumentPackage,
  decodePackage,
  encodeDocumentPackage,
  encodePackage,
  readDocxContent,
  readOdtContent,
  writePdf,
} from "documents.js";

export const METADATA_FIXTURE: LayoutMetadata = {
  title: "Quarterly Report",
  author: "Ada Lovelace",
  subject: "Q3 revenue summary",
  keywords: ["revenue", "quarterly", "summary"],
};

export const BODY_TEXT =
  "A paragraph proving the rest of the document survives.";

export function buildDocxWithMetadata(
  metadata: LayoutMetadata = METADATA_FIXTURE,
): Uint8Array<ArrayBuffer> {
  const editor = createDocx();
  editor.body.appendParagraph().appendRun({ text: BODY_TEXT });
  const content = readDocxContent(decodePackage(editor.toBytes()));
  const withMetadata = { ...content, metadata };
  return encodePackage(buildDocxPackage(withMetadata));
}

export function buildOdtWithMetadata(
  metadata: LayoutMetadata = METADATA_FIXTURE,
): Uint8Array<ArrayBuffer> {
  const editor = createOdt();
  editor.body.appendParagraph().appendRun({ text: BODY_TEXT });
  const content = readOdtContent(
    decodeDocumentPackage("odt", editor.toBytes()),
  );
  const withMetadata = { ...content, metadata };
  return encodeDocumentPackage("odt", buildOdtPackage(withMetadata));
}

// A minimal one-page PDF built directly from a hand-constructed LayoutDocument, rather than by converting the docx fixture above -- deterministic and independent of whether docxToPdf happens to carry ContentDocument.metadata across (it does, but this fixture should not depend on that fact to stay correct).
export function buildPdfWithMetadata(
  metadata: LayoutMetadata = METADATA_FIXTURE,
): Uint8Array<ArrayBuffer> {
  const layout: LayoutDocument = {
    formatVersion: 1,
    metadata,
    pages: [
      {
        widthPt: 595,
        heightPt: 842,
        items: [
          {
            kind: "text",
            text: BODY_TEXT,
            xPt: 72,
            yPt: 750,
            font: { family: "Helvetica", weight: "normal", style: "normal" },
            sizePt: 12,
            color: { r: 0, g: 0, b: 0 },
          },
        ],
      },
    ],
    images: {},
  };
  return writePdf(layout);
}
