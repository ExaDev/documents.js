// The OOXML name constants of the docx writer, split from write.ts: XML namespaces, relationship types, content types, embedded-part content types and canonical part paths. Pure data, no behaviour.
export const WML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
export const REL_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const PKG_RELS_NS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
export const CONTENT_TYPES_NS =
  "http://schemas.openxmlformats.org/package/2006/content-types";
export const CORE_PROPS_NS =
  "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
export const DC_NS = "http://purl.org/dc/elements/1.1/";
export const DCTERMS_NS = "http://purl.org/dc/terms/";
export const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";
export const EXTENDED_PROPS_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
export const DRAWINGML_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/main";
export const DRAWING_WP_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
export const DRAWING_PIC_NS =
  "http://schemas.openxmlformats.org/drawingml/2006/picture";
export const MARKUP_COMPAT_NS =
  "http://schemas.openxmlformats.org/markup-compatibility/2006";
export const W14_NS = "http://schemas.microsoft.com/office/word/2010/wordml";
export const W15_NS = "http://schemas.microsoft.com/office/word/2012/wordml";
export const VML_OFFICE_NS = "urn:schemas-microsoft-com:office:office";

export const CT_DOCUMENT =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
export const CT_CORE_PROPS =
  "application/vnd.openxmlformats-package.core-properties+xml";
export const CT_EXTENDED_PROPS =
  "application/vnd.openxmlformats-officedocument.extended-properties+xml";
export const CT_EMBEDDED_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const CT_EMBEDDED_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const CT_EMBEDDED_PPTX =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
export const CT_STYLES =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml";
export const CT_NUMBERING =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml";
export const CT_COMMENTS =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml";
export const CT_FOOTNOTES =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml";
export const CT_ENDNOTES =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml";
export const CT_HEADER =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml";
export const CT_FOOTER =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml";

// The content type an embeddings part is declared with, by the extension the payload serialised into — each names the format of the nested document the part holds, so an Override can declare exactly that part without claiming anything about other files sharing the extension elsewhere.
export const EMBEDDED_PART_CONTENT_TYPES: Readonly<
  Record<"docx" | "xlsx" | "pptx", string>
> = { docx: CT_EMBEDDED_DOCX, xlsx: CT_EMBEDDED_XLSX, pptx: CT_EMBEDDED_PPTX };

export const REL_OFFICE_DOCUMENT = `${REL_NS}/officeDocument`;
export const REL_CORE_PROPS = `${PKG_RELS_NS}/metadata/core-properties`;
export const REL_EXTENDED_PROPS = `${REL_NS}/extended-properties`;
export const REL_HYPERLINK = `${REL_NS}/hyperlink`;
export const REL_IMAGE = `${REL_NS}/image`;
export const REL_OLE_OBJECT = `${REL_NS}/oleObject`;
export const REL_STYLES = `${REL_NS}/styles`;
export const REL_NUMBERING = `${REL_NS}/numbering`;
export const REL_COMMENTS = `${REL_NS}/comments`;
export const REL_FOOTNOTES = `${REL_NS}/footnotes`;
export const REL_ENDNOTES = `${REL_NS}/endnotes`;
export const REL_HEADER = `${REL_NS}/header`;
export const REL_FOOTER = `${REL_NS}/footer`;

export const DOCUMENT_PART_PATH = "word/document.xml";
export const STYLES_PART_PATH = "word/styles.xml";
export const COMMENTS_PART_PATH = "word/comments.xml";
export const FOOTNOTES_PART_PATH = "word/footnotes.xml";
export const ENDNOTES_PART_PATH = "word/endnotes.xml";

// The input readDocxContent's own output satisfies directly (a DocxDocument is assignable to it): every field beyond metadata/sections is optional here so a caller building a DocxContent by hand — most of this package's own tests, some of documents.js's — need not populate parts it does not care about, while a genuine DocxDocument (every field always present, several as empty arrays/records rather than absent) still assigns straight across.
