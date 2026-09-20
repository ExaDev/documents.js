import { z } from "zod";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { encodeXmlText } from "../../xml/entities";
import { el, txt } from "../../xml/fragment";
import { childrenWithTag, rootElement, textContent } from "../util";
import { findRootRelatedPartPath } from "../opc";

// docProps/core.xml (Dublin Core + extended properties) and docProps/app.xml (the originating application name) use the identical convention across every OOXML format -- docx, pptx, and xlsx alike -- so this reader lives outside any one format's own read.ts rather than being duplicated per format. Ported from documents.js's src/ooxml/core-properties.ts.

export const DocumentMetadataSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  subject: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  creator: z.string().optional(),
  createdIso: z.string().optional(),
  modifiedIso: z.string().optional(),
});
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

// The conventional names for the two metadata parts. OPC names each of them through a relationship the package ROOT declares -- core-properties and extended-properties -- so each is used only as the fallback for a package declaring no usable one, exactly as the main part is resolved (typed/opc.ts, ExaDev/documents.js#1314).
const CONVENTIONAL_CORE_PROPERTIES_PATH = "docProps/core.xml";
const CONVENTIONAL_APP_PROPERTIES_PATH = "docProps/app.xml";
// The core-properties relationship lives in the OPC package namespace, not the officeDocument one every other relationship here uses, which is why only its final segment is matched (as everywhere else in this package) rather than a full URI.
const CORE_PROPERTIES_REL_SUFFIX = "/core-properties";
const APP_PROPERTIES_REL_SUFFIX = "/extended-properties";

// The part holding a package's core properties: whichever part the root core-properties relationship names, or the conventional path when it declares none. Shared by all three functions below so a reader, the hasCoreProperties gate, and the in-place patch can never disagree about which part they mean.
function corePropertiesPartPath(pkg: Package): string {
  return (
    findRootRelatedPartPath(pkg, CORE_PROPERTIES_REL_SUFFIX) ??
    CONVENTIONAL_CORE_PROPERTIES_PATH
  );
}

function appPropertiesPartPath(pkg: Package): string {
  return (
    findRootRelatedPartPath(pkg, APP_PROPERTIES_REL_SUFFIX) ??
    CONVENTIONAL_APP_PROPERTIES_PATH
  );
}

// The namespace URIs the two prefixes patchCoreProperties/setElementText might newly introduce onto a source document actually resolve to -- the identical values documents.js's own addCoreProperties declares when building a core.xml part from scratch. This module never creates a dcterms:-prefixed element (dcterms:created/modified are read-only here), so dcterms/xsi are deliberately not in this table.
const CORE_PROPERTIES_NAMESPACE_URI_FOR_PREFIX: Readonly<
  Record<string, string>
> = {
  cp: "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
  dc: "http://purl.org/dc/elements/1.1/",
};

function firstElementText(
  root: XmlElement | undefined,
  tag: string,
): string | undefined {
  if (root === undefined) {
    return undefined;
  }
  const element = childrenWithTag(root, tag)[0];
  if (element === undefined) {
    return undefined;
  }
  const text = textContent(element);
  return text.length > 0 ? text : undefined;
}

// cp:keywords is a single free-text element with no delimiter mandated by ECMA-376; comma-separation is the overwhelmingly common convention among real-world producers, so that's what this splits on.
function readKeywords(core: XmlElement | undefined): string[] | undefined {
  const raw = firstElementText(core, "cp:keywords");
  if (raw === undefined) {
    return undefined;
  }
  const parts = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

// Reads a package's docProps into a DocumentMetadata. `author` is the human author (dc:creator); `creator` is the originating application (docProps/app.xml's Application element, e.g. "Microsoft Office PowerPoint") -- NOT the same OOXML field despite the name overlap with dc:creator. There is no `producer` field: that is a PDF-specific concept (the tool that produced a PDF) with no OOXML equivalent.
export function readCoreProperties(pkg: Package): DocumentMetadata {
  const core = rootElement(pkg.parts[corePropertiesPartPath(pkg)]);
  const app = rootElement(pkg.parts[appPropertiesPartPath(pkg)]);
  return {
    title: firstElementText(core, "dc:title"),
    author: firstElementText(core, "dc:creator"),
    subject: firstElementText(core, "dc:subject"),
    keywords: readKeywords(core),
    creator: firstElementText(app, "Application"),
    createdIso: firstElementText(core, "dcterms:created"),
    modifiedIso: firstElementText(core, "dcterms:modified"),
  };
}

// True when the package already carries a real docProps/core.xml XML part -- the precondition patchCoreProperties requires below. A package that has never had any metadata set genuinely lacks this part (documents.js's createDocx() with no options.metadata, for one), and creating one from nothing needs more than a text-node patch -- a content-type override and a package-root relationship, which is a distinct concern from patching an existing part's text -- so a caller reaching for patchCoreProperties should check this first and fall back to building a fresh part (e.g. documents.js's own addCoreProperties) when it answers false.
export function hasCoreProperties(pkg: Package): boolean {
  return pkg.parts[corePropertiesPartPath(pkg)]?.kind === "xml";
}

export interface CorePropertiesOverrides {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: readonly string[];
}

// The namespace prefix a tag is qualified with ("dc:title" -> "dc"). No "no colon" branch: this is only ever called, via ensureNamespaceDeclared below, with one of "dc:title" / "dc:creator" / "dc:subject" / "cp:keywords" -- every one of them colon-qualified -- so colonIndex is always >= 0 in practice and a branch handling its absence would be unreachable.
function namespacePrefixOf(tag: string): string {
  return tag.slice(0, tag.indexOf(":"));
}

// Ensures `root` declares the xmlns binding a newly appended element's prefix needs. A legally-minimal docProps/core.xml declaring only the cp namespace (every core-properties child is optional, so a real producer writing only cp:keywords has no reason to ever declare dc) would otherwise gain an unbound dc:title/dc:creator/dc:subject child -- a fatal XML namespace well-formedness error real consumers (Word, LibreOffice) reject outright. Only called from the "create a new element" branch below: an EXISTING element's prefix was already legally bound by whatever produced the source document, so patching its text alone never needs this. Idempotent -- patching two dc-prefixed fields that both need creating (title and author, say) declares xmlns:dc once, not twice.
function ensureNamespaceDeclared(root: XmlElement, tag: string): void {
  const prefix = namespacePrefixOf(tag);
  const uri = CORE_PROPERTIES_NAMESPACE_URI_FOR_PREFIX[prefix];
  if (uri === undefined) {
    return;
  }
  const attrName = `xmlns:${prefix}`;
  if (root.attributes.some((a) => a.name === attrName)) {
    return;
  }
  root.attributes.push({ name: attrName, value: uri });
}

// Replaces (or creates) one direct child element's sole text content, in place -- the live-view mutation primitive patchCoreProperties below is built from. Every other child of `parent`, and every attribute already on the matched element, is left exactly as it was. `parent` is always the coreProperties root itself in this module's own callers, so a newly created element's namespace is declared directly on it -- see ensureNamespaceDeclared above.
function setElementText(parent: XmlElement, tag: string, value: string): void {
  const existing = childrenWithTag(parent, tag)[0];
  const textNode = txt(encodeXmlText(value));
  if (existing !== undefined) {
    existing.children = [textNode];
    return;
  }
  ensureNamespaceDeclared(parent, tag);
  parent.children.push(el(tag, {}, [textNode]));
}

// Removes every direct child element with the given tag, in place.
function removeChildrenWithTag(parent: XmlElement, tag: string): void {
  parent.children = parent.children.filter(
    (child) => !(child.type === "element" && child.tag === tag),
  );
}

// Patches docProps/core.xml IN PLACE: for each of title/author/subject/keywords present on `overrides`, this replaces (or creates) the matching element's text content and leaves every other element on the part -- dcterms:created, dcterms:modified, cp:lastModifiedBy, cp:revision, and anything else the source producer wrote -- completely untouched. This is the write-side counterpart to readCoreProperties above, but a patch rather than a from-scratch rebuild: the one caller that needs it (documents.js's docx-only setDocumentMetadata fast path, ExaDev/documents.js#966) needs everything else in the package -- comments, footnotes, header/footer parts, section header/footer references, numbering -- to survive byte-faithful, which a ContentDocument round trip through buildDocxPackageFromContent cannot do. Mirrors buildCorePropertiesPart's own field-by-field semantics (typed/docx/write.ts): title/author/subject write even when the override is an empty string, while an empty keywords array removes the element entirely rather than writing an empty one, matching how a from-scratch build never emits cp:keywords for an empty list. Throws if the package has no docProps/core.xml XML part at all -- see hasCoreProperties above.
export function patchCoreProperties(
  pkg: Package,
  overrides: CorePropertiesOverrides,
): void {
  const corePath = corePropertiesPartPath(pkg);
  const part = pkg.parts[corePath];
  if (part?.kind !== "xml") {
    throw new Error(
      `patchCoreProperties: package has no '${corePath}' XML part to patch -- check hasCoreProperties first, or build one from scratch instead`,
    );
  }
  const core = rootElement(part);
  if (core === undefined) {
    throw new Error(`patchCoreProperties: '${corePath}' has no root element`);
  }
  if (overrides.title !== undefined) {
    setElementText(core, "dc:title", overrides.title);
  }
  if (overrides.author !== undefined) {
    setElementText(core, "dc:creator", overrides.author);
  }
  if (overrides.subject !== undefined) {
    setElementText(core, "dc:subject", overrides.subject);
  }
  if (overrides.keywords !== undefined) {
    if (overrides.keywords.length > 0) {
      setElementText(core, "cp:keywords", overrides.keywords.join(", "));
    } else {
      removeChildrenWithTag(core, "cp:keywords");
    }
  }
}
