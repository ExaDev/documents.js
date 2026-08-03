import type { ContentEmbeddedObjectKind } from 'document-schema.js';
import type { XmlElement } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, findChildElement, rootElement } from '../../xml/query';
import { subDocumentPackage } from '../odb/subdocument';

// A draw:frame's own EMBEDDED OBJECT reference (draw:object) resolved into the sub-Package it points at, plus the ContentEmbeddedObjectKind that sub-document actually is -- the draw: counterpart to shapes.ts's readDrawImageBlock (draw:image), kept in its own module because the two answer genuinely different questions: an image resolves to a binary part this package decodes itself, while an object resolves to a whole nested ODF DOCUMENT only a typed reader (readOdt/readOds/readOdp/readOdg) can turn into content.
//
// WHY THIS MODULE DELIBERATELY DOES NOT CALL THOSE READERS ITSELF: it would have to import readOds, which imports this module -- a genuine import cycle, and one that would grow a new edge every time another format learns to read embedded objects. Resolving the reference (which sub-package, which kind) needs no reader at all, so the split falls exactly where the dependency does: this module answers "what is embedded and where are its parts", and the calling format reader dispatches its own kind -> readX call from that.
//
// CONFIRMED against real, unmodified LibreOffice 26.2 output (src/typed/ods/fixtures/sheet-anchors.ods -- a real Calc sheet built through the same UNO calls the Calc UI itself uses, with a LibreOffice Draw document inserted as an OLE object anchored to a cell, then saved and unzipped directly):
// - The reference is `<draw:object xlink:href="./Object 1" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`, a direct child of draw:frame -- a package-relative DIRECTORY path with a "./" prefix and NO trailing "/content.xml", so the href is exactly the prefix subDocumentPackage (typed/odb/subdocument.ts) already re-keys a sub-document's parts against, once that "./" is stripped.
// - The sub-document is a complete, ordinary ODF document: "Object 1/content.xml", "Object 1/styles.xml", "Object 1/settings.xml", with the outer package's own META-INF/manifest.xml declaring "Object 1/" as manifest:media-type="application/vnd.oasis.opendocument.graphics".
// - The SAME draw:frame ALSO carries a sibling `<draw:image xlink:href="./ObjectReplacements/Object 1"/>` -- a GDI-metafile preview LibreOffice writes for consumers that cannot render the real object. A caller must therefore check for draw:object BEFORE falling back to a frame's draw:image, exactly as readDrawFrameContent already checks table:table before draw:image for the identical "a real table frame also ships a preview image" reason.
//
// KIND is resolved from the sub-document's OWN content.xml (its office:body's single content child: office:text/office:spreadsheet/office:presentation/office:drawing), NOT from the manifest's declared media type for the directory, even though the manifest genuinely declares one. One signal, not two: the caller must pick a typed reader anyway, and deriving both the reported kind and the reader that produced the content from the same element makes them consistent by construction -- where a manifest entry can be absent (a sub-package that ships no manifest of its own is still perfectly readable) or disagree with what content.xml actually holds, in which case the manifest would be describing a document nobody read.
//
// SCOPE: a formula sub-document (a real, common embedded object -- LibreOffice Math) is deliberately NOT resolvable here, and neither is a chart. Both are genuine ODF embedded-object kinds, but neither can be REPRESENTED: document-schema.js's ContentEmbeddedObject.document is a required ContentDocument, whose discriminated union has only wordprocessing/presentation/spreadsheet/drawing variants -- there is no MathML-shaped or chart-shaped member to carry either in (ContentEmbeddedObjectKind does list 'formula', but nothing can be put in its `document` field). Both consequently resolve to undefined here rather than to a fabricated empty document of some other kind. A LINKED (as opposed to embedded) object -- xlink:href pointing outside the package, at a separate file or a URL -- likewise resolves to undefined: its content genuinely is not in this package to read.

// Every ContentEmbeddedObjectKind whose content ContentDocument can actually carry -- derived from the schema's own union via Extract rather than restated, so a rename or removal upstream fails to compile here instead of silently drifting. 'formula' is the one member deliberately absent; see this module's own SCOPE note.
export type EmbeddedDocumentKind = Extract<ContentEmbeddedObjectKind, 'wordprocessing' | 'presentation' | 'spreadsheet' | 'drawing'>;

export interface EmbeddedDrawObject {
  // What the sub-document actually is, resolved from its own office:body content child.
  objectKind: EmbeddedDocumentKind;
  // The sub-document's own parts, re-keyed relative to its directory -- a genuine Package every typed reader in this package accepts unmodified.
  package: Package;
  // The sub-document's own directory path inside the OUTER package, normalised (no "./" prefix, no trailing slash) -- e.g. "Object 1".
  href: string;
}

const CONTENT_PART = 'content.xml';

// office:body's single content child identifies the document kind, exactly as it does for a top-level package (readOdt looks for office:text, readOds for office:spreadsheet, and so on) -- a switch rather than a lookup table so each mapping narrows to its own literal type with no assertion.
function embeddedKindFor(bodyChildTag: string): EmbeddedDocumentKind | undefined {
  switch (bodyChildTag) {
    case 'office:text':
      return 'wordprocessing';
    case 'office:spreadsheet':
      return 'spreadsheet';
    case 'office:presentation':
      return 'presentation';
    case 'office:drawing':
      return 'drawing';
    default:
      // office:database is a .odb front-end (readOdbInventory's job, not a ContentDocument at all); a bare <math> root has no office:body to reach this function in the first place. Both, and anything else, are unrepresentable -- see this module's own SCOPE note.
      return undefined;
  }
}

// The normalised directory prefix a draw:object's own xlink:href names, or undefined when the href is absent, empty, or points outside the package (a LINKED object: an absolute URL, or a path escaping the package root).
function normaliseObjectHref(raw: string): string | undefined {
  const withoutPrefix = raw.startsWith('./') ? raw.slice(2) : raw;
  const trimmed = withoutPrefix.endsWith('/') ? withoutPrefix.slice(0, -1) : withoutPrefix;
  if (trimmed.length === 0 || trimmed.startsWith('..') || trimmed.startsWith('/') || trimmed.includes('://')) {
    return undefined;
  }
  return trimmed;
}

// Resolves a draw:frame's own draw:object child into the embedded sub-document it references. Returns undefined for a frame with no draw:object at all, for a linked (not embedded) reference, for a sub-document directory holding no content.xml, and for an embedded document of a kind ContentDocument cannot represent -- see this module's own SCOPE note for why each of those is a real, bounded case rather than a failure worth throwing over.
export function readDrawObjectReference(frame: XmlElement, pkg: Package): EmbeddedDrawObject | undefined {
  const object = childrenWithTag(frame, 'draw:object')[0];
  if (object === undefined) {
    return undefined;
  }
  const rawHref = attrValue(object, 'xlink:href');
  const href = rawHref === undefined ? undefined : normaliseObjectHref(rawHref);
  if (href === undefined) {
    return undefined;
  }

  const subPackage = subDocumentPackage(pkg, href, { allowMissingContent: true });
  const contentPart = subPackage.parts[CONTENT_PART];
  if (contentPart?.kind !== 'xml') {
    return undefined;
  }
  const root = rootElement(contentPart.nodes);
  const body = root === undefined ? undefined : findChildElement(root.children, 'office:body');
  // office:body's own first element child IS the content element -- rootElement is tag-agnostic "first element in this forest", which is exactly that question asked one level down, so it is reused here rather than growing a second first-element-child helper.
  const bodyChild = body === undefined ? undefined : rootElement(body.children);
  const objectKind = bodyChild === undefined ? undefined : embeddedKindFor(bodyChild.tag);
  if (objectKind === undefined) {
    return undefined;
  }
  return { objectKind, package: subPackage, href };
}
