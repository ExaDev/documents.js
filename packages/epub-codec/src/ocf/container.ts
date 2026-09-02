import { EpubInvalidContainerError } from "../diagnostics";
import {
  attrValue,
  childrenWithTag,
  findChildElement,
  rootElement,
} from "../xml/query";
import { parseXml } from "../xml/parse";

// META-INF/container.xml, EPUB 3.3 section 6.7.2 (unchanged from OCF 1.0/EPUB 2's own OEBPS Container Format): the fixed entry point every OCF reader starts from, naming which package document (OPF rootfile) to read next. A container may declare more than one <rootfile> for different rendering profiles; this package reads the first whose media-type is the OPF one ("application/oebps-package+xml"), matching every real-world EPUB (a second rootfile for a non-EPUB rendition is vanishingly rare and out of this package's flowable-only scope).
const OPF_MEDIA_TYPE = "application/oebps-package+xml";

// Resolves the OPF rootfile path from a parsed container.xml. Throws EpubInvalidContainerError rather than degrading: with no rootfile there is no manifest or spine to read anything from, so there is nothing a diagnostic-and-continue policy could usefully report.
export function resolveOpfPath(containerXml: string): string {
  const nodes = parseXml(containerXml);
  const root = rootElement(nodes);
  if (root?.tag !== "container") {
    throw new EpubInvalidContainerError(
      "META-INF/container.xml has no <container> root element",
    );
  }
  const rootfiles = findChildElement(root.children, "rootfiles");
  if (rootfiles === undefined) {
    throw new EpubInvalidContainerError(
      "META-INF/container.xml has no <rootfiles> element",
    );
  }
  const entries = childrenWithTag(rootfiles, "rootfile");
  const opfEntry =
    entries.find(
      (entry) => attrValue(entry, "media-type") === OPF_MEDIA_TYPE,
    ) ?? entries[0];
  const fullPath =
    opfEntry === undefined ? undefined : attrValue(opfEntry, "full-path");
  if (fullPath === undefined) {
    throw new EpubInvalidContainerError(
      "META-INF/container.xml names no rootfile with a full-path attribute",
    );
  }
  return fullPath;
}
