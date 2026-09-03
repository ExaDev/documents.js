import type { DocumentFormat } from "documents.js";

// Ported from document-cli's src/format.ts (identical table also lives in document-mcp) -- pure data, not exported from documents.js itself. Template/macro-enabled variants (.dotx/.docm etc.) read as their base format.
const EXTENSION_TO_FORMAT: Readonly<Record<string, DocumentFormat>> = {
  docx: "docx",
  dotx: "docx",
  docm: "docx",
  pptx: "pptx",
  potx: "pptx",
  pptm: "pptx",
  xlsx: "xlsx",
  xltx: "xlsx",
  xlsm: "xlsx",
  odt: "odt",
  ott: "odt",
  odp: "odp",
  otp: "odp",
  ods: "ods",
  ots: "ods",
  odg: "odg",
  otg: "odg",
  odf: "odf",
  otf: "odf",
  csv: "csv",
  svg: "svg",
  markdown: "markdown",
  md: "markdown",
  pdf: "pdf",
  rtf: "rtf",
  doc: "doc",
  xls: "xls",
  ppt: "ppt",
};

// Reads the extension after the last '.' in the final path segment. Returns undefined for no recognised extension, an unrecognised one, or a path with none at all -- callers decide how to react to an unresolved format, this module only classifies.
export function inferFormatFromFilename(
  filename: string,
): DocumentFormat | undefined {
  const lastSegment = filename.split(/[/\\]/).pop() ?? filename;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) return undefined;
  const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_TO_FORMAT[extension];
}
