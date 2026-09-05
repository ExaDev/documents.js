import { z } from "zod";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { encodeXmlText } from "../../xml/entities";
import { el, txt } from "../../xml/fragment";
import { childrenWithTag, rootElement, textContent } from "../util";

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

const CORE_PROPERTIES_PATH = "docProps/core.xml";
const APP_PROPERTIES_PATH = "docProps/app.xml";

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
  const core = rootElement(pkg.parts[CORE_PROPERTIES_PATH]);
  const app = rootElement(pkg.parts[APP_PROPERTIES_PATH]);
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
  return pkg.parts[CORE_PROPERTIES_PATH]?.kind === "xml";
}

export interface CorePropertiesOverrides {
  readonly title?: string;
  readonly author?: string;
  readonly subject?: string;
  readonly keywords?: readonly string[];
}

// Replaces (or creates) one direct child element's sole text content, in place -- the live-view mutation primitive patchCoreProperties below is built from. Every other child of `parent`, and every attribute already on the matched element, is left exactly as it was.
function setElementText(parent: XmlElement, tag: string, value: string): void {
  const existing = childrenWithTag(parent, tag)[0];
  const textNode = txt(encodeXmlText(value));
  if (existing !== undefined) {
    existing.children = [textNode];
    return;
  }
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
  const part = pkg.parts[CORE_PROPERTIES_PATH];
  if (part?.kind !== "xml") {
    throw new Error(
      `patchCoreProperties: package has no '${CORE_PROPERTIES_PATH}' XML part to patch -- check hasCoreProperties first, or build one from scratch instead`,
    );
  }
  const core = rootElement(part);
  if (core === undefined) {
    throw new Error(
      `patchCoreProperties: '${CORE_PROPERTIES_PATH}' has no root element`,
    );
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
