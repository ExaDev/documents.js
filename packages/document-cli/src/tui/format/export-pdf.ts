import { writeFile } from "node:fs/promises";
import {
  convertDocument,
  csvToPdf,
  docxToPdf,
  encodeMarkdownText,
  markdownToPdf,
  odgToPdf,
  odpToPdf,
  odsToPdf,
  odtToPdf,
  pptxToPdf,
  svgToPdf,
  xlsxToPdf,
  type DocumentToPdfOptions,
  type ProvidedFont,
} from "documents.js";
import { loadProvidedFonts } from "../../runtime/fonts.js";
import type { Diagnostic, OpenDocument } from "../state/types.js";

export interface ExportToPdfOptions {
  readonly signal?: AbortSignal;
  readonly onDiagnostic: (diagnostic: Diagnostic) => void;
  // Local font files to make available to this export, in the order the user gave them. Paths rather than already-loaded ProvidedFont values: reading and describing a font file can fail (a mistyped path, a .woff, a text file), and this is the one call the export screens already wrap in their own error handling, so failing here puts the message in front of the user rather than somewhere they have to catch separately.
  readonly fontFiles?: readonly string[];
}

// documents.js's `WinAnsiSubstitution` fields are `from`/`to` -- the character that could not be represented in a standard-14 font, and the one written in its place. Exported so render-odb-report.ts's own odbReportToPdf call can build the identical DocumentToPdfOptions shape from its own RenderOdbReportOptions -- a structurally compatible superset of ExportToPdfOptions (same signal/onDiagnostic/fontFiles fields, plus reportName), so no adapter is needed at that call site.
export function toPdfOptions(
  options: ExportToPdfOptions,
  fonts: readonly ProvidedFont[],
): DocumentToPdfOptions {
  return {
    signal: options.signal,
    fonts,
    // A whole face falling back, rather than a single character: reported into the same diagnostics stream, since that is the channel the export screens already surface (and auto-open the panel for). Distinct from onSubstitution below, which is one character at a time -- a run drawn in a real embedded face never reaches WinAnsi encoding at all.
    onFontSubstitution: (substitution) => {
      const requested = `${substitution.requestedFamily}${substitution.requestedBold ? " bold" : ""}${substitution.requestedItalic ? " italic" : ""}`;
      options.onDiagnostic({
        severity: "info",
        message: `No "${requested}" face available; drew it in "${substitution.resolvedFamily}"`,
      });
    },
    onSubstitution: (substitution, context) => {
      options.onDiagnostic({
        severity: "info",
        message: `Substituted "${substitution.to}" for "${substitution.from}"`,
        pageIndex: context.pageIndex,
      });
    },
  };
}

export async function exportToPdf(
  openDocument: OpenDocument,
  destinationPath: string,
  options: ExportToPdfOptions,
): Promise<void> {
  // `odb` has no export-to-PDF path because it is read-only with no `ContentDocument` to convert; `pdf` has no export-to-PDF path for a different reason -- it is genuinely editable now (see PdfOpenDocument's own doc comment), but there is no docxToPdf-equivalent "convert a PDF to a PDF" conversion function, and there does not need to be one. Saving an edited PDF in place is `saveDocumentTo`'s job, not this one.
  if (openDocument.format === "odb" || openDocument.format === "pdf") {
    throw new Error(
      `A ${openDocument.format} document has no export-to-PDF path -- ${openDocument.format === "pdf" ? "save it directly instead" : "it is a read-only source with nothing to convert"}`,
    );
  }
  // Loaded before anything is converted or written, so a bad font path fails with nothing half-written at the destination.
  const fonts = await loadProvidedFonts(options.fontFiles ?? [], {
    signal: options.signal,
  });
  const pdfOptions = toPdfOptions(options, fonts);
  // markdownToPdf runs on whatever MarkdownEditor.toMarkdownText() produces right now (re-serialised fresh, matching saveDocumentTo's own convention), not on `originalText` -- an export reflects in-progress edits exactly like every other format's own `editor.toBytes()` does below.
  if (openDocument.format === "markdown") {
    const pdfBytes = markdownToPdf(
      encodeMarkdownText(openDocument.editor.toMarkdownText()),
      pdfOptions,
    );
    await writeFile(destinationPath, pdfBytes);
    return;
  }
  // xlsx has no editor to read current bytes from (see state/types.ts's own XlsxOpenDocument doc comment) -- the original bytes captured at open time are re-converted here, with this call's own real fonts/diagnostics options, rather than reusing the fixed preview conversion `openDocumentAtPath` computed to build the read-only viewer. csv, svg, and epub are the identical no-editor story (their own OpenDocument doc comments), each re-converted the same way -- epub has no named epubToPdf ergonomic function (it has no layout engine of its own, ExaDev/documents.js#802), so it re-runs through convertDocument's own epub -> pdf same-variant bridge instead.
  if (openDocument.format === "xlsx") {
    const pdfBytes = xlsxToPdf(openDocument.bytes, pdfOptions);
    await writeFile(destinationPath, pdfBytes);
    return;
  }
  if (openDocument.format === "csv") {
    const pdfBytes = csvToPdf(openDocument.bytes, pdfOptions);
    await writeFile(destinationPath, pdfBytes);
    return;
  }
  if (openDocument.format === "svg") {
    const pdfBytes = svgToPdf(openDocument.bytes, pdfOptions);
    await writeFile(destinationPath, pdfBytes);
    return;
  }
  if (openDocument.format === "epub") {
    const pdfBytes = convertDocument(
      "epub",
      "pdf",
      openDocument.bytes,
      pdfOptions,
    );
    await writeFile(destinationPath, pdfBytes);
    return;
  }
  const bytes = openDocument.editor.toBytes();
  const pdfBytes = convert(openDocument.format, bytes, pdfOptions);
  await writeFile(destinationPath, pdfBytes);
}

function convert(
  format: "docx" | "pptx" | "odt" | "odp" | "ods" | "odg",
  bytes: Uint8Array<ArrayBuffer>,
  options: DocumentToPdfOptions,
): Uint8Array<ArrayBuffer> {
  switch (format) {
    case "docx":
      return docxToPdf(bytes, options);
    case "pptx":
      return pptxToPdf(bytes, options);
    case "odt":
      return odtToPdf(bytes, options);
    case "odp":
      return odpToPdf(bytes, options);
    case "ods":
      return odsToPdf(bytes, options);
    case "odg":
      return odgToPdf(bytes, options);
  }
}

// The default destination the export overlay and the `:export pdf` command offer when the user gives no path: the source path with its extension swapped. A source with no extension at all simply gains one.
export function defaultPdfPathFor(sourcePath: string): string {
  const lastSlash = Math.max(
    sourcePath.lastIndexOf("/"),
    sourcePath.lastIndexOf("\\"),
  );
  const lastDot = sourcePath.lastIndexOf(".");
  return lastDot > lastSlash + 1
    ? `${sourcePath.slice(0, lastDot)}.pdf`
    : `${sourcePath}.pdf`;
}
