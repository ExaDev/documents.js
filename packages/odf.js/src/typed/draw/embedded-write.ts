import type { ContentEmbeddedObject } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";
import { syncManifest } from "../../manifest";
import { writeOdfFormulaContent } from "../formula/write";
import { writeOdgContent } from "../odg/write";
import { writeOdpContent } from "../odp/write";
import { writeOdsContent } from "../ods/write";
import { writeOdtContent } from "../odt/write";

// The write-side inverse of typed/draw/embedded.ts's own kind -> reader dispatch: one embedded sub-document -> the parts and references that serialise it back into an embedding package. The cycle discipline is the identical one the reader module states (call-time-only cross-use between the sibling format writers, hoisted function declarations on both sides, nothing read at module-evaluation time) -- writeOdt imports this module's helpers through its own frame writer while this module imports writeOdt, exactly mirroring readOdtContent <-> readEmbeddedObjectDocument.
//
// WHAT A REAL EMBEDDING CONSISTS OF (the shape the reader resolves back): an "Object N/" directory holding the sub-document's own genuine package -- content.xml, its own META-INF/manifest.xml, styles.xml, meta.xml, everything the sub-writer emits -- referenced from a draw:object element's xlink:href inside the embedding frame, plus an entry in the OUTER package's manifest for the directory itself (syncManifest derives directory entries from part paths, so simply keying the sub-parts under "Object N/<path>" is what wires that entry). The ObjectReplacements/ preview image a real producer ships beside the object is deliberately NOT written: this package has no GDI/WMF preview writer, the reader treats the preview as optional, and Word/LibreOffice render the object from its own content on activation.

// One sub-document -> the package its own kind's writer produces. The chart kind is refused by name rather than guessed at: a chart sub-document's write side is the chart-part serialiser xlsx/pptx reading already quarantines as residue (ExaDev/documents.js#719's own "chart is not a document kind" decision), and fabricating one here would invent a writer the family deliberately decided not to have.
export function writeEmbeddedObjectPackage(
  object: ContentEmbeddedObject,
): Package {
  switch (object.objectKind) {
    case "wordprocessing":
      return writeOdtContent(object.document);
    case "presentation":
      return writeOdpContent(object.document);
    case "spreadsheet":
      return writeOdsContent(object.document);
    case "drawing":
      return writeOdgContent(object.document);
    case "formula":
      return writeOdfFormulaContent(object.document);
    case "chart":
      throw new Error(
        "writeEmbeddedObjectPackage: an embedded chart has no write-side serialiser -- a chart's own part is quarantined residue by the family's own #719 decision, and this writer refuses to fabricate one",
      );
  }
}

// Keys every part of the sub-package under its embedding directory and adds the parts to the outer package: "Object 1/" + "content.xml" -> "Object 1/content.xml". The sub-package's own manifest travels with it verbatim (an embedded package's manifest lists ITS parts relative to ITS root -- exactly what the reader expects to find when it re-keys them back), and syncManifest on the outer package derives the directory entry from the part paths, so no separate manifest bookkeeping happens here.
export function embedObjectParts(
  pkg: Package,
  subPackage: Package,
  directory: string,
): void {
  for (const [path, part] of Object.entries(subPackage.parts)) {
    pkg.parts[`${directory}/${path}`] = part;
  }
}

// The draw:object element an embedding frame references the sub-document through -- xlink:href naming the directory, the identical "./Object N" spelling real producers write and normaliseObjectHref strips on the way back in.
export function writeDrawObjectElement(directory: string): XmlElement {
  return el("draw:object", {
    "xlink:type": "simple",
    "xlink:href": encodeXmlText(`./${directory}`),
  });
}

// Writes one embedded object into an embedding package and returns the draw:object element its frame carries. The directory name is the caller's (each embedding writer numbers its own objects document-wide), and the outer package's manifest is re-synced here so the new directory entry exists by the time the caller finishes.
export function writeEmbeddedObject(
  object: ContentEmbeddedObject,
  directory: string,
  pkg: Package,
): XmlElement {
  const subPackage = writeEmbeddedObjectPackage(object);
  embedObjectParts(pkg, subPackage, directory);
  syncManifest(pkg);
  return writeDrawObjectElement(directory);
}
