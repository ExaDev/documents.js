import type { ProjectionCategory } from "./projection";

/** What a projection does with one package part. `ignored` parts carry no content of their own: styles, themes, settings, relationships, properties, printer settings and rendering caches whose content another part holds. */
export type PartRole =
  | { readonly kind: "text"; readonly category: ProjectionCategory }
  | { readonly kind: "media"; readonly media: "image" | "embedding" }
  | { readonly kind: "unmodelled" }
  | { readonly kind: "ignored" };

const IGNORED: PartRole = { kind: "ignored" };
const UNMODELLED: PartRole = { kind: "unmodelled" };

const EMBEDDINGS_DIRECTORY = /(^|\/)embeddings\//;

// Parts that carry content of their own which neither projection reads: pivot data, external workbooks, macros, query and connection definitions, slicers, ActiveX controls, web extensions, and custom XML data stores. Reported by name so a consumer knows what a "no loss" verdict did not cover.
const UNMODELLED_CONTENT_TYPE =
  /(pivot|externalLink|vbaProject|vbaData|queryTable|connections|slicer|timeline|activeX|webextension)/i;
const CUSTOM_XML_ITEM = /^customXml\/item[0-9]+\.xml$/;

function mediaRole(
  name: string,
  contentType: string | undefined,
): PartRole | undefined {
  if (contentType?.startsWith("image/") === true) {
    return { kind: "media", media: "image" };
  }
  if (EMBEDDINGS_DIRECTORY.test(name)) {
    return { kind: "media", media: "embedding" };
  }
  return undefined;
}

function unmodelledRole(
  name: string,
  contentType: string | undefined,
): PartRole | undefined {
  if (
    CUSTOM_XML_ITEM.test(name) ||
    (contentType !== undefined && UNMODELLED_CONTENT_TYPE.test(contentType))
  ) {
    return UNMODELLED;
  }
  return undefined;
}

const DOCX_TEXT_ROLES: readonly (readonly [RegExp, ProjectionCategory])[] = [
  [
    /(wordprocessingml\.(document|template)\.main|ms-word\.(document\.macroEnabled|template\.macroEnabledTemplate)\.main)\+xml$/,
    "body",
  ],
  [/wordprocessingml\.document\.glossary\+xml$/, "body"],
  [/wordprocessingml\.(header|footer)\+xml$/, "headers-footers"],
  [/wordprocessingml\.(footnotes|endnotes)\+xml$/, "notes"],
  [/wordprocessingml\.comments\+xml$/, "comments"],
  [/drawingml\.chart\+xml$/, "charts"],
  // diagramData holds the text; diagramDrawing is a cached rendering of it and is ignored so the text is not counted twice.
  [/drawingml\.diagramData\+xml$/, "drawings"],
];

/** Classifies a docx package part from its declared content type. */
export function docxPartRole(
  name: string,
  contentType: string | undefined,
): PartRole {
  if (contentType !== undefined) {
    for (const [pattern, category] of DOCX_TEXT_ROLES) {
      if (pattern.test(contentType)) {
        return { kind: "text", category };
      }
    }
  }
  return (
    mediaRole(name, contentType) ?? unmodelledRole(name, contentType) ?? IGNORED
  );
}

/** The parts of an xlsx package a projection reads in a fixed order, because later ones depend on earlier ones. */
export type XlsxPartKind =
  | "workbook"
  | "worksheet"
  | "shared-strings"
  | "comments"
  | "threaded-comments"
  | "drawings"
  | "charts";

const XLSX_TEXT_ROLES: readonly (readonly [RegExp, XlsxPartKind])[] = [
  [
    /(spreadsheetml\.(sheet|template)\.main|ms-excel\.(sheet|template)\.macroEnabled\.main)\+xml$/,
    "workbook",
  ],
  [/spreadsheetml\.worksheet\+xml$/, "worksheet"],
  [/spreadsheetml\.sharedStrings\+xml$/, "shared-strings"],
  [/spreadsheetml\.comments\+xml$/, "comments"],
  [/ms-excel\.threadedcomments\+xml$/, "threaded-comments"],
  [
    /^application\/vnd\.openxmlformats-officedocument\.drawing\+xml$/,
    "drawings",
  ],
  [/drawingml\.diagramData\+xml$/, "drawings"],
  [/drawingml\.chart\+xml$/, "charts"],
];

/** Classifies an xlsx package part from its declared content type: one of the XML kinds the projection reads, or a role that needs no XML reading. */
export function xlsxPartRole(
  name: string,
  contentType: string | undefined,
): PartRole | { readonly kind: "xlsx"; readonly part: XlsxPartKind } {
  if (contentType !== undefined) {
    for (const [pattern, part] of XLSX_TEXT_ROLES) {
      if (pattern.test(contentType)) {
        return { kind: "xlsx", part };
      }
    }
  }
  return (
    mediaRole(name, contentType) ?? unmodelledRole(name, contentType) ?? IGNORED
  );
}
