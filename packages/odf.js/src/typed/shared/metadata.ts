import type { LayoutMetadata } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement, XmlNode } from "../../model/node";
import {
  rootElement,
  findChildElement,
  childrenWithTag,
} from "../../xml/query";
import { decodeXmlText, encodeXmlText } from "../../xml/entities";
import { el, txt } from "../../xml/fragment";
import { ODF_NAMESPACES, xmlnsAttributes } from "../../ns";

// Reads meta.xml (office:document-meta / office:meta) into document-schema.js's LayoutMetadata shape. Every element name below was verified against real LibreOffice 26.2 output -- both genuine user-authored documents (LibreOffice's own bundled .ott/.ots/.otp templates under /Applications/LibreOffice.app/Contents/Resources/template/**, which carry real author/date metadata from having actually been edited and saved) and the OASIS ODF schema itself (datypic.com's office:meta content-model reference) -- rather than assumed to mirror OOXML's docProps/core.xml one-for-one. Two mappings are genuinely non-obvious and were confirmed, not guessed:
// - ODF's `dc:creator` is NOT "the document's author" the way OOXML's dc:creator is -- confirmed from several real LibreOffice-authored templates (e.g. CV.ott, the l10n normal templates): `dc:creator` records whoever most recently saved the document (Dublin Core's own "responsible for producing the resource's current content"), while `meta:initial-creator` records whoever first created it. LayoutMetadata's `author` field maps to meta:initial-creator, mirroring the ROLE ooxml.js's own DocumentMetadata.author plays for OOXML's dc:creator (the original, byline-style author) -- not to ODF's own dc:creator, which has no equivalent field in LayoutMetadata at all (there is no "last modified by" field, matching how OOXML's cp:lastModifiedBy is likewise never read into DocumentMetadata).
// - meta:keyword appears once PER KEYWORD (`<meta:keyword>alpha</meta:keyword><meta:keyword>beta</meta:keyword>...`), confirmed directly from a LibreOffice HTML->odt conversion of a comma-separated HTML <meta name="keywords"> tag -- LibreOffice itself splits on commas at import time and re-emits one element per keyword. This is a genuinely different convention from OOXML's cp:keywords, which is a SINGLE free-text element that ooxml.js's own reader has to split on commas itself (see ooxml.js's src/typed/shared/metadata.ts readKeywords) -- ODF needs no such splitting, since the format has already done it.
// - `creator` (a field ooxml.js's own DocumentMetadata reuses for the ORIGINATING APPLICATION, e.g. docProps/app.xml's Application element -- "Microsoft Office PowerPoint" -- not a person) maps to meta:generator here, ODF's own direct equivalent (e.g. "LibreOffice/26.2.5.2$MacOSX_AARCH64 LibreOffice_project/..."). Matching that established role, not the human-author role, keeps this field's meaning consistent across every reader in the odf.js/ooxml.js family.
// - LayoutMetadata's `producer` field is left unset here, exactly as ooxml.js's own docx/pptx readers leave it unset: producer is a PDF-only concept (the tool that produced a PDF) with no OOXML or ODF equivalent.
//
// meta.xml is an entirely OPTIONAL ODF part, and every one of office:meta's own children is individually optional too -- a document with no meta.xml at all, or one whose office:meta is empty, is perfectly valid ODF, not a malformed or unusable one. Absence at every level (missing part, missing office:document-meta/office:meta, a missing individual field) is therefore modelled the same way throughout: simply omit that field (or return {}), never throw and never diagnose it as an error.

export const META_PART = "meta.xml";

// Plain, entity-decoded text content of a simple meta.xml element (dc:title, dc:subject, meta:initial-creator, meta:generator, meta:creation-date, dc:date, one meta:keyword, ...). Real ODF meta.xml elements are never mixed content -- no nested elements, and none of paragraph content's text:s/text:tab whitespace-run encoding (see text.ts for that, which is specific to text:p/text:h document content, not meta.xml) -- so a direct child-text-node concatenation is all real-world meta.xml ever needs.
function elementText(element: XmlElement): string {
  let text = "";
  for (const child of element.children) {
    if (child.type === "text") {
      text += decodeXmlText(child.value);
    }
  }
  return text;
}

function firstElementText(
  container: XmlElement,
  tag: string,
): string | undefined {
  const element = childrenWithTag(container, tag)[0];
  if (element === undefined) {
    return undefined;
  }
  const text = elementText(element);
  return text.length > 0 ? text : undefined;
}

export function readOdfMetadata(pkg: Package): LayoutMetadata {
  const part = pkg.parts[META_PART];
  if (part?.kind !== "xml") {
    return {};
  }
  const root = rootElement(part.nodes);
  const meta =
    root === undefined
      ? undefined
      : findChildElement(root.children, "office:meta");
  if (meta === undefined) {
    return {};
  }

  const metadata: LayoutMetadata = {};

  const title = firstElementText(meta, "dc:title");
  if (title !== undefined) {
    metadata.title = title;
  }
  const author = firstElementText(meta, "meta:initial-creator");
  if (author !== undefined) {
    metadata.author = author;
  }
  const subject = firstElementText(meta, "dc:subject");
  if (subject !== undefined) {
    metadata.subject = subject;
  }
  const keywords = childrenWithTag(meta, "meta:keyword")
    .map(elementText)
    .filter((keyword) => keyword.length > 0);
  if (keywords.length > 0) {
    metadata.keywords = keywords;
  }
  const creator = firstElementText(meta, "meta:generator");
  if (creator !== undefined) {
    metadata.creator = creator;
  }
  const createdIso = firstElementText(meta, "meta:creation-date");
  if (createdIso !== undefined) {
    metadata.createdIso = createdIso;
  }
  const modifiedIso = firstElementText(meta, "dc:date");
  if (modifiedIso !== undefined) {
    metadata.modifiedIso = modifiedIso;
  }

  return metadata;
}

// --- the write direction: LayoutMetadata -> the meta.xml part readOdfMetadata reads back ---
//
// Element for element the inverse of the reader above, including both mappings that module's own note calls out as non-obvious: `author` is meta:initial-creator (ODF's original author), never dc:creator (whoever last saved it); `creator` is meta:generator (the originating application). Two LayoutMetadata fields have no ODF spelling and are therefore not written: `producer` is PDF-only, exactly as the reader never sets it, and there is nothing to write it into. `language` IS written, as dc:language -- a real ODF fact worth stating in the document even though readOdfMetadata does not yet read it back, so it does not survive a round trip through this package today.

function metaElement(tag: string, value: string): XmlElement {
  return el(tag, {}, [txt(encodeXmlText(value))]);
}

// Builds the meta.xml node forest for one LayoutMetadata: the XML declaration, the office:document-meta root declaring exactly the three prefixes its own content uses, and an office:meta carrying one element per stated field. A field the metadata does not carry contributes no element at all -- an empty dc:title is not the same fact as an absent one, and the reader treats an empty element as absent anyway.
export function buildOdfMetaNodes(
  metadata: LayoutMetadata,
  version: string,
): XmlNode[] {
  const children: XmlElement[] = [];
  if (metadata.creator !== undefined) {
    children.push(metaElement("meta:generator", metadata.creator));
  }
  if (metadata.title !== undefined) {
    children.push(metaElement("dc:title", metadata.title));
  }
  if (metadata.subject !== undefined) {
    children.push(metaElement("dc:subject", metadata.subject));
  }
  for (const keyword of metadata.keywords ?? []) {
    children.push(metaElement("meta:keyword", keyword));
  }
  if (metadata.author !== undefined) {
    children.push(metaElement("meta:initial-creator", metadata.author));
  }
  if (metadata.createdIso !== undefined) {
    children.push(metaElement("meta:creation-date", metadata.createdIso));
  }
  if (metadata.modifiedIso !== undefined) {
    children.push(metaElement("dc:date", metadata.modifiedIso));
  }
  if (metadata.language !== undefined) {
    children.push(metaElement("dc:language", metadata.language));
  }
  return [
    {
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "UTF-8" },
      ],
    },
    el(
      "office:document-meta",
      {
        ...xmlnsAttributes(["office", "meta", "dc"]),
        "office:version": encodeXmlText(version),
      },
      [el("office:meta", {}, children)],
    ),
  ];
}

// Sets (or replaces) the package's meta.xml part. Pure with respect to every other part, matching manifest.ts's own writeManifest.
export function writeOdfMetadata(
  pkg: Package,
  metadata: LayoutMetadata,
  version: string,
): void {
  pkg.parts[META_PART] = {
    kind: "xml",
    nodes: buildOdfMetaNodes(metadata, version),
  };
}

// --- in-place patching: the live-editor counterpart to writeOdfMetadata's from-scratch rebuild ---
//
// True when the package already carries a real meta.xml XML part -- the precondition patchOdfMetadata requires below, mirroring ooxml.js's own hasCoreProperties exactly (typed/shared/metadata.ts there). A package that has never had any metadata set genuinely lacks this part (meta.xml is entirely optional ODF, per this module's own top comment), and creating one from nothing is writeOdfMetadata's job, not a patch's.
export function hasOdfMetadata(pkg: Package): boolean {
  return pkg.parts[META_PART]?.kind === "xml";
}

export interface OdfMetadataOverrides {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: readonly string[];
}

// The namespace prefixes patchOdfMetadata might newly introduce onto a source document's own office:document-meta root -- every element this module's own patch path can create fresh (dc:title/dc:subject, meta:initial-creator/meta:keyword) uses one of these two, reusing ODF_NAMESPACES' own verified URIs (ns.ts) rather than restating them. meta:generator/meta:creation-date/dc:date are read-only here (patchOdfMetadata never creates them), so office: itself never needs declaring afresh either -- a document with a real meta.xml part always already has it, being office:document-meta's own required namespace.
const META_NAMESPACE_URI_FOR_PREFIX: Readonly<Record<string, string>> = {
  dc: ODF_NAMESPACES.dc,
  meta: ODF_NAMESPACES.meta,
};

// Ensures `root` (office:document-meta) declares the xmlns binding a newly appended element's prefix needs -- the ODF-side mirror of ooxml.js's own ensureNamespaceDeclared. A legally-minimal meta.xml declaring only office:+dc: (a producer that has only ever written dc:title) would otherwise gain an unbound meta:initial-creator/meta:keyword child on its first author/keywords patch -- a fatal XML namespace well-formedness error real consumers (LibreOffice) reject outright.
export function ensureNamespaceDeclared(root: XmlElement, tag: string): void {
  const colonIndex = tag.indexOf(":");
  if (colonIndex === -1) {
    return;
  }
  const prefix = tag.slice(0, colonIndex);
  const uri = META_NAMESPACE_URI_FOR_PREFIX[prefix];
  if (uri === undefined) {
    return;
  }
  const attrName = `xmlns:${prefix}`;
  if (root.attributes.some((a) => a.name === attrName)) {
    return;
  }
  root.attributes.push({ name: attrName, value: uri });
}

// Replaces (or creates) one direct child element's sole text content, in place -- the ODF-side mirror of ooxml.js's own setElementText. `parent` is always office:meta itself in this module's own callers, so a newly created element's namespace is declared on the enclosing office:document-meta root, matching where buildOdfMetaNodes itself declares every prefix.
function setElementText(
  documentMetaRoot: XmlElement,
  parent: XmlElement,
  tag: string,
  value: string,
): void {
  const existing = childrenWithTag(parent, tag)[0];
  const textNode = txt(encodeXmlText(value));
  if (existing !== undefined) {
    existing.children = [textNode];
    return;
  }
  ensureNamespaceDeclared(documentMetaRoot, tag);
  parent.children.push(el(tag, {}, [textNode]));
}

function removeChildrenWithTag(parent: XmlElement, tag: string): void {
  parent.children = parent.children.filter(
    (child) => !(child.type === "element" && child.tag === tag),
  );
}

// Patches meta.xml IN PLACE: for each of title/author/subject/keywords present on `overrides`, this replaces (or creates) the matching element and leaves every other element under office:meta -- meta:generator, meta:creation-date, dc:date, meta:document-statistic, meta:user-defined, and anything else the source producer wrote -- completely untouched. The write-side counterpart to readOdfMetadata above, mirroring ooxml.js's own patchCoreProperties field-for-field: title/subject write even when the override is an empty string (author does too, matching meta:initial-creator's own optionality), while an empty keywords array removes every meta:keyword element rather than leaving a stale one, matching how buildOdfMetaNodes never emits one for an empty list. keywords is one element PER keyword on ODF (readOdfMetadata's own top comment states why, confirmed against real LibreOffice output) -- not the single comma-joined element OOXML's cp:keywords is -- so a keywords override removes every existing meta:keyword element first and then appends one per entry, rather than patching a single element's text. Throws if the package has no meta.xml XML part at all -- see hasOdfMetadata above.
export function patchOdfMetadata(
  pkg: Package,
  overrides: OdfMetadataOverrides,
): void {
  const part = pkg.parts[META_PART];
  if (part?.kind !== "xml") {
    throw new Error(
      `patchOdfMetadata: package has no '${META_PART}' XML part to patch -- check hasOdfMetadata first, or build one from scratch instead (writeOdfMetadata)`,
    );
  }
  const documentMetaRoot = rootElement(part.nodes);
  if (documentMetaRoot === undefined) {
    throw new Error(`patchOdfMetadata: '${META_PART}' has no root element`);
  }
  const meta = findChildElement(documentMetaRoot.children, "office:meta");
  if (meta === undefined) {
    throw new Error(
      `patchOdfMetadata: '${META_PART}' has no office:meta element`,
    );
  }
  if (overrides.title !== undefined) {
    setElementText(documentMetaRoot, meta, "dc:title", overrides.title);
  }
  if (overrides.author !== undefined) {
    setElementText(
      documentMetaRoot,
      meta,
      "meta:initial-creator",
      overrides.author,
    );
  }
  if (overrides.subject !== undefined) {
    setElementText(documentMetaRoot, meta, "dc:subject", overrides.subject);
  }
  if (overrides.keywords !== undefined) {
    removeChildrenWithTag(meta, "meta:keyword");
    for (const keyword of overrides.keywords) {
      ensureNamespaceDeclared(documentMetaRoot, "meta:keyword");
      meta.children.push(metaElement("meta:keyword", keyword));
    }
  }
}
