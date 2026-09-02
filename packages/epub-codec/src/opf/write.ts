import type { LayoutMetadata } from "document-schema.js";
import { buildXml } from "../xml/build";
import { encodeEntities } from "../xml/entities";
import type { Attribute, XmlElement, XmlNode } from "../xml/node";
import type { OpfManifestItem } from "./types";

// Builds the OPF package document EPUB 3.3 section 5.4 requires, the structural inverse of src/opf/parse.ts. A minimal valid EPUB 3 needs no more than this package's own writer ever emits: dc:title/dc:creator/dc:language/dc:date plus a generated dc:identifier (ExaDev/documents.js#801's own "OPF with a generated identifier" -- this package never attempts to preserve a source EPUB's original identifier across a read-then-write round trip, matching the issue's explicit write scope), the manifest (one item per part this package wrote -- the nav document, every section's XHTML, every embedded image), and the spine (one itemref per section, in the writer's own section order).

export interface WriteOpfInput {
  readonly metadata: LayoutMetadata;
  readonly manifestItems: readonly OpfManifestItem[];
  readonly spineIdrefs: readonly string[];
  readonly identifier: string;
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

function dcElement(tag: string, value: string): XmlElement {
  return element(tag, {}, [text(value)]);
}

export function writeOpf(input: WriteOpfInput): string {
  const metadataChildren: XmlNode[] = [
    element("dc:identifier", { id: "pub-id" }, [text(input.identifier)]),
  ];
  if (input.metadata.title !== undefined) {
    metadataChildren.push(dcElement("dc:title", input.metadata.title));
  }
  if (input.metadata.author !== undefined) {
    metadataChildren.push(dcElement("dc:creator", input.metadata.author));
  }
  for (const keyword of input.metadata.keywords ?? []) {
    metadataChildren.push(dcElement("dc:subject", keyword));
  }
  metadataChildren.push(
    dcElement("dc:language", input.metadata.language ?? "en"),
  );
  if (input.metadata.createdIso !== undefined) {
    metadataChildren.push(dcElement("dc:date", input.metadata.createdIso));
  }
  if (input.metadata.modifiedIso !== undefined) {
    metadataChildren.push(
      element("meta", { property: "dcterms:modified" }, [
        text(input.metadata.modifiedIso),
      ]),
    );
  }

  const manifestChildren = input.manifestItems.map((item) => {
    const attrs: Record<string, string> = {
      id: item.id,
      href: item.href,
      "media-type": item.mediaType,
    };
    if (item.properties.length > 0) {
      attrs.properties = item.properties.join(" ");
    }
    return element("item", attrs);
  });

  const spineChildren = input.spineIdrefs.map((idref) =>
    element("itemref", { idref }),
  );

  const packageElement = element(
    "package",
    {
      xmlns: "http://www.idpf.org/2007/opf",
      version: "3.0",
      "unique-identifier": "pub-id",
    },
    [
      element(
        "metadata",
        { "xmlns:dc": "http://purl.org/dc/elements/1.1/" },
        metadataChildren,
      ),
      element("manifest", {}, manifestChildren),
      element("spine", {}, spineChildren),
    ],
  );

  return `<?xml version="1.0" encoding="UTF-8"?>\n${buildXml([packageElement])}`;
}
