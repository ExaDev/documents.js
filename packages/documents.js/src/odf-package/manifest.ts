import type { Package } from "odf.js";
import {
  findChildElement,
  ODF_MEDIA_TYPES,
  rootElement,
  syncManifest as syncOdfJsManifest,
} from "odf.js";

// odf.js already owns META-INF/manifest.xml end to end -- reading, deriving, writing, syncing, and validating it -- unlike ooxml.js, which only ever reads OPC relationships and leaves writing new ones to this package's own src/opc/rels.ts. See odf.js's own src/manifest.ts for why: ODF's manifest is the one part every package unconditionally requires, and getting it right (every part listed, every media type correct, the root entry's type tied to the "mimetype" part) is exhaustive enough that odf.js provides first-class read AND write support directly.
//
// The one piece of real logic below, syncOdfManifest, exists because odf.js's own buildManifest deliberately does not guess a SUB-DOCUMENT's media type: it synthesises a manifest:file-entry for every "<dir>/content.xml" prefix it finds (subdocumentDirectories, src/manifest.ts) but resolves that directory entry's own media type by file extension, and a directory has none -- so it comes out empty unless a caller supplies a mediaTypeOverrides entry for it.

const CONTENT_PART_SUFFIX = "/content.xml";
const ROOT_CONTENT_PART = "content.xml";

// An ODF document's own kind is stated by the single element inside office:body -- the same discriminant odf.js's own readOdtContent/readOdsContent/readOdpContent/readOdgContent/readOdfFormulaContent each look for, and the only thing distinguishing one sub-document from another once the mimetype part (which a sub-document does not have -- only the outer package does) is out of the picture.
const MEDIA_TYPE_BY_BODY_ELEMENT: ReadonlyMap<string, string> = new Map([
  ["office:text", ODF_MEDIA_TYPES.odt],
  ["office:spreadsheet", ODF_MEDIA_TYPES.ods],
  ["office:presentation", ODF_MEDIA_TYPES.odp],
  ["office:drawing", ODF_MEDIA_TYPES.odg],
  ["office:math", ODF_MEDIA_TYPES.odf],
]);

function subDocumentMediaType(
  pkg: Package,
  directory: string,
): string | undefined {
  const part = pkg.parts[`${directory}${ROOT_CONTENT_PART}`];
  const root = part?.kind === "xml" ? rootElement(part.nodes) : undefined;
  const body =
    root === undefined
      ? undefined
      : findChildElement(root.children, "office:body");
  if (body === undefined) {
    return undefined;
  }
  for (const child of body.children) {
    if (child.type === "element") {
      return MEDIA_TYPE_BY_BODY_ELEMENT.get(child.tag);
    }
  }
  return undefined;
}

// Re-derives META-INF/manifest.xml from the package's current parts, resolving each embedded sub-document directory's own media type from what that sub-document actually IS rather than leaving it empty. Every part-mutating helper in this package syncs through here rather than through odf.js's own syncManifest directly, so inserting an image into a document that already embeds a formula does not silently blank the formula object's own entry on the way past -- the media types are recomputed from the package every time, never carried in a caller-held override map that one call site happens to know about and another does not.
export function syncOdfManifest(pkg: Package): void {
  const mediaTypeOverrides: Record<string, string> = {};
  for (const path of Object.keys(pkg.parts)) {
    if (!path.endsWith(CONTENT_PART_SUFFIX) || path === ROOT_CONTENT_PART) {
      continue;
    }
    const directory = path.slice(0, path.length - ROOT_CONTENT_PART.length);
    const mediaType = subDocumentMediaType(pkg, directory);
    if (mediaType !== undefined) {
      mediaTypeOverrides[directory] = mediaType;
    }
  }
  syncOdfJsManifest(pkg, { mediaTypeOverrides });
}
