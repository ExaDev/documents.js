import type { Package } from "../model/package";
import type { XmlElement, XmlNode } from "../model/node";
import { xmlnsAttributes, type OdfNamespacePrefix } from "../ns";
import { writeMimetype } from "../mimetype";
import { el } from "../xml/fragment";
import { encodeXmlText } from "../xml/entities";

// The empty ODF package every typed writer starts from: the mimetype part, and the content.xml/styles.xml roots with their own containers already in place at the schema positions the format requires. Deliberately not part of package-io/write.ts, which is the lossless Package-to-bytes mapping and states outright that it never fabricates a part that was not already there -- this module is the opposite job (fabricating the minimum a new document needs) and keeps that separation intact.
//
// META-INF/manifest.xml is NOT created here: it is derived from the package's own parts, so it can only be built once the writer has finished adding them. A writer calls syncManifest (src/manifest.ts) as its last step instead. meta.xml is likewise the metadata writer's own (src/typed/shared/metadata.ts), and settings.xml is not created at all -- it holds a producer's own view state, which a document assembled from a ContentDocument has none of, and every XML part a reader does not consume quarantines as package-tier residue on the way back in.

// The prefixes a text document's content.xml and styles.xml declare. One list for both parts, matching what real producers do: LibreOffice declares the same broad prefix set on every part of a package rather than a per-part minimum, and an undeclared prefix appearing later (a table inside a document whose root declared no table:) would make the part not well-formed at all.
const ODF_DOCUMENT_PREFIXES: readonly OdfNamespacePrefix[] = [
  "office",
  "style",
  "text",
  "table",
  "draw",
  "fo",
  "xlink",
  "dc",
  "meta",
  "number",
  "svg",
];

// The current OASIS OpenDocument Format standard version, and this module's default for office:version. Matches manifest.ts's own DEFAULT_MANIFEST_VERSION, which is where the same fact reaches META-INF/manifest.xml.
export const DEFAULT_ODF_VERSION = "1.3";

function documentPartNodes(
  rootTag: string,
  version: string,
  containers: readonly XmlElement[],
): XmlNode[] {
  return [
    {
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "UTF-8" },
      ],
    },
    el(
      rootTag,
      {
        ...xmlnsAttributes(ODF_DOCUMENT_PREFIXES),
        "office:version": encodeXmlText(version),
      },
      [...containers],
    ),
  ];
}

// A fresh package for a document of the given media type (ODF_MEDIA_TYPES.odt and its siblings, src/media-type.ts), carrying:
// - "mimetype", whose bytes package-io/write.ts hoists to the first, stored zip entry;
// - content.xml, an office:document-content holding an empty office:automatic-styles (the container StyleRegistry.forPart interns into) and an office:body with the caller's own body element inside it;
// - styles.xml, an office:document-styles holding the empty office:styles, office:automatic-styles, and office:master-styles containers, in the schema's own order.
// The body element is passed in rather than derived from the media type: office:text, office:spreadsheet, office:presentation and office:drawing are the four spellings, and which one belongs to a media type is the calling writer's own fact, not this module's.
export function createOdfPackage(
  mediaType: string,
  bodyElement: XmlElement,
  version: string = DEFAULT_ODF_VERSION,
): Package {
  const pkg: Package = {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: documentPartNodes("office:document-content", version, [
          el("office:automatic-styles"),
          el("office:body", {}, [bodyElement]),
        ]),
      },
      "styles.xml": {
        kind: "xml",
        nodes: documentPartNodes("office:document-styles", version, [
          el("office:styles"),
          el("office:automatic-styles"),
          el("office:master-styles"),
        ]),
      },
    },
  };
  writeMimetype(pkg, mediaType);
  return pkg;
}

// The named container inside one of the two parts createOdfPackage built, by its own tag -- office:styles, office:automatic-styles, office:master-styles, office:body. Throws rather than creating one: every container this writer family needs is created by createOdfPackage itself, so a missing one means the package was not built here at all, which is a programming error rather than a document to repair.
export function odfPartContainer(
  pkg: Package,
  partPath: string,
  containerTag: string,
): XmlElement {
  const part = pkg.parts[partPath];
  if (part?.kind !== "xml") {
    throw new Error(`odfPartContainer: "${partPath}" is not an XML part`);
  }
  const root = part.nodes.find(
    (node): node is XmlElement => node.type === "element",
  );
  const container = root?.children.find(
    (node): node is XmlElement =>
      node.type === "element" && node.tag === containerTag,
  );
  if (container === undefined) {
    throw new Error(
      `odfPartContainer: "${partPath}" has no ${containerTag} container`,
    );
  }
  return container;
}
