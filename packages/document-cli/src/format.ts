import type { DocumentFormat } from "documents.js";

// 'md' and 'markdown' both read as the 'markdown' DocumentFormat, and every ODF/OOXML template and macro-enabled variant reads as its base format -- the many-to-one entries this table carries, deliberately breaking what was previously a perfect mirror with FORMAT_TO_EXTENSION (every base format's own extension is also its canonical one). A template (.ott/.ots/.otp/.otg/.otf) is the same package as its non-template sibling with only the mimetype's own "-template" suffix differing, and a macro-enabled OOXML file (.docm/.xlsm/.pptm) is the same package with a vbaProject part this library reads past (macros are never executed or re-emitted); so both read through the base codec unchanged. FORMAT_TO_EXTENSION below still names exactly one extension per format, so writing always picks the canonical base extension.
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
  rtf: "rtf",
  wpd: "wpd",
  doc: "doc",
  xls: "xls",
  ppt: "ppt",
  pdf: "pdf",
};

const FORMAT_TO_EXTENSION: Readonly<Record<DocumentFormat, string>> = {
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  odt: "odt",
  odp: "odp",
  ods: "ods",
  odg: "odg",
  odf: "odf",
  csv: "csv",
  svg: "svg",
  markdown: "md",
  rtf: "rtf",
  wpd: "wpd",
  doc: "doc",
  xls: "xls",
  ppt: "ppt",
  pdf: "pdf",
};

export function isDocumentFormat(value: string): value is DocumentFormat {
  return value in FORMAT_TO_EXTENSION;
}

// Reads the extension after the last '.' in the final path segment (so 'a.b/c.docx' -> 'docx', '.gitignore' -> undefined -- a leading dot with no further '.' is not an extension). Returns undefined for no recognised extension, an unrecognised one, a bare '-' (stdin/stdout marker), or a path with none at all -- callers decide how to react to an unresolved format, this module only classifies.
export function inferFormatFromExtension(
  path: string,
): DocumentFormat | undefined {
  if (path === "-") {
    return undefined;
  }
  const lastSegment = path.split(/[/\\]/).pop() ?? path;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex <= 0) {
    return undefined;
  }
  const extension = lastSegment.slice(dotIndex + 1).toLowerCase();
  return EXTENSION_TO_FORMAT[extension];
}

export function formatToExtension(format: DocumentFormat): string {
  return FORMAT_TO_EXTENSION[format];
}
