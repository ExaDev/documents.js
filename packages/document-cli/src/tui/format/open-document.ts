import { readFile, writeFile } from "node:fs/promises";
import {
  createDocx,
  createOdg,
  createOdp,
  createOds,
  createOdt,
  createPdf,
  createPptx,
  csvToPdf,
  decodeMarkdownText,
  decodeOdbPackage,
  encodeMarkdownText,
  openDocx,
  openMarkdown,
  openOdg,
  openOdp,
  openOds,
  openOdt,
  openPdf,
  openPptx,
  readOdbForms,
  readOdbReports,
  readOdbTables,
  readPdf,
  rtfToPdf,
  svgToPdf,
  xlsxToPdf,
} from "documents.js";
import type {
  Diagnostic,
  EditableFormat,
  OpenDocument,
} from "../state/types.js";
import { detectFormat } from "./detect-format.js";

// The single place in the TUI that turns bytes into an open document. Every screen goes through here, so there is exactly one spot to look at when a format's opener changes. documents.js's own `decodeDocumentPackage(format, bytes)` dispatches to odf.js internally for every real `DocumentFormat` member (odt/odp/ods/odg/odf), but `.odb` is not one of those (see the note directly below), so it has no `DocumentFormat` string to pass -- this module uses documents.js's own `decodeOdbPackage` instead, the .odb-specific sibling that decodes the identical raw ODF container without going through odf.js directly.

// `.odb` is not a `DocumentFormat` member: documents.js deliberately keeps it out of the converter port (it has no PDF conversion and no write direction), so extension inference cannot classify it and this module checks for it directly.
const ODB_EXTENSION = ".odb";

export interface OpenDocumentAtPathOptions {
  // Only ever fires for a markdown document -- every other format's own opener (openDocx/openOdt/...) has no diagnostic sink of its own. Mirrors export-pdf.ts's own ExportToPdfOptions.onDiagnostic exactly, so a caller reports both the same way.
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
}

export async function openDocumentAtPath(
  path: string,
  options: OpenDocumentAtPathOptions = {},
): Promise<OpenDocument> {
  const bytes = new Uint8Array(await readFile(path));

  if (path.toLowerCase().endsWith(ODB_EXTENSION)) {
    // Decoded once and read three ways: tables come from the embedded database's own storage, forms and reports from static ODF sub-documents inside the same package. All three are resolved eagerly at open time rather than lazily per screen, because a `.odb` is opened read-only and none of the three can change afterwards -- there is nothing for a later read to pick up.
    const pkg = decodeOdbPackage(bytes);
    return {
      format: "odb",
      tables: readOdbTables(pkg),
      forms: readOdbForms(pkg),
      reports: readOdbReports(pkg),
      path,
    };
  }

  const format = detectFormat(path);
  if (format === undefined) {
    throw new Error(
      `Cannot tell what kind of document ${path} is from its extension`,
    );
  }

  switch (format) {
    case "docx":
      return { format, editor: openDocx(bytes), path };
    case "pptx":
      return { format, editor: openPptx(bytes), path };
    case "odt":
      return { format, editor: openOdt(bytes), path };
    case "odp":
      return { format, editor: openOdp(bytes), path };
    case "ods":
      return { format, editor: openOds(bytes), path };
    case "odg":
      return { format, editor: openOdg(bytes), path };
    case "pdf": {
      const editor = openPdf(bytes);
      return { format, editor, layout: editor.toLayoutDocument(), path };
    }
    // A real, structured MarkdownEditor now -- openMarkdown parses the decoded text into a genuine, mutable ContentDocument (see MarkdownOpenDocument's own doc comment). `originalText` keeps the literal text this document was opened with, for the read-only ':view-source' screen alone; it is never mutated and never fed back into the editor. Every diagnostic openMarkdown's own parse emits (a clamped heading level, dropped front-matter key, ...) is reported through the caller's onDiagnostic, the same channel exportToPdf's own onDiagnostic already populates state.diagnostics through.
    case "markdown": {
      const text = decodeMarkdownText(bytes);
      const editor = openMarkdown(text, {
        sink: (diagnostic) => {
          options.onDiagnostic?.({
            severity: diagnostic.severity,
            message: diagnostic.message,
          });
        },
      });
      return { format, editor, originalText: text, path };
    }
    // documents.js has no XlsxEditor and no readXlsxContent re-exported from its own public surface (see the doc comment on XlsxOpenDocument in state/types.ts), so a .xlsx opens read-only as a converted PDF preview: xlsxToPdf once here for the LayoutDocument the pdf page-list/page-items/item-detail screens already know how to browse, plus the original bytes kept alongside for a real export to re-run xlsxToPdf with the caller's own fonts/diagnostics later (see export-pdf.ts).
    case "xlsx":
      return { format, layout: readPdf(xlsxToPdf(bytes)), bytes, path };
    // csv and svg are the same read-only-preview shape as xlsx (see their own OpenDocument doc comments in state/types.ts): no editor exists for either text format, so each opens through its own to-Pdf conversion once and browses the result through the shared pdf screen family, with the original bytes kept for a real export to re-convert with the caller's own fonts/diagnostics later.
    case "csv":
      return { format, layout: readPdf(csvToPdf(bytes)), bytes, path };
    case "svg":
      return { format, layout: readPdf(svgToPdf(bytes)), bytes, path };
    // rtf mirrors xlsx/csv/svg exactly: no live-view editor and no readRtfContent-shaped content reader wired into this TUI's editor screens, but a real rtfToPdf conversion -- opened read-only through the identical to-Pdf-then-readPdf shape.
    case "rtf":
      return { format, layout: readPdf(rtfToPdf(bytes)), bytes, path };
    case "odf":
      throw new Error(
        "A standalone .odf formula document has no editor; convert it to PDF (odfToPdf) instead",
      );
  }
}

export function createNewDocument(format: EditableFormat): OpenDocument {
  switch (format) {
    case "docx":
      return { format, editor: createDocx(), path: undefined };
    case "pptx":
      return { format, editor: createPptx(), path: undefined };
    case "odt":
      return { format, editor: createOdt(), path: undefined };
    case "odp":
      return { format, editor: createOdp(), path: undefined };
    case "ods":
      return { format, editor: createOds(), path: undefined };
    case "odg":
      return { format, editor: createOdg(), path: undefined };
    case "pdf": {
      const editor = createPdf();
      return {
        format,
        editor,
        layout: editor.toLayoutDocument(),
        path: undefined,
      };
    }
  }
}

export async function saveDocumentTo(
  openDocument: OpenDocument,
  path: string,
): Promise<void> {
  if (
    openDocument.format === "odb" ||
    openDocument.format === "xlsx" ||
    openDocument.format === "csv" ||
    openDocument.format === "svg" ||
    openDocument.format === "rtf"
  ) {
    throw new Error(
      `A ${openDocument.format} document is opened read-only and cannot be written back`,
    );
  }
  // MarkdownEditor has no toBytes() (see MarkdownOpenDocument's own doc comment) -- every save re-serialises the whole document fresh through buildMarkdownText (via toMarkdownText()), even one with no edits at all this session. This is a deliberate, permanent consequence of structured editing, not something to work around: a live-view paragraph/run tree has no "untouched bytes" to leave alone the way a docx's XmlElement tree does, so the written text can legitimately differ from whatever was last on disk (heading style, bullet marker, line-ending normalisation -- see README.md's own markdown Gotchas).
  if (openDocument.format === "markdown") {
    await writeFile(
      path,
      encodeMarkdownText(openDocument.editor.toMarkdownText()),
    );
    return;
  }
  await writeFile(path, openDocument.editor.toBytes());
}
