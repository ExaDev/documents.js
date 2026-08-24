import type { Package, XmlElement } from "ooxml.js";
import type { Box } from "document-schema.js";
import { addImageMedia } from "../../opc/media";
import { buildPictureShape } from "./shape";

export interface ImageInit {
  readonly format: "png" | "jpeg";
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly altText?: string;
}

export interface MediaContext {
  readonly pkg: Package;
  readonly partPath: string;
  readonly mediaDir: string;
}

// p:cNvPr/@id must be a document-unique (per-slide, in practice per-presentation) numeric id -- scanning the slide tree for the highest existing one mirrors opc/rels.ts's rId allocation.
function nextShapeId(slideRoot: XmlElement): number {
  let max = 0;
  const stack: XmlElement[] = [slideRoot];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    if (node.tag === "p:cNvPr") {
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

// Adds the binary media part + content-type entry + relationship, then returns the p:pic shape fragment referencing it, positioned at `frame`. The caller (PptxSlide) inserts the returned element into the slide's p:spTree.
export function insertPictureShapeMedia(
  context: MediaContext,
  slideRoot: XmlElement,
  frame: Box,
  image: ImageInit,
): XmlElement {
  const { relationshipId } = addImageMedia(
    context.pkg,
    context.partPath,
    context.mediaDir,
    image.format,
    image.bytes,
  );
  const id = nextShapeId(slideRoot);
  return buildPictureShape(frame, relationshipId, id);
}
