import type {
  ContentEmbeddedObjectBlock,
  ContentImageBlock,
} from "document-schema.js";
import {
  DRAWINGML_NS,
  DRAWING_PIC_NS,
  REL_OLE_OBJECT,
} from "./write-constants";
import type { WriteState } from "./write";
import type { XmlElement } from "../../model/node";
import {
  addRelationship,
  buildDocxPackageFromContent,
  imageRelationshipId,
} from "./write";
import { buildXlsxPackageFromContent } from "../xlsx/build";
import { bytesToBase64 } from "byte-codec";
import { el } from "../../xml/fragment";
import { encodePackage } from "../../codec";
import { encodeXmlText } from "../../xml/entities";
import { ptToEmu, ptToTwips } from "../shared/units";
// The embedded-object and drawing family of the docx writer, split from write.ts: inline drawings, embedded payload extraction and the object element, plus tracked-change attributes. write.ts keeps the text flow and package assembly.
// --- images -----------------------------------------------------------------------------------------------------------

export function buildDrawing(
  image: ContentImageBlock,
  state: WriteState,
): XmlElement {
  const relId = imageRelationshipId(state, image);
  const drawingId = state.counters.nextDrawingId++;
  const cx = String(ptToEmu(image.widthPt));
  const cy = String(ptToEmu(image.heightPt));
  const docPrAttrs: Record<string, string> = {
    id: String(drawingId),
    name: `Picture ${String(drawingId)}`,
  };
  if (image.altText !== undefined) {
    docPrAttrs.descr = encodeXmlText(image.altText);
  }
  const picture = el("pic:pic", { "xmlns:pic": DRAWING_PIC_NS }, [
    el("pic:nvPicPr", {}, [
      el("pic:cNvPr", {
        id: String(drawingId),
        name: `Picture ${String(drawingId)}`,
      }),
      el("pic:cNvPicPr"),
    ]),
    el("pic:blipFill", {}, [
      el("a:blip", { "r:embed": relId }),
      el("a:stretch", {}, [el("a:fillRect")]),
    ]),
    el("pic:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "0", y: "0" }),
        el("a:ext", { cx, cy }),
      ]),
      el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
    ]),
  ]);
  return el("w:drawing", {}, [
    el("wp:inline", { distT: "0", distB: "0", distL: "0", distR: "0" }, [
      el("wp:extent", { cx, cy }),
      el("wp:docPr", docPrAttrs),
      el("a:graphic", { "xmlns:a": DRAWINGML_NS }, [
        el("a:graphicData", { uri: DRAWING_PIC_NS }, [picture]),
      ]),
    ]),
  ]);
}

// --- embedded objects -------------------------------------------------------------------------------------------------

// The OLE payload part this writer produces for one embedded object: the nested document re-serialised through its own format's builder and zipped — the direct-ZIP spelling, not a classic OLE compound-file wrapper, matching what readEmbeddedOoxmlPayload accepts at any embeddings path (the payload is detected by ZIP magic and entry part, never by extension or content type).
export interface EmbeddedPayload {
  readonly extension: "docx" | "xlsx" | "pptx";
  readonly progId: string;
  readonly base64: string;
}

// Serialises an embedded object's nested document into its OLE payload bytes, dispatching on the document's own kind rather than the block's objectKind label: the payload's bytes, part extension, and ProgID are all properties of the document being serialised, and while schema treats the objectKind/document.kind pairing as a producer convention rather than a constraint, the only coherent rule for a writer is one source of truth — the document itself. The ProgIDs are the canonical OLE names of the OOXML-era Office applications (what a real producer's o:OLEObject carries and what Word launches to activate the embed); the schema carries no progId field, so the writer synthesises one per kind.
//
// A presentation document serialises through the injected port (state.serialiseEmbeddedPresentation — EmbeddedPresentationSerialiser's own comment states why it is a port), and a document kind with no serialiser at all is refused loudly rather than silently dropped: readDocxContent recovers embedded wordprocessing, presentation, and spreadsheet documents alike, so silently skipping any of them would re-create exactly the read-once-never-written loss this emitter exists to close. Drawing/formula are ODF/MathML spellings no OOXML OLE payload corresponds to — the reader's degrade-tier rule (second-order content never fails the host read) inverts at the write boundary, where the caller is explicitly asking for a document and a writer that cannot produce one faithfully says so.
export function embeddedPayloadOf(
  document: ContentEmbeddedObjectBlock["document"],
  state: WriteState,
): EmbeddedPayload {
  switch (document.kind) {
    case "wordprocessing":
      return {
        extension: "docx",
        progId: "Word.Document.12",
        base64: bytesToBase64(
          encodePackage(buildDocxPackageFromContent(document)),
        ),
      };
    case "spreadsheet":
      return {
        extension: "xlsx",
        progId: "Excel.Sheet.12",
        base64: bytesToBase64(
          encodePackage(buildXlsxPackageFromContent(document)),
        ),
      };
    case "presentation": {
      const serialise = state.serialiseEmbeddedPresentation;
      if (serialise === undefined) {
        throw new Error(
          "buildDocxPackageFromContent: an embedded object carrying a presentation document has no serialiser (this package has no PresentationML writer; pass options.serialiseEmbeddedPresentation — documents.js wires one from its own pptx builder)",
        );
      }
      return {
        extension: "pptx",
        progId: "PowerPoint.Show.12",
        base64: bytesToBase64(serialise(document)),
      };
    }
    default:
      throw new Error(
        `buildDocxPackageFromContent: an embedded object carrying a ${document.kind} document has no OOXML OLE payload this writer can produce (embedded wordprocessing and spreadsheet documents serialise through their own builders, a presentation through options.serialiseEmbeddedPresentation, and drawing/formula are ODF/MathML spellings)`,
      );
  }
}

// One embeddings part and one relationship per distinct payload, mirroring imageRelationshipId: copy-pasted objects (the common case — the reader decodes one shared part and hands both blocks the same nested document) serialise to identical bytes and therefore re-share one part, never one duplicate part per occurrence.
export function embeddedObjectRelationshipId(
  state: WriteState,
  payload: EmbeddedPayload,
): string {
  const existing = state.embeddingIds.get(payload.base64);
  if (existing !== undefined) {
    return existing;
  }
  let name = state.counters.embeddingFiles.get(payload.base64);
  if (name === undefined) {
    name = `oleObject${String(state.counters.nextEmbeddingFileId++)}.${payload.extension}`;
    state.counters.embeddingFiles.set(payload.base64, name);
  }
  state.embeddingParts.set(name, payload);
  const id = addRelationship(
    state,
    REL_OLE_OBJECT,
    `embeddings/${name}`,
    false,
  );
  state.embeddingIds.set(payload.base64, id);
  return id;
}

// readObjectEmbeddedObject's inverse: w:dxaOrig/w:dyaOrig carry the block frame's size in twips (the reader skips a w:object missing either attribute, so both are always written — position is not written, since an inline flow object has none and the reader's own frame sits at the origin), and o:OLEObject names the payload part through its relationship. No VML preview picture (v:shape/v:imagedata) is emitted: the reader never read one into the model (no VML reader exists, and real producers ship WMF/EMF previews this ecosystem has no writer for), so there are no preview bytes to carry and regenerating one is out of scope — Word shows the object as blank until activated. ProgID and DrawAspect are Word's own activation vocabulary; this package's reader reads only r:id.
export function buildObjectElement(
  block: ContentEmbeddedObjectBlock,
  state: WriteState,
): XmlElement {
  const payload = embeddedPayloadOf(block.document, state);
  const relId = embeddedObjectRelationshipId(state, payload);
  return el(
    "w:object",
    {
      "w:dxaOrig": String(ptToTwips(block.frame.widthPt)),
      "w:dyaOrig": String(ptToTwips(block.frame.heightPt)),
    },
    [
      el("o:OLEObject", {
        Type: "Embed",
        ProgID: payload.progId,
        DrawAspect: "Content",
        "r:id": relId,
      }),
    ],
  );
}

// --- construct markers ------------------------------------------------------------------------------------------------
