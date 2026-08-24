import type { ContentVector } from "document-schema.js";
import type { Package, XmlElement, XmlNode } from "ooxml.js";
import { resolveRelationships, rootElement, textContent } from "ooxml.js";
import type { Box } from "document-schema.js";
import { ensureContentTypeOverride } from "../../opc/content-types";
import { buildRelativeTarget } from "../../opc/paths";
import { addRelationship } from "../../opc/rels";
import { removeChild } from "../../xml/edit";
import { encodeXmlText } from "../../xml/entities";
import { el, txt } from "../../xml/fragment";
import type { ImageInit, MediaContext } from "./image";
import { insertPictureShapeMedia } from "./image";
import {
  buildEmptyGroupSpTree,
  DML_NS,
  ensureNotesMaster,
  NOTES_MASTER_REL_TYPE,
  PML_NS,
} from "./scaffold";
import { buildTextBoxShape, PptxShape } from "./shape";
import type { PptxTableInit } from "./table";
import {
  buildDrawingTable,
  buildTableGraphicFrame,
  findGraphicFrameTable,
  PptxTable,
} from "./table";
import { buildVectorShape } from "./vector";

export interface TextBoxInit {
  readonly frame: Box;
  readonly text: string;
}

export interface SlideImageInit extends ImageInit {
  readonly frame: Box;
}

export interface SlideTableInit {
  readonly frame: Box;
  readonly table: PptxTableInit;
  readonly rotationDeg?: number;
}

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

function findSpTree(slideRoot: XmlElement): XmlElement {
  const cSld = directChild(slideRoot, "p:cSld");
  const spTree = cSld === undefined ? undefined : directChild(cSld, "p:spTree");
  if (spTree === undefined) {
    throw new Error("slide has no p:cSld/p:spTree element");
  }
  return spTree;
}

function nextIdIn(root: XmlElement): number {
  let max = 0;
  const stack: XmlElement[] = [root];
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

const NOTES_SLIDE_RELATIONSHIP_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const NOTES_SLIDE_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";

function buildMinimalNotesSlide(text: string): XmlElement {
  // A single body placeholder holding the text, with an explicit a:xfrm rather than leaving the placeholder to inherit geometry from the notesMaster's own matching placeholder (position/size matched against a real Keynote-exported reference file's own notes body placeholder). type="body" without idx matches the same reference: idx="1" alone (this scaffold's earlier attempt) turned out not to be the actual defect blocking Keynote from opening the file at all -- see the p:clrMapOvr note below for what was.
  const body = el("p:sp", {}, [
    el("p:nvSpPr", {}, [
      el("p:cNvPr", { id: "2", name: "Notes Placeholder" }),
      el("p:cNvSpPr", {}, [el("a:spLocks", { noGrp: "1" })]),
      el("p:nvPr", {}, [el("p:ph", { type: "body", idx: "1" })]),
    ]),
    el("p:spPr", {}, [
      el("a:xfrm", {}, [
        el("a:off", { x: "685800", y: "4400550" }),
        el("a:ext", { cx: "5486400", cy: "4200525" }),
      ]),
    ]),
    el("p:txBody", {}, [
      el("a:bodyPr"),
      el("a:lstStyle"),
      el("a:p", {}, [
        el("a:r", {}, [el("a:t", {}, [txt(encodeXmlText(text))])]),
      ]),
    ]),
  ]);
  // xmlns:p/xmlns:a and the mandatory p:nvGrpSpPr/p:grpSpPr pair are required on p:notes' own p:spTree for the same reason they are on a slide's (see editor.ts's buildEmptySlideRoot).
  const spTree = buildEmptyGroupSpTree();
  spTree.children.push(body);
  // CT_NotesSlide requires p:clrMapOvr as a direct sibling of p:cSld (mirroring CT_SlideLayout's own p:clrMapOvr, which this scaffold already got right) -- confirmed missing, and confirmed as the actual blocker, by diffing against a real Keynote-exported reference pptx with speaker notes: every other structural piece here (namespaces, the nvGrpSpPr/grpSpPr pair, the notesMaster chain) was already correct and still failed to open without this element.
  return el("p:notes", { "xmlns:p": PML_NS, "xmlns:a": DML_NS }, [
    el("p:cSld", {}, [spTree]),
    el("p:clrMapOvr", {}, [el("a:masterClrMapping")]),
  ]);
}

export interface SlideContext {
  readonly pkg: Package;
  readonly slidePartPath: string;
  readonly mediaDir: string;
}

// A live view over a p:sld element's shape tree.
export class PptxSlide {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private readonly context: SlideContext;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement, context: SlideContext) {
    this.container = container;
    this.node = node;
    this.context = context;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error(
        "this PptxSlide has been removed from the presentation and can no longer be used",
      );
    }
    return this.node;
  }

  shapes(): PptxShape[] {
    const spTree = findSpTree(this.live());
    const out: PptxShape[] = [];
    for (const child of spTree.children) {
      if (
        child.type === "element" &&
        (child.tag === "p:sp" || child.tag === "p:pic")
      ) {
        out.push(new PptxShape(spTree.children, child));
      }
    }
    return out;
  }

  // Live handles on every DrawingML table already on this slide, in document order -- the read-side inverse of addTable, and the table-shaped counterpart to shapes() above. A table lives in its own p:graphicFrame, a shape kind shapes() never walks at all (see addTable's own note on why it needs a PptxTable rather than a PptxShape), so this is a genuinely separate enumeration rather than a filter over shapes()'s own result. findGraphicFrameTable (table.ts) is the exact uri === TABLE_GRAPHIC_URI check that excludes a chart/SmartArt graphic frame from being mistaken for a table.
  tables(): PptxTable[] {
    const spTree = findSpTree(this.live());
    const out: PptxTable[] = [];
    for (const child of spTree.children) {
      if (child.type !== "element" || child.tag !== "p:graphicFrame") {
        continue;
      }
      const tableElement = findGraphicFrameTable(child);
      if (tableElement !== undefined) {
        out.push(new PptxTable(tableElement));
      }
    }
    return out;
  }

  addTextBox(init: TextBoxInit): PptxShape {
    const spTree = findSpTree(this.live());
    const id = nextIdIn(spTree);
    const shapeElement = buildTextBoxShape(init.frame, init.text, id);
    spTree.children.push(shapeElement);
    return new PptxShape(spTree.children, shapeElement);
  }

  // A vector primitive (rect/ellipse/line/path) as its own p:sp on this slide's shape tree, appended in call order -- p:spTree's document order IS paint order in PresentationML, exactly as draw:page's is in ODF, so a later addVector/addTextBox call paints in front of an earlier one with nothing else to declare. Returns a PptxShape because a vector shape IS a p:sp: frame/rotationDeg read and write through the same p:spPr/a:xfrm every other shape uses.
  addVector(vector: ContentVector): PptxShape {
    const spTree = findSpTree(this.live());
    const shapeElement = buildVectorShape(vector, nextIdIn(spTree));
    spTree.children.push(shapeElement);
    return new PptxShape(spTree.children, shapeElement);
  }

  addImage(init: SlideImageInit): PptxShape {
    const slideRoot = this.live();
    const spTree = findSpTree(slideRoot);
    const media: MediaContext = {
      pkg: this.context.pkg,
      partPath: this.context.slidePartPath,
      mediaDir: this.context.mediaDir,
    };
    const shapeElement = insertPictureShapeMedia(
      media,
      slideRoot,
      init.frame,
      init,
    );
    spTree.children.push(shapeElement);
    return new PptxShape(spTree.children, shapeElement);
  }

  // A DrawingML table lives in its own p:graphicFrame, a shape kind distinct from p:sp/p:pic (see table.ts's own buildTableGraphicFrame) -- so it gets its own PptxTable view rather than a PptxShape.
  addTable(init: SlideTableInit): PptxTable {
    const spTree = findSpTree(this.live());
    const id = nextIdIn(spTree);
    const tableElement = buildDrawingTable(init.table);
    const graphicFrame = buildTableGraphicFrame(
      init.frame,
      tableElement,
      id,
      init.rotationDeg,
    );
    spTree.children.push(graphicFrame);
    return new PptxTable(tableElement);
  }

  get notes(): string {
    const rels = resolveRelationships(
      this.context.pkg,
      this.context.slidePartPath,
    );
    const notesRel = [...rels.values()].find(
      (r) => r.type === NOTES_SLIDE_RELATIONSHIP_TYPE,
    );
    if (notesRel === undefined) {
      return "";
    }
    const notesRoot = rootElement(this.context.pkg.parts[notesRel.target]);
    return notesRoot === undefined ? "" : textContent(notesRoot);
  }

  set notes(value: string) {
    const { pkg, slidePartPath } = this.context;
    const rels = resolveRelationships(pkg, slidePartPath);
    const existingRel = [...rels.values()].find(
      (r) => r.type === NOTES_SLIDE_RELATIONSHIP_TYPE,
    );
    let notesPartPath: string;
    if (existingRel === undefined) {
      const nextIndex =
        Object.keys(pkg.parts).filter((p) =>
          /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p),
        ).length + 1;
      notesPartPath = `ppt/notesSlides/notesSlide${nextIndex}.xml`;
      ensureContentTypeOverride(pkg, notesPartPath, NOTES_SLIDE_CONTENT_TYPE);
      addRelationship(pkg, slidePartPath, {
        type: NOTES_SLIDE_RELATIONSHIP_TYPE,
        target: buildRelativeTarget(slidePartPath, notesPartPath),
      });
      // CT_NotesSlide requires its own relationship to a notesMaster, the same way an ordinary slide requires one to a slideLayout -- confirmed by testing against real Keynote, which rejected the whole file when this notesSlide part existed without it.
      const notesMasterPartPath = ensureNotesMaster(pkg);
      addRelationship(pkg, notesPartPath, {
        type: NOTES_MASTER_REL_TYPE,
        target: buildRelativeTarget(notesPartPath, notesMasterPartPath),
      });
    } else {
      notesPartPath = existingRel.target;
    }
    pkg.parts[notesPartPath] = {
      kind: "xml",
      nodes: [buildMinimalNotesSlide(value)],
    };
  }

  // Registers an external hyperlink relationship against this slide's own .rels part and returns the allocated r:id, for buildDrawingRun's a:hlinkClick@r:id. Exposes the slide's relationship capability without exposing the full private context.
  registerHyperlink(url: string): string {
    return addRelationship(this.context.pkg, this.context.slidePartPath, {
      type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
      target: url,
      targetMode: "External",
    });
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}
