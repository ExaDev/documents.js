import type { Package, XmlElement } from "odf.js";
import { attr } from "ooxml.js";
import { el } from "../../xml/fragment";

export const CONTENT_PART_PATH = "content.xml";

// odf.js's own StyleRegistry (src/styles/registry.ts) privately finds-or-creates office:automatic-styles as part of StyleRegistry.forPart, but does not export that helper on its own -- this is a minimal, behaviour-matching reimplementation (the identical insertion-order rule: before office:body/office:master-styles/office:settings, whichever comes first, else appended) scoped to the handful of ODF style constructs StyleRegistry's own StyleProperties schema cannot express at all: table-column width (style:table-column-properties/@style:column-width), list-level bullet definitions (text:list-style), and a paragraph's page-break-before (style:paragraph-properties/@fo:break-before). See this module's own callers (table.ts, list.ts, editor.ts) for each.
export function ensureAutomaticStyles(pkg: Package): XmlElement {
  const part = pkg.parts[CONTENT_PART_PATH];
  if (part?.kind !== "xml") {
    throw new Error(
      `ensureAutomaticStyles: package has no ${CONTENT_PART_PATH} part`,
    );
  }
  const root = part.nodes.find((n): n is XmlElement => n.type === "element");
  if (root === undefined) {
    throw new Error(
      `ensureAutomaticStyles: ${CONTENT_PART_PATH} has no root element`,
    );
  }
  for (const child of root.children) {
    if (child.type === "element" && child.tag === "office:automatic-styles") {
      return child;
    }
  }
  const created = el("office:automatic-styles");
  const insertBeforeTags = new Set([
    "office:body",
    "office:master-styles",
    "office:settings",
  ]);
  const insertIndex = root.children.findIndex(
    (n) => n.type === "element" && insertBeforeTags.has(n.tag),
  );
  if (insertIndex === -1) {
    root.children.push(created);
  } else {
    root.children.splice(insertIndex, 0, created);
  }
  return created;
}

// Scans `automaticStyles` for the highest existing `${prefix}N` name (on an element with the given tag) and returns one past it -- mirrors src/edit/pptx/slide.ts's own nextIdIn ("scan for the highest existing id, never guess"), adapted from PowerPoint's numeric shape ids to ODF's string-named styles. Never mutates or removes anything it finds; the caller is responsible for actually appending the newly-named element, keeping this in line with StyleRegistry.intern's own append-only contract (see props.ts).
export function nextStyleName(
  automaticStyles: XmlElement,
  tag: string,
  prefix: string,
): string {
  let max = 0;
  for (const child of automaticStyles.children) {
    if (child.type !== "element" || child.tag !== tag) {
      continue;
    }
    const name = attr(child, "style:name");
    if (!name?.startsWith(prefix)) {
      continue;
    }
    const rest = name.slice(prefix.length);
    const n = Number.parseInt(rest, 10);
    if (!Number.isNaN(n) && String(n) === rest && n > max) {
      max = n;
    }
  }
  return `${prefix}${max + 1}`;
}

// A single, shared, idempotently-created paragraph style carrying fo:break-before="page". ODF has no inline "hard page break" content element the way WordprocessingML's w:br/@w:type="page" is (see docx's own DocxBody.appendPageBreak, src/edit/docx/editor.ts) -- a manual page break is exclusively a paragraph-style property, so OdtBody.appendPageBreak (editor.ts) inserts an empty paragraph pointed at this style. Reused across every call (looked up by its fixed name, never re-minted) since there is exactly one way to want "a page break here" -- unlike table-column widths or list bullet styles, there is no varying property set that would ever need a second, differently-fingerprinted entry.
const PAGE_BREAK_STYLE_NAME = "OdtPageBreak";

export function ensurePageBreakStyleName(pkg: Package): string {
  const automaticStyles = ensureAutomaticStyles(pkg);
  const existing = automaticStyles.children.find(
    (c) =>
      c.type === "element" &&
      c.tag === "style:style" &&
      attr(c, "style:name") === PAGE_BREAK_STYLE_NAME,
  );
  if (existing !== undefined) {
    return PAGE_BREAK_STYLE_NAME;
  }
  automaticStyles.children.push(
    el(
      "style:style",
      { "style:name": PAGE_BREAK_STYLE_NAME, "style:family": "paragraph" },
      [el("style:paragraph-properties", { "fo:break-before": "page" })],
    ),
  );
  return PAGE_BREAK_STYLE_NAME;
}
