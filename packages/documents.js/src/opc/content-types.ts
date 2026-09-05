import type { Package, XmlElement } from "ooxml.js";
import { attr, rootElement } from "ooxml.js";
import { el } from "../xml/fragment";

const CONTENT_TYPES_PART_PATH = "[Content_Types].xml";
const CONTENT_TYPES_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/content-types";

const DEFAULT_CONTENT_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
};

export function defaultContentTypeForExtension(extension: string): string {
  const contentType = DEFAULT_CONTENT_TYPES[extension.toLowerCase()];
  if (contentType === undefined) {
    throw new Error(
      `no known default content type for extension: ${extension}`,
    );
  }
  return contentType;
}

function ensureContentTypesRoot(pkg: Package): XmlElement {
  const existingRoot = rootElement(pkg.parts[CONTENT_TYPES_PART_PATH]);
  if (existingRoot !== undefined) {
    return existingRoot;
  }
  const root = el("Types", { xmlns: CONTENT_TYPES_NAMESPACE });
  pkg.parts[CONTENT_TYPES_PART_PATH] = { kind: "xml", nodes: [root] };
  return root;
}

// Ensures [Content_Types].xml has a <Default Extension="..." ContentType="..."/> entry for the given file extension (without the leading dot), adding one if absent. Missing this entry is the single most common reason a hand-built OOXML package fails to open.
export function ensureDefaultContentType(
  pkg: Package,
  extension: string,
  contentType: string,
): void {
  const root = ensureContentTypesRoot(pkg);
  for (const child of root.children) {
    if (
      child.type === "element" &&
      child.tag === "Default" &&
      attr(child, "Extension") === extension
    ) {
      return;
    }
  }
  root.children.push(
    el("Default", { Extension: extension, ContentType: contentType }),
  );
}

// Ensures [Content_Types].xml has an <Override PartName="/..." ContentType="..."/> entry for the given part path, adding one if absent. An Override is needed for a part whose content type differs from its extension's Default (e.g. every OOXML "main" XML part).
export function ensureContentTypeOverride(
  pkg: Package,
  partPath: string,
  contentType: string,
): void {
  const root = ensureContentTypesRoot(pkg);
  const partName = `/${partPath}`;
  for (const child of root.children) {
    if (
      child.type === "element" &&
      child.tag === "Override" &&
      attr(child, "PartName") === partName
    ) {
      return;
    }
  }
  root.children.push(
    el("Override", { PartName: partName, ContentType: contentType }),
  );
}
