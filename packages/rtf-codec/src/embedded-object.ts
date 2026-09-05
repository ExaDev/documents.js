// An RTF \object's \objdata is, per the specification's own words, "the structure produced by the OLESaveToStream function" -- a real OLE compound file (RTF 1.9.1, "Objects": <objdata> = '{\*' \objdata (<objalias>? & <objsect>?) <data> '}', where <data> is the identical (\binN #BDATA) | #SDATA production \pict's own payload uses). archive-codec now ships exactly that container (writeCompoundFile/readCompoundFile, [MS-CFB]) plus the OLE Package stream wrapper real Word/PowerPoint embeds use inside it (writeOlePackage/readOlePackage) -- the same pair doc-codec/xls-codec/ppt-codec already depend on archive-codec for, one layer up.
//
// What goes INSIDE that container is the one thing this module still has to decide for itself. rtf-codec cannot depend on ooxml.js/odf.js -- format codecs are peers in this family, never one another's dependency (see the monorepo README's package-layering rule) -- so a 'wordprocessing'/'presentation'/'spreadsheet'/'drawing'/'formula' embedded object's own ContentDocument cannot be re-serialised into a real docx/pptx/xlsx/odf/MathML byte stream here the way a genuine OLE server would. What this codec CAN write and read back losslessly is its own ContentDocument (a plain, Zod-validated, JSON-serialisable value -- see document-schema.js's own JSON Schema generation), so that JSON is the "file" this module packages: it rides inside the Package stream exactly the way a real embed's actual file bytes do, and readEmbeddedObjectData below reverses the identical path. A real Word-authored \object's OLESaveToStream data is a COM-specific structure with no JSON envelope inside it -- decoding that is out of scope, the same honest boundary a foreign/unsupported \pict format is dropped at, and readEmbeddedObjectData returns undefined for it rather than throwing.

import {
  readCompoundFile,
  readOlePackage,
  writeCompoundFile,
  writeOlePackage,
} from "archive-codec";
import {
  ContentEmbeddedObjectSchema,
  type ContentEmbeddedObject,
} from "document-schema.js";

// A fixed, ASCII-only label: archive-codec's writeOlePackage refuses a label/path outside ASCII (it carries no arbitrary-codepage encoder -- see its own doc comment), and nothing downstream branches on this string's content, so every \object this writer produces just names what it is.
const PACKAGE_LABEL = "rtf-codec-embedded-object.json";

// Builds the real [MS-CFB] compound-file bytes an \object's \objdata hex-encodes: this package's own JSON serialisation of `embedded`, wrapped in a Package stream, wrapped in a compound file -- archive-codec builds both container layers, this module supplies only the payload between them.
export function writeEmbeddedObjectData(
  embedded: ContentEmbeddedObject,
): Uint8Array<ArrayBuffer> {
  // Only the content fields ride the envelope -- sourcePath/frames (ContentEmbeddedObjectBlock's own additions) are reader/layout-assigned metadata, never persisted input, exactly as a format reader mints its own sourcePath fresh on every read rather than expecting a writer to have carried one forward.
  const payload: ContentEmbeddedObject = {
    objectKind: embedded.objectKind,
    document: embedded.document,
    frame: embedded.frame,
    anchorRow: embedded.anchorRow,
    anchorColumn: embedded.anchorColumn,
    offsetXPt: embedded.offsetXPt,
    offsetYPt: embedded.offsetYPt,
    source: embedded.source,
  };
  const fileBytes = new TextEncoder().encode(JSON.stringify(payload));
  const packageBytes = writeOlePackage({
    label: PACKAGE_LABEL,
    sourcePath: "",
    tempPath: "",
    fileBytes,
  });
  return writeCompoundFile([{ path: "Package", bytes: packageBytes }]);
}

// The mirror of writeEmbeddedObjectData: recovers a ContentEmbeddedObject from an \object's \objdata bytes when they are this package's own payload, or returns undefined for anything else -- a real OLE object's native data included -- rather than throwing, since one unreadable \object must not fail the whole document read. Every step below (compound-file parse, Package-stream unwrap, JSON parse, schema validation) can fail independently on a foreign object; the single catch treats all of them alike, matching xls-codec's own container.ts precedent ("archive-codec's own reader can surface a raw RangeError ... which is a corrupt file rather than a bug here").
export function readEmbeddedObjectData(
  bytes: Uint8Array<ArrayBuffer>,
): ContentEmbeddedObject | undefined {
  try {
    const streams = readCompoundFile(bytes);
    const packageStream = streams.find((stream) => stream.path === "Package");
    if (packageStream === undefined) {
      return undefined;
    }
    const olePackage = readOlePackage(packageStream.bytes);
    const text = new TextDecoder("utf-8").decode(olePackage.fileBytes);
    const parsed: unknown = JSON.parse(text);
    const result = ContentEmbeddedObjectSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
