import type { ContentShape, ContentSlide } from "document-schema.js";
import type { Package, Relationship, XmlElement, XmlNode } from "ooxml.js";
import {
  attr,
  base64ToBytes,
  childrenWithTag,
  elementsWithTag,
} from "ooxml.js";
import { decodeLegacyEmbeddedObject } from "../legacy-embedded";

// pptx-side legacy-OLE-embedding detection (ExaDev/documents.js#921), the counterpart to src/ooxml/docx/embedded-objects.ts's own collectParagraphOleObjects/resolveLegacyOleObject. A p:graphicFrame's a:graphicData[uri=OLE_GRAPHIC_URI]/p:oleObj whose payload is a classic OLE compound file holding native Word 97/Excel 97/PowerPoint 97 streams (no "Package" stream a ZIP could sit in) is already a real ContentShape by the time this pass runs -- ooxml.js's own readGraphicFrameShape (typed/pptx/read.ts) always produces one, from the OLE object's own fallback picture where the frame carries one -- but that shape's blocks never gain the recovered sub-document the way the ZIP-payload case does (readOleEmbeddedObject there pushes an embeddedObject block "beside whatever the display path produced", its own comment's wording). This mirrors that exact append, for the shape the upstream reader already built.
const OLE_GRAPHIC_URI =
  "http://schemas.openxmlformats.org/presentationml/2006/ole";

interface WalkState {
  shapeIndex: number;
}

interface FoundLegacyOleShape {
  readonly shapeIndex: number;
  readonly oleObj: XmlElement;
}

// A shape-tree walk mirroring src/ooxml/pptx/formula.ts's own collectFormulaShapes and src/ooxml/pptx/vector.ts's own collectVectorOnlyShapes exactly: p:sp/p:pic/p:graphicFrame each occupy one shape slot in document order, p:grpSp recurses, p:cxnSp occupies none.
function collectLegacyOleShapes(
  children: readonly XmlNode[],
  state: WalkState,
  out: FoundLegacyOleShape[],
): void {
  for (const node of children) {
    if (node.type !== "element") {
      continue;
    }
    if (node.tag === "p:sp" || node.tag === "p:pic") {
      state.shapeIndex += 1;
    } else if (node.tag === "p:graphicFrame") {
      const shapeIndex = state.shapeIndex;
      state.shapeIndex += 1;
      const graphic = childrenWithTag(node, "a:graphic")[0];
      const graphicData =
        graphic === undefined
          ? undefined
          : childrenWithTag(graphic, "a:graphicData")[0];
      if (
        graphicData !== undefined &&
        attr(graphicData, "uri") === OLE_GRAPHIC_URI
      ) {
        const oleObj = elementsWithTag([graphicData], "p:oleObj")[0];
        if (oleObj !== undefined) {
          out.push({ shapeIndex, oleObj });
        }
      }
    } else if (node.tag === "p:grpSp") {
      collectLegacyOleShapes(node.children, state, out);
    }
    // p:cxnSp (a connector) occupies no shape slot, matching the sibling detectors' identical exclusion.
  }
}

// Rebuilds a slide's own shapes array, appending a recovered legacy embedding to each p:graphicFrame shape whose OLE payload turned out to be a classic compound file none of ooxml.js's own ZIP/CFB- Package-stream decoding can place. Undefined for every non-recovery shape: no o:oleObj, no r:id, no matching relationship, a non-binary part, or a payload none of the three legacy readers can place -- the shape keeps whatever the upstream reader's own fallback-picture display already gave it, exactly the same degrade-tier that reader's own OLE resolution already applies. Returns `slide` unchanged when nothing was recovered.
export function spliceSlideLegacyEmbeddedObjects(
  slide: ContentSlide,
  spTreeChildren: readonly XmlNode[],
  slideRels: ReadonlyMap<string, Relationship>,
  pkg: Package,
): ContentSlide {
  const state: WalkState = { shapeIndex: 0 };
  const found: FoundLegacyOleShape[] = [];
  collectLegacyOleShapes(spTreeChildren, state, found);
  if (found.length === 0) {
    return slide;
  }

  const shapes: ContentShape[] = [...slide.shapes];
  for (const { shapeIndex, oleObj } of found) {
    const shape = shapes[shapeIndex];
    if (shape === undefined) {
      continue;
    }
    const rId = attr(oleObj, "r:id");
    const rel = rId === undefined ? undefined : slideRels.get(rId);
    const payloadPart = rel === undefined ? undefined : pkg.parts[rel.target];
    if (payloadPart?.kind !== "binary") {
      continue;
    }
    const payload = decodeLegacyEmbeddedObject(
      base64ToBytes(payloadPart.base64),
    );
    if (payload === undefined) {
      continue;
    }
    shapes[shapeIndex] = {
      ...shape,
      blocks: [
        ...shape.blocks,
        {
          kind: "embeddedObject",
          objectKind: payload.objectKind,
          document: payload.document,
          frame: shape.frame,
        },
      ],
    };
  }
  return { ...slide, shapes };
}
