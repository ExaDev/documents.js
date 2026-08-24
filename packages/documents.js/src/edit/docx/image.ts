import type { Package, XmlElement, XmlNode } from "ooxml.js";
import { ptToEmu } from "../../model/units";
import { addImageMedia } from "../../opc/media";
import { el } from "../../xml/fragment";

export interface ImageInit {
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly altText?: string;
}

const DRAWING_NS = {
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
};

// wp:docPr and pic:cNvPr both need a document-unique numeric id; scanning the whole document.xml tree for the highest existing one (mirroring how opc/rels.ts allocates rIds) keeps new ids from ever colliding with ones already present. Exported for src/edit/docx/paragraph.ts's own appendVectorAnchor, which needs the identical wp:docPr id allocation without any media part to insert alongside it.
export function nextDrawingId(documentRoot: XmlElement): number {
  let max = 0;
  const stack: XmlElement[] = [documentRoot];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    if (node.tag === "wp:docPr" || node.tag === "pic:cNvPr") {
      for (const a of node.attributes) {
        if (a.name === "id") {
          const n = Number.parseInt(a.value, 10);
          if (!Number.isNaN(n) && n > max) {
            max = n;
          }
        }
      }
    }
    for (const child of node.children) {
      if (child.type === "element") {
        stack.push(child);
      }
    }
  }
  return max + 1;
}

// Builds the w:drawing fragment for an inline image referencing relationshipId, sized in EMU, with a document-unique docPr/cNvPr id.
export function buildInlineDrawing(
  relationshipId: string,
  widthPt: number,
  heightPt: number,
  id: number,
  altText: string | undefined,
): XmlElement {
  const cx = String(ptToEmu(widthPt));
  const cy = String(ptToEmu(heightPt));
  const name = altText ?? "Picture";

  const blipFill = el("pic:blipFill", {}, [
    el("a:blip", { "r:embed": relationshipId }),
    el("a:stretch", {}, [el("a:fillRect")]),
  ]);
  const spPr = el("pic:spPr", {}, [
    el("a:xfrm", {}, [
      el("a:off", { x: "0", y: "0" }),
      el("a:ext", { cx, cy }),
    ]),
    el("a:prstGeom", { prst: "rect" }, [el("a:avLst")]),
  ]);
  const pic = el("pic:pic", {}, [
    el("pic:nvPicPr", {}, [
      el("pic:cNvPr", { id: String(id), name }),
      el("pic:cNvPicPr"),
    ]),
    blipFill,
    spPr,
  ]);
  const graphic = el("a:graphic", {}, [
    el("a:graphicData", { uri: DRAWING_NS.pic }, [pic]),
  ]);
  const inline = el("wp:inline", {}, [
    el("wp:extent", { cx, cy }),
    el("wp:docPr", { id: String(id), name }),
    graphic,
  ]);
  // Namespace prefixes (wp:/a:/pic:/r:) are declared locally on w:drawing rather than assumed to be declared at the document root -- this fragment is then valid XML on its own regardless of what the enclosing word/document.xml root element does or doesn't declare.
  return el(
    "w:drawing",
    {
      "xmlns:wp": DRAWING_NS.wp,
      "xmlns:a": DRAWING_NS.a,
      "xmlns:pic": DRAWING_NS.pic,
      "xmlns:r": DRAWING_NS.r,
    },
    [inline],
  );
}

export interface MediaContext {
  readonly pkg: Package;
  readonly partPath: string;
  readonly mediaDir: string;
}

// Adds the binary media part + content-type entry + relationship (src/opc/media.ts's addImageMedia), then returns the w:drawing fragment referencing it -- the caller (DocxParagraph) is responsible for inserting the fragment into a w:r at the right place in the document tree.
export function insertImageMedia(
  context: MediaContext,
  documentRoot: XmlElement,
  image: ImageInit,
): XmlNode {
  const { relationshipId } = addImageMedia(
    context.pkg,
    context.partPath,
    context.mediaDir,
    image.format,
    image.bytes,
  );
  const id = nextDrawingId(documentRoot);
  return buildInlineDrawing(
    relationshipId,
    image.widthPt,
    image.heightPt,
    id,
    image.altText,
  );
}
