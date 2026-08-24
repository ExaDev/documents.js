import type { ContentVector } from "document-schema.js";
import type { XmlElement } from "ooxml.js";
import {
  buildVectorShapeProperties,
  vectorPlacementBox,
  vectorShapeName,
} from "../drawingml/vector";
import { ptToEmu } from "../../model/units";
import { el, txt } from "../../xml/fragment";

// A ContentVector as a real WordprocessingML floating shape -- the docx half of the shared DrawingML vector writer (src/edit/drawingml/vector.ts holds everything inside the shape-properties element, which pptx expresses identically inside its own p:spPr).
//
// WHY wps:wsp RATHER THAN pic:pic: a:graphicData's own @uri names the namespace of whatever DrawingML part it carries -- that is the extension point the element exists for (ECMA-376 20.1.2.2.17). A picture uses the pic: namespace (see src/edit/docx/image.ts's buildInlineDrawing); a non-picture SHAPE in a text document uses wps:, the wordprocessingShape part both Word 2010+ and LibreOffice write and read. WordprocessingML has no shape vocabulary of its own -- the pre-2010 alternative is VML (w:pict/v:shape), deprecated by ECMA-376 itself and deliberately not written here.
//
// WHY ANCHORED AND NOT INLINE: a recovered vector carries page-absolute coordinates (src/layout/reconstruct.ts recovers geometry in page space), and wp:inline has no position at all -- it occupies a slot in the text flow at whatever size it declares, which for page-sized recovered geometry would push every following paragraph off the page. wp:anchor with both position axes relativeFrom="page" reproduces the recovered coordinates exactly. behindDoc="1" plus wp:wrapNone additionally keeps the geometry behind the text and out of its way, which is what the source was: painted fills and strokes underneath and around a page's glyphs, not an object the text flowed around.
//
// The honest limit of that choice, stated because it is real: the anchor still belongs to a PARAGRAPH, so which page the geometry lands on follows that paragraph, and a document that reflows differently in Word than it laid out in the source PDF moves the shape with it. There is no page-independent anchor in WordprocessingML to use instead -- a shape is always anchored to some run of text.

const DRAWING_NS = {
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
};

// CT_Anchor declares all of these as REQUIRED attributes (ECMA-376 20.4.2.3), so every one is written even where the value is the do-nothing default: distT/B/L/R are the text stand-off distances (zero, since wrapNone means no text is being pushed away in the first place), simplePos="0" selects the positionH/positionV pair over the wp:simplePos coordinate, locked="0"/layoutInCell="1"/allowOverlap="1" are Word's own defaults for a freshly drawn shape, and relativeHeight is the z-order among floating objects.
const ANCHOR_ATTRS: Readonly<Record<string, string>> = {
  distT: "0",
  distB: "0",
  distL: "0",
  distR: "0",
  simplePos: "0",
  locked: "0",
  layoutInCell: "1",
  allowOverlap: "1",
  behindDoc: "1",
};

function position(
  tag: "wp:positionH" | "wp:positionV",
  offsetPt: number,
): XmlElement {
  return el(tag, { relativeFrom: "page" }, [
    el("wp:posOffset", {}, [txt(String(ptToEmu(offsetPt)))]),
  ]);
}

// `relativeHeight` is the shape's z-order among a page's floating objects, lowest painting first -- so passing the vector's own recovery index preserves the paint order the geometry was recovered in. Word requires the attribute regardless of whether anything overlaps.
export function buildAnchoredVectorDrawing(
  vector: ContentVector,
  drawingId: number,
  relativeHeight: number,
): XmlElement {
  const frame = vectorPlacementBox(vector);
  const cx = String(ptToEmu(frame.widthPt));
  const cy = String(ptToEmu(frame.heightPt));
  const name = vectorShapeName(vector, drawingId);

  const wsp = el("wps:wsp", {}, [
    el("wps:cNvSpPr"),
    el("wps:spPr", {}, buildVectorShapeProperties(vector)),
    // wps:bodyPr is required by CT_WordprocessingShape even for a shape carrying no text at all, unlike pptx's own optional p:txBody.
    el("wps:bodyPr"),
  ]);
  const anchor = el(
    "wp:anchor",
    { ...ANCHOR_ATTRS, relativeHeight: String(relativeHeight) },
    [
      el("wp:simplePos", { x: "0", y: "0" }),
      position("wp:positionH", frame.xPt),
      position("wp:positionV", frame.yPt),
      el("wp:extent", { cx, cy }),
      el("wp:effectExtent", { l: "0", t: "0", r: "0", b: "0" }),
      el("wp:wrapNone"),
      el("wp:docPr", { id: String(drawingId), name }),
      el("a:graphic", {}, [
        el("a:graphicData", { uri: DRAWING_NS.wps }, [wsp]),
      ]),
    ],
  );
  // Namespace prefixes are declared locally on w:drawing rather than assumed at the document root, for the same reason buildInlineDrawing declares its own (src/edit/docx/image.ts): the fragment is then valid XML on its own regardless of what word/document.xml's root element happens to declare.
  return el(
    "w:drawing",
    {
      "xmlns:wp": DRAWING_NS.wp,
      "xmlns:a": DRAWING_NS.a,
      "xmlns:wps": DRAWING_NS.wps,
    },
    [anchor],
  );
}
