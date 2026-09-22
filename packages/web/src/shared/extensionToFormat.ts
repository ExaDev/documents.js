import type { DocumentFormat } from "documents.js";

// Ported from document-cli's src/format.ts (identical table also lives in document-mcp) — pure data, not exported from documents.js itself. Template/macro-enabled variants (.dotx/.docm etc.) read as their base format.
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
  epub: "epub",
};

// Reads the extension after the last '.' in the final path segment. Returns undefined for no recognised extension, an unrecognised one, or a path with none at all — callers decide how to react to an unresolved format, this module only classifies. The final segment is found via the last separator's own index rather than `split(...).pop()`: splitting a string always yields an array of at least one element, so `.pop()` can never actually return undefined and a `?? filename` fallback for that case would be unreachable — lastIndexOf's -1 "not found" sentinel is a real, already-exercised case (a filename with no separator at all), not a defensive guess.
export function inferFormatFromFilename(
  filename: string,
): DocumentFormat | undefined {
  const lastSeparator = Math.max(
    filename.lastIndexOf("/"),
    filename.lastIndexOf("\\"),
  );
  const lastSegment = filename.slice(lastSeparator + 1);
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) return undefined;
  const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_TO_FORMAT[extension];
}
