import {
  type LayoutMetadata,
  readDocxContent,
  readMarkdownContent,
  readOdgContent,
  readOdpContent,
  readOdsContent,
  readOdtContent,
  readPptxContent,
} from "documents.js";
import type { OpenDocument } from "../state/types.js";

// The single place in the TUI that turns an OpenDocument into its own LayoutMetadata, mirroring export-pdf.ts's own per-format dispatch style. docx/pptx/odt/odp/ods/odg all read `doc.editor.toPackage()` -- the live view's own already-decoded package (ooxml.js's for docx/pptx, odf.js's for odt/odp/ods/odg; see state/types.ts's own RULE at the top of the file for why this is called fresh on every render rather than cached), fed straight into that format's own readXContent. markdown has a live-view MarkdownEditor but no package at all -- `readMarkdownContent` runs on `doc.editor.toMarkdownText()` (re-serialised fresh, reflecting in-progress edits, matching export-pdf.ts's own convention), the same role `.editor.toPackage()` plays elsewhere. pdf, xlsx, csv, svg, and rtf all already carry a LayoutMetadata directly on `.layout` (each read-only preview format's own `.layout` is the throwaway to-Pdf-then-readPdf conversion open-document.ts already computed at open time -- see that module's own XlsxOpenDocument/CsvOpenDocument/SvgOpenDocument/RtfOpenDocument doc comments), so none of them needs a read call here at all. odb has no document-level metadata concept anywhere in this codebase (it is a table/form/report container, not a single document with its own title/author/etc.) -- this throws rather than fabricating an empty LayoutMetadata, and the metadata screen itself is the one place that catches it and shows a plain message instead of crashing.
export function metadataFor(doc: OpenDocument): LayoutMetadata {
  switch (doc.format) {
    case "docx":
      return readDocxContent(doc.editor.toPackage()).metadata;
    case "pptx":
      return readPptxContent(doc.editor.toPackage()).metadata;
    case "odt":
      return readOdtContent(doc.editor.toPackage()).metadata;
    case "odp":
      return readOdpContent(doc.editor.toPackage()).metadata;
    case "ods":
      return readOdsContent(doc.editor.toPackage()).metadata;
    case "odg":
      return readOdgContent(doc.editor.toPackage()).metadata;
    case "markdown":
      return readMarkdownContent(doc.editor.toMarkdownText()).metadata;
    case "pdf":
    case "xlsx":
    case "csv":
    case "svg":
    case "rtf":
      return doc.layout.metadata;
    case "odb":
      throw new Error(
        "A .odb database has no document-level metadata -- it is a table/form/report container, not a single document with its own title/author/etc.",
      );
  }
}
