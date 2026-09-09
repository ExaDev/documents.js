import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { ODF_MEDIA_TYPES } from "../../media-type";
import { syncManifest } from "../../manifest";
import { el } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import {
  createOdfPackage,
  DEFAULT_ODF_VERSION,
} from "../../package-io/scaffold";
import type { OdmDocument, OdmSection } from "./read";

// OdmDocument -> a real .odm Package: the write-side inverse of readOdm, and the sixth content writer in this package's typed layer. A master document's own content model is exactly what its reader recovers -- one top-level text:section per chapter, each carrying a text:name and a SELF-CLOSING text:section-source child holding the chapter's external-file reference -- so the writer emits precisely that shape, mirroring the reader's own empirically-confirmed notes verbatim: the real LibreOffice output it transcribes writes text:section-source with xlink:href and (when present) text:filter-name and NOTHING else (no xlink:show, no xlink:type -- genuine output does not carry them, and inventing attributes a real producer never writes is how a writer and a reader drift apart).
//
// Chapter content itself is deliberately not written, exactly as the reader deliberately does not read it: a real master document never caches its linked chapters' text inside its own text:section (read.ts's own top-of-file point 2 proves this two ways, from content.xml and from the manifest), so a writer fabricating cached content would produce a file shape no real producer emits and this package's own reader would misreport. hrefs are written completely verbatim, the same way the reader returns them -- this writer never resolves them or touches the files they name.
//
// The scaffold fits an .odm directly (unlike an .odf): a master document IS a regular office:document-content document whose body element is office:text, so createOdfPackage's own wrapper is exactly right and this writer adds only the section elements.
export interface OdmWriteOptions {
  // The ODF version stamped on content.xml and on the manifest. Defaults to the current standard, matching every other writer's own option.
  readonly version?: string;
}

function writeSection(section: OdmSection): XmlElement {
  const sourceAttributes: Record<string, string> = {
    "xlink:href": encodeXmlText(section.href),
  };
  if (section.filterName !== undefined) {
    sourceAttributes["text:filter-name"] = encodeXmlText(section.filterName);
  }
  return el("text:section", { "text:name": encodeXmlText(section.name) }, [
    el("text:section-source", sourceAttributes),
  ]);
}

export function writeOdm(
  document: OdmDocument,
  options: OdmWriteOptions = {},
): Package {
  const version = options.version ?? DEFAULT_ODF_VERSION;
  const officeText = el("office:text", {}, document.sections.map(writeSection));
  const pkg = createOdfPackage(ODF_MEDIA_TYPES.odm, officeText, version);
  syncManifest(pkg, { version });
  return pkg;
}
