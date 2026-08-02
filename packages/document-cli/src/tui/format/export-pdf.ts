import { writeFile } from 'node:fs/promises';
import { docxToPdf, encodeMarkdownText, markdownToPdf, odgToPdf, odpToPdf, odsToPdf, odtToPdf, pptxToPdf, type DocumentToPdfOptions } from 'documents.js';
import type { Diagnostic, OpenDocument } from '../state/types.js';

export interface ExportToPdfOptions {
  readonly signal?: AbortSignal;
  readonly onDiagnostic: (diagnostic: Diagnostic) => void;
}

// documents.js's `WinAnsiSubstitution` fields are `from`/`to` -- the character that could not be represented in a standard-14 font, and the one written in its place.
function toPdfOptions(options: ExportToPdfOptions): DocumentToPdfOptions {
  return {
    signal: options.signal,
    onSubstitution: (substitution, context) => {
      options.onDiagnostic({ severity: 'info', message: `Substituted "${substitution.to}" for "${substitution.from}"`, pageIndex: context.pageIndex });
    },
  };
}

export async function exportToPdf(openDocument: OpenDocument, destinationPath: string, options: ExportToPdfOptions): Promise<void> {
  if (openDocument.format === 'odb' || openDocument.format === 'pdf') {
    throw new Error(`A ${openDocument.format} document is already a read-only source; there is no export-to-PDF path for it`);
  }
  const pdfOptions = toPdfOptions(options);
  // The one place the ContentDocument pivot ever touches a markdown document in this TUI -- markdownToPdf runs directly on the raw source text, never on edit or save.
  if (openDocument.format === 'markdown') {
    const pdfBytes = markdownToPdf(encodeMarkdownText(openDocument.source), pdfOptions);
    await writeFile(destinationPath, pdfBytes);
    return;
  }
  const bytes = openDocument.editor.toBytes();
  const pdfBytes = convert(openDocument.format, bytes, pdfOptions);
  await writeFile(destinationPath, pdfBytes);
}

function convert(format: 'docx' | 'pptx' | 'odt' | 'odp' | 'ods' | 'odg', bytes: Uint8Array<ArrayBuffer>, options: DocumentToPdfOptions): Uint8Array<ArrayBuffer> {
  switch (format) {
    case 'docx':
      return docxToPdf(bytes, options);
    case 'pptx':
      return pptxToPdf(bytes, options);
    case 'odt':
      return odtToPdf(bytes, options);
    case 'odp':
      return odpToPdf(bytes, options);
    case 'ods':
      return odsToPdf(bytes, options);
    case 'odg':
      return odgToPdf(bytes, options);
  }
}

// The default destination the export overlay and the `:export pdf` command offer when the user gives no path: the source path with its extension swapped. A source with no extension at all simply gains one.
export function defaultPdfPathFor(sourcePath: string): string {
  const lastSlash = Math.max(sourcePath.lastIndexOf('/'), sourcePath.lastIndexOf('\\'));
  const lastDot = sourcePath.lastIndexOf('.');
  return lastDot > lastSlash + 1 ? `${sourcePath.slice(0, lastDot)}.pdf` : `${sourcePath}.pdf`;
}
