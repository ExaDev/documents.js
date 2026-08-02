import { readFile, writeFile } from 'node:fs/promises';
import { createDocx, createOdg, createOdp, createOds, createOdt, createPptx, decodeMarkdownText, encodeMarkdownText, openDocx, openOdg, openOdp, openOds, openOdt, openPptx, readOdbTables, readPdf } from 'documents.js';
import { decodePackage } from 'odf.js';
import type { EditableFormat, OpenDocument } from '../state/types.js';
import { detectFormat } from './detect-format.js';

// The single place in the TUI that turns bytes into an open document. Every screen goes through here, so there is exactly one spot to look at when a format's opener changes, and exactly one import of odf.js's `decodePackage` -- documents.js re-exports ooxml.js's function under the same name, and that one cannot read an ODF package at all.

// `.odb` is not a `DocumentFormat` member: documents.js deliberately keeps it out of the converter port (it has no PDF conversion and no write direction), so extension inference cannot classify it and this module checks for it directly.
const ODB_EXTENSION = '.odb';

export async function openDocumentAtPath(path: string): Promise<OpenDocument> {
  const bytes = new Uint8Array(await readFile(path));

  if (path.toLowerCase().endsWith(ODB_EXTENSION)) {
    return { format: 'odb', tables: readOdbTables(decodePackage(bytes)), path };
  }

  const format = detectFormat(path);
  if (format === undefined) {
    throw new Error(`Cannot tell what kind of document ${path} is from its extension`);
  }

  switch (format) {
    case 'docx':
      return { format, editor: openDocx(bytes), path };
    case 'pptx':
      return { format, editor: openPptx(bytes), path };
    case 'odt':
      return { format, editor: openOdt(bytes), path };
    case 'odp':
      return { format, editor: openOdp(bytes), path };
    case 'ods':
      return { format, editor: openOds(bytes), path };
    case 'odg':
      return { format, editor: openOdg(bytes), path };
    case 'pdf':
      return { format, layout: readPdf(bytes), path };
    // No read/write round trip through markdown-codec here at all -- opening a .md file loads its raw text as `.source` verbatim, exactly the byte<->text boundary decodeMarkdownText already exists for (see documents.js's own src/markdown/text.ts). The ContentDocument pivot (readMarkdownContent) only ever enters on cross-format export -- see export-pdf.ts.
    case 'markdown':
      return { format, source: decodeMarkdownText(bytes), path };
    case 'xlsx':
      throw new Error('documents.js has no xlsx editor; convert the workbook to ods first (xlsxToOds) and open that');
    case 'odf':
      throw new Error('A standalone .odf formula document has no editor; convert it to PDF (odfToPdf) instead');
  }
}

export function createNewDocument(format: EditableFormat): OpenDocument {
  switch (format) {
    case 'docx':
      return { format, editor: createDocx(), path: undefined };
    case 'pptx':
      return { format, editor: createPptx(), path: undefined };
    case 'odt':
      return { format, editor: createOdt(), path: undefined };
    case 'odp':
      return { format, editor: createOdp(), path: undefined };
    case 'ods':
      return { format, editor: createOds(), path: undefined };
    case 'odg':
      return { format, editor: createOdg(), path: undefined };
  }
}

export async function saveDocumentTo(openDocument: OpenDocument, path: string): Promise<void> {
  if (openDocument.format === 'odb' || openDocument.format === 'pdf') {
    throw new Error(`A ${openDocument.format} document is opened read-only and cannot be written back`);
  }
  // Markdown has no editor object at all -- `.source` is written back to disk literally, the same byte<->text boundary opening it went through in reverse, never through markdown-codec's own readMarkdown/writeMarkdown.
  if (openDocument.format === 'markdown') {
    await writeFile(path, encodeMarkdownText(openDocument.source));
    return;
  }
  await writeFile(path, openDocument.editor.toBytes());
}
