import type { ContentParagraph, ContentRun } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { attr, childrenWithTag, textContent } from "../util";

// Reads a SmartArt diagram's data model part (a dgm:dataModel root) into paragraphs of node text in diagram order. The data model is the semantic half of a SmartArt graphic (the dgm:relIds' r:dm target): a graph of points whose text lives in dgm:t text bodies, plus the parOf connections that make it a tree rooted at the type="doc" point. The layout/quickStyle/colour parts (r:lo/r:qs/r:cs) decide only how that graph is drawn and are not read.

// A node's a:p paragraphs become ContentParagraphs with one plain-text run per a:r/a:fld (an a:br becomes a literal-newline run) -- the same structure readParagraph produces for slide text, minus the placeholder inheritance cascade a diagram's private text body never participates in.
function diagramTextParagraphs(
  txBody: XmlElement | undefined,
): ContentParagraph[] {
  if (txBody === undefined) {
    return [];
  }
  return childrenWithTag(txBody, "a:p").map((p) => {
    const runs: ContentRun[] = [];
    for (const child of p.children) {
      if (child.type !== "element") {
        continue;
      }
      if (child.tag === "a:r" || child.tag === "a:fld") {
        const t = childrenWithTag(child, "a:t")[0];
        runs.push({ text: t === undefined ? "" : textContent(t) });
      } else if (child.tag === "a:br") {
        runs.push({ text: "\n" });
      }
    }
    return { kind: "paragraph", runs };
  });
}

// Diagram order is a depth-first walk from the doc point over parOf connections, siblings ordered by srcOrd (ST_Cxn's ordering key; a missing srcOrd sorts as the format's own zero). Points typed node (the ST_PtType default) or asst carry the diagram's text; doc is the container root, and parTrans/sibTrans/pres hold connector/presentation-only text that is deliberately not node content. A node with no text at all contributes nothing; a node with any text keeps all of its paragraphs, including intentionally blank ones between text lines.
export function readDiagramText(dataModelRoot: XmlElement): ContentParagraph[] {
  const ptLst = childrenWithTag(dataModelRoot, "dgm:ptLst")[0];
  const cxnLst = childrenWithTag(dataModelRoot, "dgm:cxnLst")[0];
  if (ptLst === undefined) {
    return [];
  }
  const pointsByModelId = new Map<
    string,
    { type: string; txBody: XmlElement | undefined }
  >();
  let docModelId: string | undefined;
  for (const pt of childrenWithTag(ptLst, "dgm:pt")) {
    const modelId = attr(pt, "modelId");
    if (modelId === undefined) {
      continue;
    }
    const type = attr(pt, "type") ?? "node";
    pointsByModelId.set(modelId, {
      type,
      txBody: childrenWithTag(pt, "dgm:t")[0],
    });
    if (type === "doc") {
      docModelId = modelId;
    }
  }
  if (docModelId === undefined) {
    return [];
  }
  const childrenBySrcId = new Map<
    string,
    { destId: string; srcOrd: number }[]
  >();
  if (cxnLst !== undefined) {
    for (const cxn of childrenWithTag(cxnLst, "dgm:cxn")) {
      // A cxn with no type attribute is a parOf edge (ST_CxnType's default); presOf/presParOf only re-state the tree for the layout half and would duplicate content.
      if ((attr(cxn, "type") ?? "parOf") !== "parOf") {
        continue;
      }
      const srcId = attr(cxn, "srcId");
      const destId = attr(cxn, "destId");
      if (srcId === undefined || destId === undefined) {
        continue;
      }
      const srcOrd = attr(cxn, "srcOrd");
      const siblings = childrenBySrcId.get(srcId);
      const edge = {
        destId,
        srcOrd: srcOrd === undefined ? 0 : Number(srcOrd),
      };
      if (siblings === undefined) {
        childrenBySrcId.set(srcId, [edge]);
      } else {
        siblings.push(edge);
      }
    }
  }
  const blocks: ContentParagraph[] = [];
  // A self-referential or otherwise malformed cxn graph must not loop the walk forever.
  const visited = new Set<string>();
  const visit = (modelId: string): void => {
    if (visited.has(modelId)) {
      return;
    }
    visited.add(modelId);
    const point = pointsByModelId.get(modelId);
    if (
      point !== undefined &&
      (point.type === "node" || point.type === "asst")
    ) {
      const paragraphs = diagramTextParagraphs(point.txBody);
      if (paragraphs.some((p) => p.runs.some((run) => run.text !== ""))) {
        blocks.push(...paragraphs);
      }
    }
    const children = childrenBySrcId.get(modelId);
    if (children === undefined) {
      return;
    }
    // Array.prototype.sort is stable, so equal srcOrd keeps the cxnLst's own document order.
    children.sort((a, b) => a.srcOrd - b.srcOrd);
    for (const child of children) {
      visit(child.destId);
    }
  };
  visit(docModelId);
  return blocks;
}
