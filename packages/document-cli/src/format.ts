import type { DocumentFormat } from 'documents.js';

const EXTENSION_TO_FORMAT: Readonly<Record<string, DocumentFormat>> = {
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  odt: 'odt',
  odp: 'odp',
  ods: 'ods',
  odg: 'odg',
  odf: 'odf',
  pdf: 'pdf',
};

const FORMAT_TO_EXTENSION: Readonly<Record<DocumentFormat, string>> = {
  docx: 'docx',
  pptx: 'pptx',
  xlsx: 'xlsx',
  odt: 'odt',
  odp: 'odp',
  ods: 'ods',
  odg: 'odg',
  odf: 'odf',
  pdf: 'pdf',
};

export function isDocumentFormat(value: string): value is DocumentFormat {
  return value in FORMAT_TO_EXTENSION;
}

// Reads the extension after the last '.' in the final path segment (so 'a.b/c.docx' -> 'docx', '.gitignore' -> undefined -- a leading dot with no further '.' is not an extension). Returns undefined for no recognised extension, an unrecognised one, a bare '-' (stdin/stdout marker), or a path with none at all -- callers decide how to react to an unresolved format, this module only classifies.
export function inferFormatFromExtension(path: string): DocumentFormat | undefined {
  if (path === '-') {
    return undefined;
  }
  const lastSegment = path.split(/[/\\]/).pop() ?? path;
  const dotIndex = lastSegment.lastIndexOf('.');
  if (dotIndex <= 0) {
    return undefined;
  }
  const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_TO_FORMAT[extension];
}

export function formatToExtension(format: DocumentFormat): string {
  return FORMAT_TO_EXTENSION[format];
}
