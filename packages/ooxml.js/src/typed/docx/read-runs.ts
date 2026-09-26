import type {
  AnchorDescriptor,
  ConstructDescriptor,
  ContentBlock,
  ContentControlDescriptor,
  ContentEmbeddedObjectBlock,
  ContentFloatAlign,
  ContentFloatAxis,
  ContentFloatOrigin,
  ContentFloatPosition,
  ContentImageBlock,
  ContentRun,
} from "document-schema.js";
import {
  ContentFloatAlignSchema,
  ContentFloatOriginSchema,
} from "document-schema.js";
import type { DocxReadContext } from "./read";
import type { DocxStyleContext } from "./styles";
import type { ParagraphRangeMarkerHalf, RangeMarkerFamily } from "./constructs";
import type { XmlElement, XmlNode } from "../../model/node";
import {
  attr,
  childrenWithTag,
  decodeEntities,
  elementsWithTag,
  textContent,
} from "../util";
import { base64ToBytes } from "byte-codec";
import { emuToPt, twipsToPt } from "../shared/units";
import {
  fieldCharType,
  readFormControlDescriptor,
  runInstructionText,
} from "./constructs";
import { readEmbeddedPayloadPart } from "../embedded";
import { resolveRunProperties } from "./styles";
import { sniffImageFormat } from "../../image/sniff";
// The run-reading family of the docx reader, split from read.ts: readRun and the paragraph run-event machinery (fields, simple fields, point anchors, links, page breaks) through readParagraphRuns. read.ts keeps paragraph assembly and the document walk.
// A run's own w:t/w:delText/w:tab/w:br children are ordered and interleaved (e.g. "text" w:tab "more text" within one w:r) — concatenating only w:t would silently drop the tab. w:delText is the spelling a run takes inside a tracked deletion or move-from, and is read identically: a deletion's text is the whole point of carrying the deletion at all. w:tab becomes a literal '\t', w:br/w:cr a literal '\n' — every w:br type, including an explicit page break, still contributes that same literal '\n' to this run's own text (a mid-run page break's real, structural handling — splitting the paragraph in two — is findRunPageBreakOffset below plus splitParagraphAtPageBreak's own post-processing pass, not this function; readRunText stays the single "flatten this run to plain text" primitive every caller, including that split, shares).
export function readRunText(run: XmlElement): string {
  let text = "";
  for (const child of run.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "w:t" || child.tag === "w:delText") {
      text += textContent(child);
    } else if (child.tag === "w:tab") {
      text += "\t";
    } else if (child.tag === "w:br" || child.tag === "w:cr") {
      text += "\n";
    }
  }
  return text;
}

// The character offset within readRunText(run)'s own return value that the run's FIRST page-type w:br (@w:type="page") falls at, or undefined when the run carries none. A run's w:br/w:cr children all become a literal '\n' in readRunText, indistinguishable from each other by text alone — this walks the identical children in the identical order, but stops accumulating the moment it meets a page-type break, so the caller learns exactly where in the flattened text that specific break sits without readRunText itself needing to know or care about break kinds.
export function findRunPageBreakOffset(run: XmlElement): number | undefined {
  let offset = 0;
  for (const child of run.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "w:t" || child.tag === "w:delText") {
      offset += textContent(child).length;
    } else if (child.tag === "w:tab") {
      offset += 1;
    } else if (child.tag === "w:br") {
      if (attr(child, "w:type") === "page") {
        return offset;
      }
      offset += 1;
    } else if (child.tag === "w:cr") {
      offset += 1;
    }
  }
  return undefined;
}

// document-schema.js's ContentFloatOrigin/ContentFloatAlign enums were deliberately spelled to match ECMA-376's own ST_RelFromH/ST_RelFromV/ST_AlignH/ST_AlignV tokens verbatim (Part 1, 20.4.2.7-20.4.2.10) — every value docx's wp:positionH/wp:positionV can carry is already a literal member of the shared enum under the identical name, so reading one is a narrowing membership check, never a translation table. Guards, not casts, matching this reader's own established convention (isVerticalAlign in typed/shared/table.ts is the identical pattern one package over).
export const FLOAT_ORIGIN_VALUES: ReadonlySet<string> = new Set(
  ContentFloatOriginSchema.options,
);
export function isContentFloatOrigin(
  value: string,
): value is ContentFloatOrigin {
  return FLOAT_ORIGIN_VALUES.has(value);
}
export const FLOAT_ALIGN_VALUES: ReadonlySet<string> = new Set(
  ContentFloatAlignSchema.options,
);
export function isContentFloatAlign(value: string): value is ContentFloatAlign {
  return FLOAT_ALIGN_VALUES.has(value);
}

// One axis of wp:anchor's own wp:positionH/wp:positionV: relativeFrom is required by the ECMA-376 schema on both, and the element's content is a CHOICE of exactly one child, wp:posOffset (a signed EMU integer, converted to pt here) or wp:align (a keyword) — never both, never neither, matching ContentFloatAxisSchema's own XOR shape exactly. Returns undefined for anything the choice-of-one contract doesn't hold (a missing/unrecognised relativeFrom, neither child present, a malformed posOffset, an unrecognised align keyword) — the caller drops the whole floatPosition rather than emit one axis without the other, since a position with only one axis resolved is not a real position.
export function readFloatAxis(
  positionElement: XmlElement,
): ContentFloatAxis | undefined {
  const relativeFromRaw = attr(positionElement, "relativeFrom");
  if (relativeFromRaw === undefined || !isContentFloatOrigin(relativeFromRaw)) {
    return undefined;
  }
  const posOffset = childrenWithTag(positionElement, "wp:posOffset")[0];
  if (posOffset !== undefined) {
    const offsetEmu = Number(textContent(posOffset));
    if (!Number.isFinite(offsetEmu)) {
      return undefined;
    }
    return { relativeTo: relativeFromRaw, offsetPt: emuToPt(offsetEmu) };
  }
  const align = childrenWithTag(positionElement, "wp:align")[0];
  const alignValue = align === undefined ? undefined : textContent(align);
  if (alignValue !== undefined && isContentFloatAlign(alignValue)) {
    return { relativeTo: relativeFromRaw, align: alignValue };
  }
  return undefined;
}

// wp:anchor's own wp:positionH/wp:positionV, read into document-schema.js's format-agnostic ContentFloatPosition — undefined for a wp:inline container (which carries neither element at all, an inline image having no anchored position by definition), for a wp:anchor whose position elements are missing entirely, or for one where either axis fails to resolve (see readFloatAxis above) — a position with only one axis honestly resolved is not emitted as a partial one.
export function readFloatPosition(
  container: XmlElement,
): ContentFloatPosition | undefined {
  const positionH = childrenWithTag(container, "wp:positionH")[0];
  const positionV = childrenWithTag(container, "wp:positionV")[0];
  if (positionH === undefined || positionV === undefined) {
    return undefined;
  }
  const horizontal = readFloatAxis(positionH);
  const vertical = readFloatAxis(positionV);
  if (horizontal === undefined || vertical === undefined) {
    return undefined;
  }
  return { horizontal, vertical };
}

// A w:drawing wraps exactly one wp:inline (in-flow) or wp:anchor (floating/wrapped) container, both of which share the same wp:extent (EMU size) and wp:docPr (name/alt-text) children, and both of which reach the actual picture through an identical a:graphic/a:graphicData/pic:pic/pic:blipFill/a:blip chain — so both placements resolve through one function. wp:anchor's own wp:positionH/wp:positionV (page/margin/paragraph-relative offset) is read into ContentImageBlock.floatPosition (document-schema.js, ExaDev/documents.js#1087) via readFloatPosition above; a wp:inline container never carries either element, so floatPosition is simply absent for an inline image, placed in the block flow at the point its own w:drawing was encountered, exactly as it always was.
export function readDrawingImage(
  drawing: XmlElement,
  ctx: DocxReadContext,
): ContentImageBlock | undefined {
  const container =
    childrenWithTag(drawing, "wp:inline")[0] ??
    childrenWithTag(drawing, "wp:anchor")[0];
  if (container === undefined) {
    return undefined;
  }
  const extent = childrenWithTag(container, "wp:extent")[0];
  const cx = extent === undefined ? undefined : attr(extent, "cx");
  const cy = extent === undefined ? undefined : attr(extent, "cy");
  const widthPt = emuToPt(Number(cx));
  const heightPt = emuToPt(Number(cy));
  // Malformed geometry (a non-numeric or absent EMU value — Number(undefined) is NaN, so a missing attribute or a missing wp:extent both land here) degrades to no image, the same tier readObjectEmbeddedObject applies below and every other numeric attribute reader here degrades on: a NaN widthPt would emit a block no geometry schema accepts, poisoning the whole section for downstream validators.
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt)) {
    return undefined;
  }
  const docPr = childrenWithTag(container, "wp:docPr")[0];
  const altText =
    docPr === undefined
      ? undefined
      : (attr(docPr, "descr") ?? attr(docPr, "title"));
  const blip = elementsWithTag(container.children, "a:blip")[0];
  const rId = blip === undefined ? undefined : attr(blip, "r:embed");
  const rel = rId === undefined ? undefined : ctx.rels.get(rId);
  const mediaPart = rel === undefined ? undefined : ctx.pkg.parts[rel.target];
  if (mediaPart?.kind !== "binary") {
    return undefined;
  }
  const bytes = base64ToBytes(mediaPart.base64);
  const format = sniffImageFormat(bytes);
  if (format === undefined) {
    return undefined;
  }
  const image: ContentImageBlock = {
    kind: "image",
    format,
    base64: mediaPart.base64,
    widthPt,
    heightPt,
  };
  if (altText !== undefined) {
    image.altText = decodeEntities(altText);
  }
  if (container.tag === "wp:anchor") {
    const floatPosition = readFloatPosition(container);
    if (floatPosition !== undefined) {
      image.floatPosition = floatPosition;
    }
  }
  return image;
}

// Resolves a w:object's OLE payload (o:OLEObject/@r:id -> document relationship -> embeddings part) through readEmbeddedPayloadPart: a ZIP payload (a modern producer's embedded xlsx/docx/pptx) and a classic compound-file .bin payload whose Package stream carries a ZIP both become the recovered sub-document's ContentEmbeddedObjectBlock, sized from w:object's own w:dxaOrig/w:dyaOrig (twips), while a compound file holding native legacy streams (no Package stream, or a packaged file that is not a ZIP) and a ZIP that does not decode as one of the three OOXML flavours both return undefined and are skipped, exactly as unhandled markup is — second-order content degrades, it never fails the host read. Undefined follows the same convention as readDrawingImage: an id, relationship, or part that does not line up (including an externally-linked object, whose relationship target is a URI no part key matches) leaves the paragraph with no embedded block, never a partial one. The frame sits at the origin because an inline flow object has no absolute position to record — ContentEmbeddedObjectBlock's frame is required, and 0/0 is the honest spelling of "positioned by the flow", the same narrowing readDrawingImage makes for wp:anchor.
export function readObjectEmbeddedObject(
  object: XmlElement,
  ctx: DocxReadContext,
): ContentEmbeddedObjectBlock | undefined {
  const dxaOrig = attr(object, "w:dxaOrig");
  const dyaOrig = attr(object, "w:dyaOrig");
  const widthPt = twipsToPt(Number(dxaOrig));
  const heightPt = twipsToPt(Number(dyaOrig));
  // Malformed geometry (a non-numeric or absent ST_TwipsMeasure — Number(undefined) is NaN, so a missing attribute lands here too) degrades to no block, the same tier readDrawingImage above applies and readOutlineLevel's malformed @lvl is the family's own example of: a NaN widthPt would emit a block no geometry schema accepts, poisoning the whole section for downstream validators. Checked before any relationship resolution, so a doomed object never decodes its payload.
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt)) {
    return undefined;
  }
  const oleObject = elementsWithTag([object], "o:OLEObject")[0];
  const rId = oleObject === undefined ? undefined : attr(oleObject, "r:id");
  const rel = rId === undefined ? undefined : ctx.rels.get(rId);
  const payloadPart = rel === undefined ? undefined : ctx.pkg.parts[rel.target];
  if (payloadPart?.kind !== "binary") {
    return undefined;
  }
  const payload = readEmbeddedPayloadPart(payloadPart);
  return payload === undefined
    ? undefined
    : {
        kind: "embeddedObject",
        objectKind: payload.objectKind,
        document: payload.document,
        frame: { xPt: 0, yPt: 0, widthPt, heightPt },
      };
}

// One lifted element's identity in collection order: the w:drawing/w:object itself, plus — for a drawing nested inside a w:object (a modern producer's mc:AlternateContent preview spelling) — the object whose run position is the only position the reader can honestly anchor the preview to.
export interface LiftedElement {
  readonly element: XmlElement;
  readonly owner: XmlElement | undefined;
}

// Collects every w:drawing and w:object found anywhere inside a paragraph's own content (nested inside w:r, w:hyperlink, w:ins, w:fldSimple), in document order. Deleted subtrees (w:del, w:moveFrom) are excluded unless the caller is carrying deletions — mirroring readParagraphRuns' own tracked-changes handling, since a deleted drawing's own w:r sits inside w:del alongside w:delText runs, and a drawing lifted out of a deletion the reader is not carrying would appear as live content. A w:object is pushed at its own position and then recursed into (with itself as the nesting owner), so a w:drawing nested inside it is still collected as an image in its own right, exactly as it was before embedded-object recovery existed.
// The lifted-element accumulator collectLiftedElements appends each w:drawing/w:object onto as it walks a run's children. Wrapped rather than passed as a bare array so the parameter stays out of prefer-readonly-array-param's scope while the array it holds stays genuinely mutable.
export interface LiftedElementSink {
  readonly elements: LiftedElement[];
}

export function collectLiftedElements(
  nodes: readonly XmlNode[],
  carryDeletions: boolean,
  owner: XmlElement | undefined,
  sink: LiftedElementSink,
): void {
  const out = sink.elements;
  for (const node of nodes) {
    if (node.type !== "element") {
      continue;
    }
    if (
      !carryDeletions &&
      (node.tag === "w:del" || node.tag === "w:moveFrom")
    ) {
      continue;
    }
    if (node.tag === "w:drawing" || node.tag === "w:object") {
      out.push({ element: node, owner });
      if (node.tag === "w:drawing") {
        continue;
      }
      collectLiftedElements(node.children, carryDeletions, node, sink);
      continue;
    }
    collectLiftedElements(node.children, carryDeletions, owner, sink);
  }
}

// The position a run walk recorded for one w:drawing/w:object that sat as a direct child of an emitted run: the index that run occupies in the paragraph's own runs array, and the length of the run text preceding the element inside that same run (readRunText's own accounting — w:t/w:delText length, w:tab/w:br/w:cr one character each).
export interface LiftedPosition {
  readonly runIndex: number;
  readonly offset: number;
}

// Records every w:drawing/w:object direct child of one emitted run, at the text position each sat at: the walk has just pushed the run at `runIndex`, so the element's own paragraph-level position is (runIndex, characters of run text before it). Elements not direct children of a run (nested inside a w:object, or inside run children the walk never reaches) get no entry here — readParagraphLiftedBlocks then leaves their anchor unset, the schema's own "absent when the lifting reader does not know the position" spelling.
export function recordLiftedPositions(
  run: XmlElement,
  runIndex: number,
  out: Map<XmlElement, LiftedPosition>,
): void {
  let offset = 0;
  for (const child of run.children) {
    if (child.type !== "element") {
      continue;
    }
    if (child.tag === "w:drawing" || child.tag === "w:object") {
      out.set(child, { runIndex, offset });
      continue;
    }
    if (child.tag === "w:t" || child.tag === "w:delText") {
      offset += textContent(child).length;
    } else if (
      child.tag === "w:tab" ||
      child.tag === "w:br" ||
      child.tag === "w:cr"
    ) {
      offset += 1;
    }
  }
}

// ContentRun has no field to carry an inline image or embedded object (unlike ContentShape's blocks list in pptx) — media found inside a paragraph's own runs is therefore surfaced as its own sibling block (ContentImageBlock or ContentEmbeddedObjectBlock), appended immediately after that paragraph's block in the order the markup introduced them, rather than nested inside it. This preserves block-level document order (each lifted block still appears right after the paragraph that contained it, and drawings and objects keep their relative order), and each lifted ContentImageBlock now records where it sat: anchorRunIndex/anchorOffset name the run whose text the image originally followed and the character position within that run after which it sat, so the inline position is recoverable rather than structural. `positions` is the run walk's recorded map; an empty map leaves every anchor unset (the mid-run page-break split's spelling — see readParagraphBlocks).
export function readParagraphLiftedBlocks(
  paragraph: XmlElement,
  ctx: DocxReadContext,
  carryDeletions: boolean,
  runs: readonly ContentRun[],
  positions: ReadonlyMap<XmlElement, LiftedPosition>,
): ContentBlock[] {
  const lifted: LiftedElement[] = [];
  collectLiftedElements(paragraph.children, carryDeletions, undefined, {
    elements: lifted,
  });
  const blocks: ContentBlock[] = [];
  for (const entry of lifted) {
    const block =
      entry.element.tag === "w:object"
        ? readObjectEmbeddedObject(entry.element, ctx)
        : readDrawingImage(entry.element, ctx);
    if (block !== undefined) {
      if (block.kind === "image") {
        const position = positions.get(entry.owner ?? entry.element);
        if (position !== undefined) {
          if (position.offset > 0) {
            block.anchorRunIndex = position.runIndex;
            block.anchorOffset = position.offset;
          } else if (position.runIndex > 0) {
            // The image sat at the head of its own run, so the run whose text it followed is the previous one, at that run's full length — the schema's "between two runs" spelling. The paragraph's very first position keys (0, 0).
            const previous = runs[position.runIndex - 1];
            block.anchorRunIndex = position.runIndex - 1;
            block.anchorOffset =
              previous === undefined ? 0 : previous.text.length;
          } else {
            block.anchorRunIndex = 0;
            block.anchorOffset = 0;
          }
        }
      }
      blocks.push(block);
    }
  }
  return blocks;
}

export function readRun(
  run: XmlElement,
  paragraph: XmlElement,
  context: DocxStyleContext,
): ContentRun {
  const props = resolveRunProperties(run, paragraph, context);
  return {
    text: readRunText(run),
    bold: props.bold,
    italic: props.italic,
    underline: props.underline,
    strike: props.strike,
    fontFamily: props.fontFamily,
    sizePt: props.sizePt,
    color: props.color,
    // "baseline" is the cascade's own explicit-override spelling, not a position ContentRun states: the schema models baseline as verticalAlign's absence, so the resolved layer value disappears here exactly as the resolved formatting it overrode did.
    verticalAlign:
      props.verticalAlign === "baseline" ? undefined : props.verticalAlign,
    direction: props.rtl === undefined ? undefined : props.rtl ? "rtl" : "ltr",
  };
}

// One complex field opened by a w:fldChar begin inside THIS paragraph's run walk and closed by an end the same walk reaches — the mid-paragraph field shape. `beginElement`/`endElement` are kept so the extent assembly can ask the paragraph's content index whether the pair sits at block scope (the whole-paragraph shape the marker path already encodes, which must never gain a second encoding here). `formControl` holds the legacy w:ffData verdict when the begin run carries one — a form field is a contentControl, not a field.
export interface RunFieldEvent {
  readonly descriptor: ConstructDescriptor;
  readonly startRun: number;
  readonly endRun: number;
  readonly beginElement: XmlElement;
  readonly endElement: XmlElement;
}

// A w:fldSimple encountered mid-walk: the same shape as RunFieldEvent with one element playing both boundary roles.
export interface RunSimpleFieldEvent {
  readonly descriptor: ConstructDescriptor;
  readonly startRun: number;
  readonly endRun: number;
  readonly element: XmlElement;
}

// A point anchor at one run boundary — a footnote, endnote, or comment reference mark, whose body lives in a definitions part (word/footnotes.xml, word/endnotes.xml, word/comments.xml) the flat model carries beside its sections.
export interface RunPointAnchorEvent {
  readonly descriptor: AnchorDescriptor;
  readonly runPosition: number;
}

// A link over a sub-sequence of this paragraph's runs whose target is a name inside this document (w:hyperlink/@w:anchor), which a flat run field cannot express.
export interface RunLinkEvent {
  readonly anchor: string;
  readonly startRun: number;
  readonly endRun: number;
}

// Everything one paragraph's run walk collects beside its runs, assembled into ContentParagraph.constructs by assembleRunConstructs once the walk (and the paragraph's content index) exists.
// The paragraph's own FIRST mid-run page-type break, if it has one: which run (by the index it will occupy in the walk's own `runs` array) and which character offset within that run's own text (findRunPageBreakOffset's return value). Only ever the first — a second page-type break within the same paragraph is real but rare enough to defer, the same "real but rare-enough" framing readRunText's own top comment already gives every w:br kind, so it is left as an ordinary '\n' inside whichever half it lands in rather than triggering a further split.
export interface ParagraphPageBreakEvent {
  readonly runIndex: number;
  readonly charIndex: number;
}

export interface ParagraphRunEvents {
  halves: ParagraphRangeMarkerHalf[];
  fields: RunFieldEvent[];
  simpleFields: RunSimpleFieldEvent[];
  pointAnchors: RunPointAnchorEvent[];
  links: RunLinkEvent[];
  pageBreak: ParagraphPageBreakEvent | undefined;
  // Every w:drawing/w:object direct child of an emitted run, at the (run index, preceding-text length) position it sat at — the map readParagraphLiftedBlocks resolves lifted images' anchors through, the run-level counterpart of the pageBreak event's own run/char indices.
  liftedPositions: Map<XmlElement, LiftedPosition>;
}

export function newParagraphRunEvents(): ParagraphRunEvents {
  return {
    halves: [],
    fields: [],
    simpleFields: [],
    pointAnchors: [],
    links: [],
    pageBreak: undefined,
    liftedPositions: new Map(),
  };
}

// Walks a paragraph's own children producing its runs, tracking two things across siblings: complex-field state (w:fldChar begin/separate/end — only the cached result between separate and end is visible content) and the enclosing hyperlink target (w:hyperlink, resolved via the document's relationships), threaded through w:ins/w:moveTo/w:sdt/w:fldSimple recursion. w:del and w:moveFrom are recursed into only when the caller is carrying deletions — i.e. when the whole paragraph is itself a tracked deletion or move-from, so that every run it yields is labelled as deleted by the enclosing provenance construct. A mid-paragraph deletion stays excluded, because lifting those runs into the paragraph's own text would render deleted words as live text, which is strictly worse than the existing omission. Range-marker halves (bookmarks, comment extents) are recorded into `events.halves` at the run position the walk had reached — the run-level counterpart of the block-index events recordParagraphRangeMarkers collects, paired into run-level construct extents by runRangeMarkerExtents (typed/docx/constructs.ts). A complex field or w:fldSimple whose extent is a sub-sequence of this paragraph's runs, an internal @w:anchor hyperlink, and a footnote/endnote/comment reference run each record their own event for the same assembly.
export function readParagraphRuns(
  paragraph: XmlElement,
  ctx: DocxReadContext,
  carryDeletions: boolean,
  events: ParagraphRunEvents,
): ContentRun[] {
  const runs: ContentRun[] = [];
  let fieldState: "none" | "code" | "result" = "none";
  const openFields: {
    startRun: number;
    instruction: string;
    beginElement: XmlElement;
    formControl: ContentControlDescriptor | undefined;
  }[] = [];

  // `name` is passed in rather than read here because only a bookmark's start half carries one: every other call site passes undefined, so the "which halves have a name" knowledge stays at the call sites instead of as a condition the body re-derives.
  const recordRangeMarkerHalf = (
    node: XmlElement,
    family: RangeMarkerFamily,
    start: boolean,
    name: string | undefined,
  ): void => {
    const id = attr(node, "w:id");
    if (id === undefined) {
      return;
    }
    events.halves.push({
      element: node,
      family,
      id,
      name,
      kind: start ? "start" : "end",
      runPosition: runs.length,
    });
  };

  // A reference-mark run (footnote/endnote/comment) renders nothing itself, so the point anchor sits at the boundary before that run — exactly where the mark renders.
  const recordReferenceAnchor = (run: XmlElement): void => {
    for (const child of run.children) {
      if (child.type !== "element") {
        continue;
      }
      if (
        child.tag !== "w:footnoteReference" &&
        child.tag !== "w:endnoteReference" &&
        child.tag !== "w:commentReference"
      ) {
        continue;
      }
      const anchorType: "footnote" | "endnote" | "comment" =
        child.tag === "w:footnoteReference"
          ? "footnote"
          : child.tag === "w:endnoteReference"
            ? "endnote"
            : "comment";
      const id = attr(child, "w:id");
      if (id !== undefined) {
        events.pointAnchors.push({
          descriptor: { kind: "anchor", anchorType, name: id },
          runPosition: runs.length - 1,
        });
      }
    }
  };

  function walk(
    nodes: readonly XmlNode[],
    hyperlinkTarget: string | undefined,
  ): void {
    for (const node of nodes) {
      if (node.type !== "element") {
        continue;
      }
      if (node.tag === "w:r") {
        const type = fieldCharType(node);
        if (type !== undefined) {
          if (type === "begin") {
            fieldState = "code";
            openFields.push({
              startRun: runs.length,
              instruction: "",
              beginElement: node,
              formControl: readFormControlDescriptor(node),
            });
          } else if (type === "separate") {
            fieldState = "result";
          } else {
            // fieldCharType returns exactly begin/separate/end/undefined, and undefined returned early above, so this else IS the end case.
            fieldState = "none";
            const open = openFields.pop();
            if (open !== undefined) {
              events.fields.push({
                descriptor: open.formControl ?? {
                  kind: "field",
                  instruction: open.instruction,
                },
                startRun: open.startRun,
                endRun: runs.length,
                beginElement: open.beginElement,
                endElement: node,
              });
            }
          }
          continue;
        }
        if (fieldState === "code") {
          // The code runs belong to the field the walk is inside — the innermost begin still open, exactly the field whose instruction this run spells.
          const open = openFields[openFields.length - 1];
          if (open !== undefined) {
            open.instruction += runInstructionText(node);
          }
          continue;
        }
        if (events.pageBreak === undefined) {
          const charIndex = findRunPageBreakOffset(node);
          if (charIndex !== undefined) {
            events.pageBreak = { runIndex: runs.length, charIndex };
          }
        }
        const run = readRun(node, paragraph, ctx.styles);
        runs.push(
          hyperlinkTarget === undefined
            ? run
            : { ...run, hyperlink: hyperlinkTarget },
        );
        recordLiftedPositions(node, runs.length - 1, events.liftedPositions);
        recordReferenceAnchor(node);
      } else if (node.tag === "w:fldSimple") {
        const startRun = runs.length;
        walk(node.children, hyperlinkTarget);
        events.simpleFields.push({
          descriptor: {
            kind: "field",
            instruction: decodeEntities(attr(node, "w:instr") ?? ""),
          },
          startRun,
          endRun: runs.length,
          element: node,
        });
      } else if (node.tag === "w:hyperlink") {
        const rId = attr(node, "r:id");
        const target =
          rId === undefined ? undefined : ctx.rels.get(rId)?.target;
        if (target === undefined) {
          // No resolvable external target: an @w:anchor names a target inside this document, which is a link run extent rather than a run field. An r:id that resolves wins over an @w:anchor spelled beside it — one link, one encoding, the resolved external target's.
          const anchor = attr(node, "w:anchor");
          const startRun = runs.length;
          walk(node.children, hyperlinkTarget);
          if (anchor !== undefined && runs.length > startRun) {
            events.links.push({
              anchor: decodeEntities(anchor),
              startRun,
              endRun: runs.length,
            });
          }
          continue;
        }
        walk(node.children, target);
      } else if (node.tag === "w:ins" || node.tag === "w:moveTo") {
        walk(node.children, hyperlinkTarget);
      } else if (node.tag === "w:del" || node.tag === "w:moveFrom") {
        if (carryDeletions) {
          walk(node.children, hyperlinkTarget);
        }
      } else if (node.tag === "w:sdt") {
        // An inline (run-level) structured document tag: its own descriptor has no encoding here, since a construct marker brackets whole blocks and this one wraps a sub-sequence of runs — but its content is ordinary text, so it is read as runs rather than dropped along with the descriptor.
        const sdtContent = childrenWithTag(node, "w:sdtContent")[0];
        if (sdtContent !== undefined) {
          walk(sdtContent.children, hyperlinkTarget);
        }
      } else if (node.tag === "w:bookmarkStart") {
        const name = attr(node, "w:name");
        recordRangeMarkerHalf(
          node,
          "bookmark",
          true,
          name === undefined ? undefined : decodeEntities(name),
        );
      } else if (node.tag === "w:bookmarkEnd") {
        recordRangeMarkerHalf(node, "bookmark", false, undefined);
      } else if (
        node.tag === "w:commentRangeStart" ||
        node.tag === "w:commentRangeEnd"
      ) {
        recordRangeMarkerHalf(
          node,
          "comment",
          node.tag === "w:commentRangeStart",
          undefined,
        );
      }
    }
  }

  walk(paragraph.children, undefined);
  return runs;
}
