import { readOlePackage, writeOlePackage } from "archive-codec";
import {
  ContentEmbeddedObjectSchema,
  type ContentEmbeddedObject,
} from "document-schema.js";

// What rides inside an embedded OLE object's Embedding Storage (workbook/drawing-writer.ts's MBD storages, [MS-XLS] 2.1.7 "Embedding Storage"): the same [MS-OLEDS] OLE Package stream rtf-codec's own embedded objects use (archive-codec's writeOlePackage/readOlePackage pair), wrapping this package's own JSON serialisation of the ContentEmbeddedObject the document carries.
//
// That JSON payload is the same honest boundary rtf-codec's own embedded-object module draws: xls-codec cannot depend on ooxml.js/odf.js -- format codecs are peers in this family, never one another's dependency -- so a 'wordprocessing'/'presentation'/'spreadsheet'/'drawing'/'formula' embedded object's own ContentDocument cannot be re-serialised into a real docx/pptx/xlsx/odf/MathML byte stream here the way a genuine OLE server would. What this codec CAN write and read back losslessly is its own ContentDocument (a plain, Zod-validated, JSON-serialisable value), so that JSON is the "file" the Package stream wraps -- the identical slot a real embed's actual bytes would occupy. A real Excel-authored embedding storage carries CompObj and Ole streams beside the native one and packages real OLE server data; decodeEmbeddedObjectPackage returns undefined for any payload that is not this package's own, degrading the way rtf-codec's own reader does for a foreign \objdata, rather than guessing at a foreign object's content.

// A fixed, ASCII-only label: archive-codec's writeOlePackage refuses a label/path outside ASCII (it carries no arbitrary-codepage encoder -- see its own doc comment), and nothing downstream branches on this string's content, so every embedding this writer produces just names what it is. The identical label rtf-codec's own embedded objects use, so a Package stream produced by either codec is recognisable as this family's own.
const PACKAGE_LABEL = "xls-codec-embedded-object.json";

// The fields of ContentEmbeddedObject that are placement rather than payload -- frame and the anchor quartet. They are deliberately NOT round-tripped through the JSON: the Escher anchor (OfficeArtClientAnchorSheet) is the one authority the format itself carries for where an object sits, both directions of this codec derive every placement field from it (drawing-writer.ts's anchorAt on the way out, drawing.ts's resolveAnchorPlacement on the way back), and letting a second, redundant copy inside the payload disagree with it would be a bug that only a mismatch could ever reveal.
function payloadOf(
  embedded: ContentEmbeddedObject,
): Pick<ContentEmbeddedObject, "objectKind" | "document" | "source"> {
  return {
    objectKind: embedded.objectKind,
    document: embedded.document,
    source: embedded.source,
  };
}

/** The Package stream bytes for one embedded object: this package's own JSON serialisation of the object's kind, document, and residue, wrapped in the [MS-OLEDS] packaging. */
export function writeEmbeddedObjectPackage(
  embedded: ContentEmbeddedObject,
): Uint8Array<ArrayBuffer> {
  const fileBytes = new TextEncoder().encode(
    JSON.stringify(payloadOf(embedded)),
  );
  return writeOlePackage({
    label: PACKAGE_LABEL,
    sourcePath: "",
    tempPath: "",
    fileBytes,
  });
}

/** The inverse of writeEmbeddedObjectPackage: recovers a ContentEmbeddedObject's kind, document, and residue when the Package stream bytes are this package's own payload, or undefined for anything else -- a real OLE object's packaged bytes included -- rather than throwing, since one unreadable embedding must not fail the whole sheet's drawing read. `frame` is the placement the caller derived from the embedding's own Escher anchor: the payload deliberately carries no placement of its own (see payloadOf above), and the full ContentEmbeddedObjectSchema validation needs a frame to accept, so the anchor-derived one is merged in before the parse -- the anchor stays the single authority for where the object sits. */
export function readEmbeddedObjectPackage(
  packageBytes: Uint8Array<ArrayBuffer>,
  frame: ContentEmbeddedObject["frame"],
): ContentEmbeddedObject | undefined {
  try {
    const olePackage = readOlePackage(packageBytes);
    if (olePackage.label !== PACKAGE_LABEL) {
      return undefined;
    }
    const text = new TextDecoder("utf-8").decode(olePackage.fileBytes);
    const parsed: unknown = JSON.parse(text);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      !("objectKind" in parsed) ||
      !("document" in parsed)
    ) {
      return undefined;
    }
    const result = ContentEmbeddedObjectSchema.safeParse({
      ...parsed,
      frame,
    });
    if (!result.success) {
      return undefined;
    }
    return result.data;
  } catch {
    return undefined;
  }
}
