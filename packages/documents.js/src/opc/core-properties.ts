import type { LayoutMetadata } from "document-schema.js";
import type { Package, XmlElement, XmlNode } from "ooxml.js";
import { encodeXmlText } from "../xml/entities";
import { el, txt } from "../xml/fragment";
import { ensureContentTypeOverride } from "./content-types";
import { addRootRelationship } from "./rels";

const CORE_PROPERTIES_PART_PATH = "docProps/core.xml";
const CORE_PROPERTIES_CONTENT_TYPE =
  "application/vnd.openxmlformats-package.core-properties+xml";
const CORE_PROPERTIES_REL_TYPE =
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties";

const CP_NS =
  "http://schemas.openxmlformats.org/package/2006/metadata/core-properties";
const DC_NS = "http://purl.org/dc/elements/1.1/";
const DCTERMS_NS = "http://purl.org/dc/terms/";
const XSI_NS = "http://www.w3.org/2001/XMLSchema-instance";

const W3CDTF_TYPE = "dcterms:W3CDTF";

function declaration(): XmlNode {
  return {
    type: "declaration",
    attributes: [
      { name: "version", value: "1.0" },
      { name: "encoding", value: "UTF-8" },
      { name: "standalone", value: "yes" },
    ],
  };
}

function textElement(tag: string, value: string): XmlElement {
  return el(tag, {}, [txt(encodeXmlText(value))]);
}

// dcterms:created/dcterms:modified both require xsi:type="dcterms:W3CDTF" per the OPC core-properties schema -- without it a strict reader has no declared type for the date-typed element's own text content.
function dateElement(tag: string, isoValue: string): XmlElement {
  return el(tag, { "xsi:type": W3CDTF_TYPE }, [txt(encodeXmlText(isoValue))]);
}

// Builds and inserts a real docProps/core.xml part -- OPC's own package-level core properties (dc:title, dc:creator, dc:subject, cp:keywords, dcterms:created, dcterms:modified) -- from a LayoutMetadata value, registers its content type, and adds the package-ROOT relationship a real OOXML reader needs to discover it at all. The one new part createEmptyDocxPackage/createEmptyPptxPackage write, and only when a caller supplies metadata (see those scaffolds' own optional `options.metadata`).
//
// dc:creator carries metadata.AUTHOR (the human byline) -- NOT metadata.creator, which in document-schema.js's own LayoutMetadata names the ORIGINATING APPLICATION and has no OOXML core-properties counterpart at all: that concept belongs to docProps/app.xml's own Application element, which this function deliberately does not write (a smaller, separate follow-up, not attempted here). This is the exact inverse of ooxml.js's own readCoreProperties, which reads dc:creator back into .author and docProps/app.xml's Application back into .creator.
export function addCoreProperties(
  pkg: Package,
  metadata: LayoutMetadata,
): void {
  const children: XmlElement[] = [];
  if (metadata.title !== undefined) {
    children.push(textElement("dc:title", metadata.title));
  }
  if (metadata.author !== undefined) {
    children.push(textElement("dc:creator", metadata.author));
  }
  if (metadata.subject !== undefined) {
    children.push(textElement("dc:subject", metadata.subject));
  }
  if (metadata.keywords !== undefined && metadata.keywords.length > 0) {
    children.push(textElement("cp:keywords", metadata.keywords.join(", ")));
  }
  if (metadata.createdIso !== undefined) {
    children.push(dateElement("dcterms:created", metadata.createdIso));
  }
  if (metadata.modifiedIso !== undefined) {
    children.push(dateElement("dcterms:modified", metadata.modifiedIso));
  }

  const root = el(
    "cp:coreProperties",
    {
      "xmlns:cp": CP_NS,
      "xmlns:dc": DC_NS,
      "xmlns:dcterms": DCTERMS_NS,
      "xmlns:xsi": XSI_NS,
    },
    children,
  );
  pkg.parts[CORE_PROPERTIES_PART_PATH] = {
    kind: "xml",
    nodes: [declaration(), root],
  };
  ensureContentTypeOverride(
    pkg,
    CORE_PROPERTIES_PART_PATH,
    CORE_PROPERTIES_CONTENT_TYPE,
  );
  addRootRelationship(pkg, {
    type: CORE_PROPERTIES_REL_TYPE,
    target: CORE_PROPERTIES_PART_PATH,
  });
}
