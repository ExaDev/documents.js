import type { ContentSection } from "document-schema.js";
import { buildXml } from "../xml/build";
import { encodeEntities } from "../xml/entities";
import type { Attribute, XmlElement, XmlNode } from "../xml/node";

// Builds a minimal, spec-valid EPUB 3 navigation document (EPUB 3.3 section 5.3.2): one <nav epub:type="toc"> entry per section, in spine order, each linking to that section's own XHTML document. A section's title is its first heading paragraph's own text; a section with no heading at all falls back to "Section N" (1-based) rather than an empty link label, which every accessible reading system requires a real one for.

export interface NavSectionEntry {
  readonly href: string;
  readonly section: ContentSection;
}

function element(
  tag: string,
  attrs: Record<string, string> = {},
  children: XmlNode[] = [],
): XmlElement {
  const attributes: Attribute[] = Object.entries(attrs).map(
    ([name, value]) => ({
      name,
      value,
    }),
  );
  return { type: "element", tag, attributes, children };
}

function text(value: string): XmlNode {
  return { type: "text", value: encodeEntities(value) };
}

function sectionTitle(section: ContentSection, index: number): string {
  for (const block of section.blocks) {
    if (block.kind === "paragraph" && block.headingLevel !== undefined) {
      const label = block.runs.map((run) => run.text).join("");
      if (label.trim().length > 0) {
        return label;
      }
    }
  }
  return `Section ${String(index + 1)}`;
}

export function writeNav3Document(entries: readonly NavSectionEntry[]): string {
  const items = entries.map((entry, index) =>
    element("li", {}, [
      element("a", { href: entry.href }, [
        text(sectionTitle(entry.section, index)),
      ]),
    ]),
  );
  const body = element("body", {}, [
    element("nav", { "epub:type": "toc" }, [
      element("h1", {}, [text("Table of Contents")]),
      element("ol", {}, items),
    ]),
  ]);
  const html = element(
    "html",
    {
      xmlns: "http://www.w3.org/1999/xhtml",
      "xmlns:epub": "http://www.idpf.org/2007/ops",
    },
    [body],
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${buildXml([html])}`;
}
