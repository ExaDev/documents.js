import { EpubInvalidOpfError } from "../diagnostics";
import type { XmlElement } from "../xml/node";
import {
  attrValue,
  childrenWithTag,
  findChildElement,
  rootElement,
} from "../xml/query";
import { parseXml } from "../xml/parse";
import { readOpfMetadata } from "./metadata";
import type { OpfManifestItem, OpfPackage, OpfSpineItemRef } from "./types";

// The OPF package document, EPUB 3.3 section 5.4 (structurally unchanged from OPF 2.0 for the <metadata>/<manifest>/<spine> triple this package reads): the manifest lists every part the package carries, the spine states the linear reading order over a subset of it by idref. Both directions of this codec go through this one parse -- src/read.ts resolves manifest hrefs and walks the spine in order; src/write.ts's own OPF emission (src/opf/write.ts) is this module's structural inverse.
export function parseOpf(opfXml: string): OpfPackage {
  const nodes = parseXml(opfXml);
  const root = rootElement(nodes);
  if (root?.tag !== "package") {
    throw new EpubInvalidOpfError(
      "the OPF document has no <package> root element",
    );
  }

  const metadataElement = findChildElement(root.children, "metadata");
  const metadata =
    metadataElement === undefined ? {} : readOpfMetadata(metadataElement);

  const manifestElement = findChildElement(root.children, "manifest");
  if (manifestElement === undefined) {
    throw new EpubInvalidOpfError("the OPF document has no <manifest> element");
  }
  const manifest = childrenWithTag(manifestElement, "item")
    .map(parseManifestItem)
    .filter((item): item is OpfManifestItem => item !== undefined);

  const spineElement = findChildElement(root.children, "spine");
  if (spineElement === undefined) {
    throw new EpubInvalidOpfError("the OPF document has no <spine> element");
  }
  const spine = childrenWithTag(spineElement, "itemref")
    .map(parseSpineItemRef)
    .filter((item): item is OpfSpineItemRef => item !== undefined);

  return {
    metadata,
    manifest,
    spine,
    ncxId: attrValue(spineElement, "toc"),
  };
}

function parseManifestItem(element: XmlElement): OpfManifestItem | undefined {
  const id = attrValue(element, "id");
  const href = attrValue(element, "href");
  const mediaType = attrValue(element, "media-type");
  if (id === undefined || href === undefined || mediaType === undefined) {
    return undefined;
  }
  const properties = attrValue(element, "properties");
  return {
    id,
    href,
    mediaType,
    properties:
      properties === undefined
        ? []
        : properties.split(/\s+/u).filter((p) => p.length > 0),
  };
}

function parseSpineItemRef(element: XmlElement): OpfSpineItemRef | undefined {
  const idref = attrValue(element, "idref");
  if (idref === undefined) {
    return undefined;
  }
  return { idref, linear: attrValue(element, "linear") !== "no" };
}
