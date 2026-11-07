// The namespace URIs OOXML spells in two ways: ECMA-376 Transitional (what Office writes) and the Strict variant (ISO/IEC 29500 Strict, on purl.oclc.org). A reader of either must recognise both, so each role is a set.

/** Whether a namespace URI plays a role. */
export type NamespaceRole = ReadonlySet<string>;

export const WORDPROCESSINGML: NamespaceRole = new Set([
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  "http://purl.oclc.org/ooxml/wordprocessingml/main",
]);

export const SPREADSHEETML: NamespaceRole = new Set([
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  "http://purl.oclc.org/ooxml/spreadsheetml/main",
]);

export const DRAWINGML: NamespaceRole = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/main",
  "http://purl.oclc.org/ooxml/drawingml/main",
]);

export const OFFICE_MATH: NamespaceRole = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/math",
  "http://purl.oclc.org/ooxml/officeDocument/math",
]);

export const CHART: NamespaceRole = new Set([
  "http://schemas.openxmlformats.org/drawingml/2006/chart",
  "http://purl.oclc.org/ooxml/drawingml/chart",
]);

export const OFFICE_RELATIONSHIPS: NamespaceRole = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);

export const PACKAGE_RELATIONSHIPS: NamespaceRole = new Set([
  "http://schemas.openxmlformats.org/package/2006/relationships",
]);

export const MARKUP_COMPATIBILITY: NamespaceRole = new Set([
  "http://schemas.openxmlformats.org/markup-compatibility/2006",
]);

export const THREADED_COMMENTS: NamespaceRole = new Set([
  "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments",
]);
