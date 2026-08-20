import { z } from 'zod';
import type { Package } from '../../model/package';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Alignment, Box, ContentBlock, ContentEmbeddedObjectBlock, ContentImageBlock, ContentParagraph, ContentRun, ContentShape, ContentSlide, ContentTable, ContentTableCell, PageSize } from 'document-schema.js';
import { ContentSlideSchema, SLIDE_SIZE_WIDESCREEN } from 'document-schema.js';
import { drawingMlFontSizeToPt, emuToPt } from '../shared/units';
import { sniffImageFormat } from '../../image/sniff';
import { readEmbeddedPayloadPart } from '../embedded';
import type { GroupChildTransform } from '../shared/drawingml';
import { applyGroupTransform, composeGroupTransform, composeShapeRotationDeg, readGroupXfrm, readSolidFillColor, readXfrm } from '../shared/drawingml';
import { DocumentMetadataSchema, readCoreProperties } from '../shared/metadata';
import { assignSourcePaths } from '../shared/source-path';
import type { Relationship } from '../util';
import { attr, childrenWithTag, elementsWithTag, resolveRelationships, rootElement, textContent } from '../util';
import { base64ToBytes } from '../../util/base64';
import type { DefaultRunProperties, SlideInheritanceContext } from './inherit';
import { readPlaceholderKey, readRunPropertiesFromElement, resolveDefaultRunProperties, resolvePlaceholderXfrm, resolveSlideInheritance } from './inherit';
import { readChartTable } from './chart';
import { readDiagramText } from './diagram';

// Package -> PptxDocument. Walks PresentationML directly: document order, placeholder inheritance, and theme resolution all matter for conversion fidelity in a way a flat text/shape-list projection doesn't preserve. Ported from documents.js's src/ooxml/pptx/read.ts.
//
// This is the flat, content-level half of the pptx read pair: readPptx (typed/document-package.ts) wraps it into a tree-form DocumentPackage, which is the primary name. Both are read-only -- this package has no PresentationML writer, so neither has an inverse.

export const PptxDocumentSchema = z.object({
  metadata: DocumentMetadataSchema,
  slides: z.array(ContentSlideSchema),
});
export type PptxDocument = z.infer<typeof PptxDocumentSchema>;

const PRESENTATION_PATH = 'ppt/presentation.xml';
const TABLE_GRAPHIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table';
const CHART_GRAPHIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const DIAGRAM_GRAPHIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram';
const OLE_GRAPHIC_URI = 'http://schemas.openxmlformats.org/presentationml/2006/ole';

function readSlideSize(presentationRoot: XmlElement | undefined): PageSize {
  const sldSz = presentationRoot === undefined ? undefined : childrenWithTag(presentationRoot, 'p:sldSz')[0];
  const cx = sldSz === undefined ? undefined : attr(sldSz, 'cx');
  const cy = sldSz === undefined ? undefined : attr(sldSz, 'cy');
  return cx === undefined || cy === undefined ? SLIDE_SIZE_WIDESCREEN : { widthPt: emuToPt(Number(cx)), heightPt: emuToPt(Number(cy)) };
}

// Slide order comes from p:presentation/p:sldIdLst, resolved through the presentation's own relationships -- never from slide part filenames, which carry no ordering guarantee.
function readSlidePathsInOrder(pkg: Package, presentationRoot: XmlElement | undefined): string[] {
  if (presentationRoot === undefined) {
    return [];
  }
  const sldIdLst = childrenWithTag(presentationRoot, 'p:sldIdLst')[0];
  if (sldIdLst === undefined) {
    return [];
  }
  const presentationRels = resolveRelationships(pkg, PRESENTATION_PATH);
  const paths: string[] = [];
  for (const sldId of childrenWithTag(sldIdLst, 'p:sldId')) {
    const rId = attr(sldId, 'r:id');
    const rel = rId === undefined ? undefined : presentationRels.get(rId);
    if (rel !== undefined) {
      paths.push(rel.target);
    }
  }
  return paths;
}

function shapeName(shape: XmlElement): string | undefined {
  const cNvPr = elementsWithTag([shape], 'p:cNvPr')[0];
  return cNvPr === undefined ? undefined : attr(cNvPr, 'name');
}

function mergeRunProperties(base: DefaultRunProperties, override: DefaultRunProperties): DefaultRunProperties {
  return {
    fontFamily: override.fontFamily ?? base.fontFamily,
    sizePt: override.sizePt ?? base.sizePt,
    bold: override.bold ?? base.bold,
    italic: override.italic ?? base.italic,
    color: override.color ?? base.color,
  };
}

function isUnderlined(rPr: XmlElement | undefined): boolean | undefined {
  if (rPr === undefined) {
    return undefined;
  }
  const u = attr(rPr, 'u');
  return u === undefined ? undefined : u !== 'none';
}

function isStrikethrough(rPr: XmlElement | undefined): boolean | undefined {
  if (rPr === undefined) {
    return undefined;
  }
  const strike = attr(rPr, 'strike');
  return strike === undefined ? undefined : strike !== 'noStrike';
}

// a:hlinkClick/@r:id resolves through the SLIDE's own relationships (not the layout/master's) -- only external targets (TargetMode="External") have a meaningful URI; an internal slide-jump link has no useful string representation for ContentRun.hyperlink and is left unset.
function readHyperlink(rPr: XmlElement | undefined, slideRels: ReadonlyMap<string, Relationship>): string | undefined {
  if (rPr === undefined) {
    return undefined;
  }
  const hlink = childrenWithTag(rPr, 'a:hlinkClick')[0];
  const rId = hlink === undefined ? undefined : attr(hlink, 'r:id');
  const rel = rId === undefined ? undefined : slideRels.get(rId);
  return rel?.targetMode === 'External' ? rel.target : undefined;
}

// Reads a single run's text/formatting, given the cascade base already resolved for its paragraph (master txStyles default, overridden by the paragraph's own a:pPr/a:defRPr if present). Shared by a:r and a:fld (a cached dynamic field, e.g. slide number/date) -- both carry the identical a:rPr + a:t shape.
function readRun(runEl: XmlElement, cascadeBase: DefaultRunProperties, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>): ContentRun {
  const rPr = childrenWithTag(runEl, 'a:rPr')[0];
  const explicit = rPr === undefined ? {} : readRunPropertiesFromElement(rPr, context);
  const merged = mergeRunProperties(cascadeBase, explicit);
  const tEl = childrenWithTag(runEl, 'a:t')[0];
  return {
    text: tEl === undefined ? '' : textContent(tEl),
    bold: merged.bold,
    italic: merged.italic,
    underline: isUnderlined(rPr),
    strike: isStrikethrough(rPr),
    fontFamily: merged.fontFamily,
    sizePt: merged.sizePt,
    color: merged.color,
    hyperlink: readHyperlink(rPr, slideRels),
  };
}

function readAlignment(algn: string | undefined): Alignment | undefined {
  if (algn === 'l') {
    return 'left';
  }
  if (algn === 'ctr') {
    return 'center';
  }
  if (algn === 'r') {
    return 'right';
  }
  if (algn === 'just' || algn === 'justLow') {
    return 'justify';
  }
  return undefined;
}

// a:spcBef/a:spcAft wrap either an absolute a:spcPts (hundredths of a point, the same scale as run font size) or a relative a:spcPct (percentage of line height). Only the absolute form is read -- resolving a percentage needs the paragraph's own effective font size, which complicates this reader for a case real-world content uses far less often than the absolute form.
function readAbsoluteSpacingPt(spc: XmlElement | undefined): number | undefined {
  if (spc === undefined) {
    return undefined;
  }
  const pts = childrenWithTag(spc, 'a:spcPts')[0];
  const val = pts === undefined ? undefined : attr(pts, 'val');
  return val === undefined ? undefined : drawingMlFontSizeToPt(Number(val));
}

// a:lnSpc's overwhelmingly common form in real content is a:spcPct (a percentage multiplier of single line spacing); the absolute a:spcPts form is not modelled as a multiplier here.
function readLineSpacingMultiplier(pPr: XmlElement | undefined): number | undefined {
  const lnSpc = pPr === undefined ? undefined : childrenWithTag(pPr, 'a:lnSpc')[0];
  const pct = lnSpc === undefined ? undefined : childrenWithTag(lnSpc, 'a:spcPct')[0];
  const val = pct === undefined ? undefined : attr(pct, 'val');
  return val === undefined ? undefined : Number(val) / 100_000;
}

// a:pPr/@lvl (ST_TextIndentLevelType, 0-8) parsed once for both of its consumers: the a:lvl1pPr..a:lvl9pPr style lookup in resolveDefaultRunProperties, and ContentParagraph.list below. Malformed spellings (non-numeric, fractional, negative) degrade to undefined the way this repo's other numeric attribute readers do (parseChildIndex in xlsx/styles.ts), never to a fabricated or schema-invalid level.
function readOutlineLevel(pPr: XmlElement | undefined): number | undefined {
  const raw = pPr === undefined ? undefined : attr(pPr, 'lvl');
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const level = Number(raw);
  return Number.isInteger(level) && level >= 0 ? level : undefined;
}

function readParagraph(pEl: XmlElement, placeholderType: string | undefined, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>): ContentParagraph {
  const pPr = childrenWithTag(pEl, 'a:pPr')[0];
  const outlineLevel = readOutlineLevel(pPr);
  const level = outlineLevel ?? 0;
  const masterDefaults = resolveDefaultRunProperties(placeholderType, level, context);
  const pPrDefRPr = pPr === undefined ? undefined : childrenWithTag(pPr, 'a:defRPr')[0];
  const paragraphDefaults = pPrDefRPr === undefined ? masterDefaults : mergeRunProperties(masterDefaults, readRunPropertiesFromElement(pPrDefRPr, context));

  const runs: ContentRun[] = [];
  for (const child of pEl.children) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.tag === 'a:r' || child.tag === 'a:fld') {
      runs.push(readRun(child, paragraphDefaults, context, slideRels));
    } else if (child.tag === 'a:br') {
      // A forced line break within the paragraph, modelled as a run containing a literal newline.
      runs.push({ text: '\n' });
    }
  }

  const marL = pPr === undefined ? undefined : attr(pPr, 'marL');
  const indent = pPr === undefined ? undefined : attr(pPr, 'indent');

  return {
    kind: 'paragraph',
    runs,
    alignment: pPr === undefined ? undefined : readAlignment(attr(pPr, 'algn')),
    // DrawingML paragraphs carry only an outline depth, never a numbering identity (no numPr exists in a:pPr), so list is emitted with level alone -- numId optional since document-schema.js 3.3.0 -- and a fabricated numId would be a lie in the data. An absent (or malformed) @lvl emits no list rather than a redundant { level: 0 }: absent means the body placeholder's default level 0, and outline consumers already treat a missing list as level 0, so the zero would carry no information.
    list: outlineLevel === undefined ? undefined : { level: outlineLevel },
    spacingBeforePt: readAbsoluteSpacingPt(pPr === undefined ? undefined : childrenWithTag(pPr, 'a:spcBef')[0]),
    spacingAfterPt: readAbsoluteSpacingPt(pPr === undefined ? undefined : childrenWithTag(pPr, 'a:spcAft')[0]),
    lineSpacing: readLineSpacingMultiplier(pPr),
    indentLeftPt: marL === undefined ? undefined : emuToPt(Number(marL)),
    indentFirstLinePt: indent === undefined ? undefined : emuToPt(Number(indent)),
  };
}

function textBodyParagraphs(txBody: XmlElement | undefined, placeholderType: string | undefined, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>): ContentParagraph[] {
  return txBody === undefined ? [] : childrenWithTag(txBody, 'a:p').map((p) => readParagraph(p, placeholderType, context, slideRels));
}

// ECMA-376's own documented defaults for a:bodyPr's inset attributes when unspecified (officeopenxml.com's Body Properties/Positioning and Insets reference, matching CT_TextBodyProperties): left/right 91440 EMU (0.1in), top/bottom 45720 EMU (0.05in).
const DEFAULT_INSET_LEFT_RIGHT_EMU = 91440;
const DEFAULT_INSET_TOP_BOTTOM_EMU = 45720;

interface ShapeTextExtras {
  readonly insetLeftPt: number;
  readonly insetTopPt: number;
  readonly insetRightPt: number;
  readonly insetBottomPt: number;
  readonly fontScale: number | undefined;
  readonly lineSpacingReduction: number | undefined;
}

const NO_TEXT_BODY_EXTRAS: ShapeTextExtras = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0, fontScale: undefined, lineSpacingReduction: undefined };

// Reads a:bodyPr's insets (falling back to ECMA-376's own defaults) and any a:normAutofit-computed shrinkage. A shape with no p:txBody at all (a picture, a table frame) has no text body properties to read -- its insets are genuinely zero, not a missing/defaulted value, since nothing ever positions text against them.
function readShapeTextExtras(txBody: XmlElement | undefined): ShapeTextExtras {
  if (txBody === undefined) {
    return NO_TEXT_BODY_EXTRAS;
  }
  const bodyPr = childrenWithTag(txBody, 'a:bodyPr')[0];
  const lIns = bodyPr === undefined ? undefined : attr(bodyPr, 'lIns');
  const tIns = bodyPr === undefined ? undefined : attr(bodyPr, 'tIns');
  const rIns = bodyPr === undefined ? undefined : attr(bodyPr, 'rIns');
  const bIns = bodyPr === undefined ? undefined : attr(bodyPr, 'bIns');
  const normAutofit = bodyPr === undefined ? undefined : childrenWithTag(bodyPr, 'a:normAutofit')[0];
  const fontScale = normAutofit === undefined ? undefined : attr(normAutofit, 'fontScale');
  const lnSpcReduction = normAutofit === undefined ? undefined : attr(normAutofit, 'lnSpcReduction');
  return {
    insetLeftPt: emuToPt(lIns === undefined ? DEFAULT_INSET_LEFT_RIGHT_EMU : Number(lIns)),
    insetTopPt: emuToPt(tIns === undefined ? DEFAULT_INSET_TOP_BOTTOM_EMU : Number(tIns)),
    insetRightPt: emuToPt(rIns === undefined ? DEFAULT_INSET_LEFT_RIGHT_EMU : Number(rIns)),
    insetBottomPt: emuToPt(bIns === undefined ? DEFAULT_INSET_TOP_BOTTOM_EMU : Number(bIns)),
    fontScale: fontScale === undefined ? undefined : Number(fontScale) / 100_000,
    lineSpacingReduction: lnSpcReduction === undefined ? undefined : Number(lnSpcReduction) / 100_000,
  };
}

// p:spPr (shape properties, holding a:xfrm) is named identically on both p:sp and p:pic -- the only two callers of this function.
function resolveShapeFrame(shape: XmlElement, context: SlideInheritanceContext, parentTransform: GroupChildTransform | undefined): { frame: Box; rotationDeg: number | undefined } | undefined {
  const key = readPlaceholderKey(shape);
  const spPr = childrenWithTag(shape, 'p:spPr')[0];
  const ownXfrm = spPr === undefined ? undefined : readXfrm(childrenWithTag(spPr, 'a:xfrm')[0]);
  const xfrm = ownXfrm ?? (key === undefined ? undefined : resolvePlaceholderXfrm(key, context));
  if (xfrm === undefined) {
    return undefined;
  }
  const localFrame: Box = { xPt: xfrm.xPt, yPt: xfrm.yPt, widthPt: xfrm.widthPt, heightPt: xfrm.heightPt };
  // The shape's own local a:xfrm@rot is composed with every enclosing group's own rotation/flip via composeShapeRotationDeg (src/typed/shared/drawingml.ts), which also documents the ECMA-376 composition rule itself: a group's flip mirrors the shape's position AND negates the sense of its own rotation, since a reflection reverses the handedness that further rotation is measured against.
  const rotationDeg = composeShapeRotationDeg(parentTransform, xfrm.rotationDeg);
  return {
    frame: parentTransform === undefined ? localFrame : applyGroupTransform(parentTransform, localFrame),
    rotationDeg: rotationDeg === 0 ? undefined : rotationDeg,
  };
}

function readSpShape(sp: XmlElement, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>, parentTransform: GroupChildTransform | undefined): ContentShape | undefined {
  const resolved = resolveShapeFrame(sp, context, parentTransform);
  if (resolved === undefined) {
    return undefined;
  }
  const key = readPlaceholderKey(sp);
  const txBody = childrenWithTag(sp, 'p:txBody')[0];
  const blocks = textBodyParagraphs(txBody, key?.type, context, slideRels);
  const extras = readShapeTextExtras(txBody);
  return { name: shapeName(sp), frame: resolved.frame, rotationDeg: resolved.rotationDeg, ...extras, blocks };
}

// Resolves the first a:blip/@r:embed anywhere under parent (a p:pic's own p:blipFill, or an OLE object's fallback p:pic nested inside a:graphicData's mc:AlternateContent) through the slide's relationships to a sniffed ContentImageBlock sized to the given frame -- undefined when the id, relationship, part, or magic bytes don't line up, leaving the shape with no image content.
function readBlipImage(parent: XmlElement, slideRels: ReadonlyMap<string, Relationship>, pkg: Package, frame: Box): ContentImageBlock | undefined {
  const blip = elementsWithTag([parent], 'a:blip')[0];
  const rId = blip === undefined ? undefined : attr(blip, 'r:embed');
  const rel = rId === undefined ? undefined : slideRels.get(rId);
  const mediaPart = rel === undefined ? undefined : pkg.parts[rel.target];
  if (mediaPart?.kind !== 'binary') {
    return undefined;
  }
  const format = sniffImageFormat(base64ToBytes(mediaPart.base64));
  return format === undefined ? undefined : { kind: 'image', format, base64: mediaPart.base64, widthPt: frame.widthPt, heightPt: frame.heightPt };
}

function readPicShape(pic: XmlElement, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>, pkg: Package, parentTransform: GroupChildTransform | undefined): ContentShape | undefined {
  const resolved = resolveShapeFrame(pic, context, parentTransform);
  if (resolved === undefined) {
    return undefined;
  }
  const image = readBlipImage(pic, slideRels, pkg, resolved.frame);
  const blocks: ContentBlock[] = image === undefined ? [] : [image];
  // An unresolvable image (missing relationship/part, or bytes that don't sniff as PNG/JPEG) keeps the shape's geometry with empty content, rather than dropping the shape entirely.
  return { name: shapeName(pic), frame: resolved.frame, rotationDeg: resolved.rotationDeg, ...NO_TEXT_BODY_EXTRAS, blocks };
}

function readTableCell(tc: XmlElement, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>): ContentTableCell {
  const hMerge = attr(tc, 'hMerge');
  const vMerge = attr(tc, 'vMerge');
  if (hMerge === '1' || vMerge === '1') {
    // A merged-away continuation cell -- the anchor cell's own gridSpan/rowSpan already communicates the merge; ContentTableCell has no "covered by a preceding span" concept of its own.
    return { blocks: [] };
  }
  const tcPr = childrenWithTag(tc, 'a:tcPr')[0];
  const solidFill = tcPr === undefined ? undefined : childrenWithTag(tcPr, 'a:solidFill')[0];
  const background = readSolidFillColor(solidFill, context.colorMap, context.theme);
  const txBody = childrenWithTag(tc, 'a:txBody')[0];
  const gridSpan = attr(tc, 'gridSpan');
  const rowSpan = attr(tc, 'rowSpan');
  return {
    blocks: textBodyParagraphs(txBody, undefined, context, slideRels),
    colSpan: gridSpan === undefined ? undefined : Number(gridSpan),
    rowSpan: rowSpan === undefined ? undefined : Number(rowSpan),
    background,
  };
}

function readTable(tbl: XmlElement, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>): ContentTable {
  const tblGrid = childrenWithTag(tbl, 'a:tblGrid')[0];
  const columnWidthsPt = tblGrid === undefined ? [] : childrenWithTag(tblGrid, 'a:gridCol').map((col) => emuToPt(Number(attr(col, 'w') ?? '0')));
  const rows = childrenWithTag(tbl, 'a:tr').map((tr) => {
    const h = attr(tr, 'h');
    return { cells: childrenWithTag(tr, 'a:tc').map((tc) => readTableCell(tc, context, slideRels)), heightPt: h === undefined ? undefined : emuToPt(Number(h)) };
  });
  return { kind: 'table', rows, columnWidthsPt };
}

// Resolves an r:id found inside a graphic frame's a:graphicData child element (a chart reference's part, a diagram's data model, ...) through the slide's own relationships to the target part's root element -- undefined when the id, relationship, part, or XML root is missing anywhere along the chain, leaving the frame's geometry with empty content.
function relatedPartRoot(rId: string | undefined, slideRels: ReadonlyMap<string, Relationship>, pkg: Package): XmlElement | undefined {
  if (rId === undefined) {
    return undefined;
  }
  const rel = slideRels.get(rId);
  return rel === undefined ? undefined : rootElement(pkg.parts[rel.target]);
}

// Resolves the OLE object's own payload (p:oleObj/@r:id -> slide relationship -> embeddings part) through readEmbeddedPayloadPart: a ZIP payload (a modern producer's embedded xlsx/docx/pptx) and a classic compound-file .bin payload whose Package stream carries a ZIP both become the recovered sub-document's ContentEmbeddedObjectBlock at the frame's own geometry, while a compound file holding native legacy streams (no Package stream, or a packaged file that is not a ZIP) and a ZIP that does not decode as one of the three OOXML flavours both return undefined and leave the frame's content to the fallback-picture rules above -- second-order content degrades, it never fails the host read. Undefined follows the same convention as readBlipImage: an id, relationship, or part that does not line up leaves the shape with no embedded content, never a partial block.
function readOleEmbeddedObject(graphicData: XmlElement, slideRels: ReadonlyMap<string, Relationship>, pkg: Package, frame: Box): ContentEmbeddedObjectBlock | undefined {
  const oleObj = elementsWithTag([graphicData], 'p:oleObj')[0];
  const rId = oleObj === undefined ? undefined : attr(oleObj, 'r:id');
  const rel = rId === undefined ? undefined : slideRels.get(rId);
  const payloadPart = rel === undefined ? undefined : pkg.parts[rel.target];
  if (payloadPart?.kind !== 'binary') {
    return undefined;
  }
  const payload = readEmbeddedPayloadPart(payloadPart);
  return payload === undefined ? undefined : { kind: 'embeddedObject', objectKind: payload.objectKind, document: payload.document, frame };
}

function readGraphicFrameShape(gf: XmlElement, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>, pkg: Package, parentTransform: GroupChildTransform | undefined): ContentShape | undefined {
  // p:graphicFrame's own transform is a direct p:xfrm child (not nested under p:spPr, unlike p:sp/p:pic) -- verified against ECMA-376's CT_GraphicalObjectFrame element sequence.
  const xfrm = readXfrm(childrenWithTag(gf, 'p:xfrm')[0]);
  if (xfrm === undefined) {
    return undefined;
  }
  const localFrame: Box = { xPt: xfrm.xPt, yPt: xfrm.yPt, widthPt: xfrm.widthPt, heightPt: xfrm.heightPt };
  const frame = parentTransform === undefined ? localFrame : applyGroupTransform(parentTransform, localFrame);
  // Composed the same way resolveShapeFrame composes a p:sp/p:pic's own rotation -- see composeShapeRotationDeg's own doc comment.
  const composedRotationDeg = composeShapeRotationDeg(parentTransform, xfrm.rotationDeg);
  const rotationDeg = composedRotationDeg === 0 ? undefined : composedRotationDeg;

  const graphic = childrenWithTag(gf, 'a:graphic')[0];
  const graphicData = graphic === undefined ? undefined : childrenWithTag(graphic, 'a:graphicData')[0];
  const uri = graphicData === undefined ? undefined : attr(graphicData, 'uri');
  const tbl = uri === TABLE_GRAPHIC_URI && graphicData !== undefined ? childrenWithTag(graphicData, 'a:tbl')[0] : undefined;
  let blocks: ContentBlock[];
  if (tbl !== undefined) {
    blocks = [readTable(tbl, context, slideRels)];
  } else if (uri === CHART_GRAPHIC_URI && graphicData !== undefined) {
    const chartRef = childrenWithTag(graphicData, 'c:chart')[0];
    const chartRoot = relatedPartRoot(chartRef === undefined ? undefined : attr(chartRef, 'r:id'), slideRels, pkg);
    const chartTable = chartRoot === undefined ? undefined : readChartTable(chartRoot, frame);
    blocks = chartTable === undefined ? [] : [chartTable];
  } else if (uri === DIAGRAM_GRAPHIC_URI && graphicData !== undefined) {
    // dgm:relIds' r:dm names the data model part -- the semantic graph of nodes and text (r:lo/r:qs/r:cs only decide how that graph is drawn).
    const relIds = childrenWithTag(graphicData, 'dgm:relIds')[0];
    const dataModelRoot = relatedPartRoot(relIds === undefined ? undefined : attr(relIds, 'r:dm'), slideRels, pkg);
    blocks = dataModelRoot === undefined ? [] : readDiagramText(dataModelRoot);
  } else if (uri === OLE_GRAPHIC_URI && graphicData !== undefined) {
    // What the slide actually displays is the OLE object's fallback picture (mc:Fallback > p:oleObj > p:pic under the mc:AlternateContent wrapper, or a p:pic directly under p:oleObj where a producer skipped the wrapper), so that picture is read like any other blip image. With no reachable picture, the p:oleObj's progId at least records what kind of object the frame holds. The object's own payload (p:oleObj/@r:id's embedded part) is additionally decoded when it is a ZIP archive -- a modern producer's embedded xlsx/docx/pptx -- and its recovered sub-document appended as an embeddedObject block beside whatever the display path produced (readOleEmbeddedObject below); the classic non-ZIP OLE compound-file payload stays opaque external-application data, and a ZIP that does not decode as one of the three OOXML flavours degrades to no embedded block, so an undecodable payload never fails the slide read.
    const image = readBlipImage(graphicData, slideRels, pkg, frame);
    if (image !== undefined) {
      blocks = [image];
    } else {
      const oleObj = elementsWithTag([graphicData], 'p:oleObj')[0];
      const progId = oleObj === undefined ? undefined : attr(oleObj, 'progId');
      blocks = progId === undefined ? [] : [{ kind: 'paragraph', runs: [{ text: progId }] }];
    }
    const embedded = readOleEmbeddedObject(graphicData, slideRels, pkg, frame);
    if (embedded !== undefined) {
      blocks.push(embedded);
    }
  } else {
    // Any other graphic frame kind keeps its geometry with empty content.
    blocks = [];
  }
  return { name: shapeName(gf), frame, rotationDeg, ...NO_TEXT_BODY_EXTRAS, blocks };
}

// Flattens the shape tree, including nested p:grpSp groups, into ContentSlide's flat shapes list -- ContentShape has no representation for a nested group, so group resolution (composing each level's chOff/chExt transform into an absolute frame) happens here rather than being deferred to a later stage. p:cxnSp (connector lines) are skipped: decorative, no text content, general vector-path recovery is out of scope.
function walkShapeTreeChildren(children: readonly XmlNode[], parentTransform: GroupChildTransform | undefined, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>, pkg: Package, out: ContentShape[]): void {
  for (const node of children) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'p:sp') {
      const shape = readSpShape(node, context, slideRels, parentTransform);
      if (shape !== undefined) {
        out.push(shape);
      }
    } else if (node.tag === 'p:pic') {
      const shape = readPicShape(node, context, slideRels, pkg, parentTransform);
      if (shape !== undefined) {
        out.push(shape);
      }
    } else if (node.tag === 'p:graphicFrame') {
      const shape = readGraphicFrameShape(node, context, slideRels, pkg, parentTransform);
      if (shape !== undefined) {
        out.push(shape);
      }
    } else if (node.tag === 'p:grpSp') {
      const grpSpPr = childrenWithTag(node, 'p:grpSpPr')[0];
      const xfrmEl = grpSpPr === undefined ? undefined : childrenWithTag(grpSpPr, 'a:xfrm')[0];
      const ownGroupTransform = readGroupXfrm(xfrmEl);
      const composed = composeGroupTransform(ownGroupTransform, parentTransform);
      walkShapeTreeChildren(node.children, composed, context, slideRels, pkg, out);
    }
  }
}

const NOTES_SLIDE_REL_SUFFIX = '/notesSlide';

// Prefers the notes slide's own body/default placeholder (the actual speaker-notes text) over concatenating every a:t in the part, which would also sweep in slide-number/date/footer placeholder text that notesSlide layouts typically carry too.
function readNotes(pkg: Package, slidePath: string): string {
  let notesPath: string | undefined;
  for (const rel of resolveRelationships(pkg, slidePath).values()) {
    if (rel.type.endsWith(NOTES_SLIDE_REL_SUFFIX)) {
      notesPath = rel.target;
      break;
    }
  }
  if (notesPath === undefined) {
    return '';
  }
  const notesRoot = rootElement(pkg.parts[notesPath]);
  if (notesRoot === undefined) {
    return '';
  }
  const shapes = elementsWithTag([notesRoot], 'p:sp');
  const bodyShape = shapes.find((shape) => {
    const key = readPlaceholderKey(shape);
    return key !== undefined && (key.type === undefined || key.type === 'body');
  });
  if (bodyShape !== undefined) {
    const txBody = childrenWithTag(bodyShape, 'p:txBody')[0];
    if (txBody !== undefined) {
      return elementsWithTag(txBody.children, 'a:t').map(textContent).join('');
    }
  }
  return elementsWithTag([notesRoot], 'a:t').map(textContent).join('');
}

function readSlide(pkg: Package, slidePath: string, size: PageSize): ContentSlide {
  const slideRoot = rootElement(pkg.parts[slidePath]);
  const context = resolveSlideInheritance(pkg, slidePath);
  const slideRels = resolveRelationships(pkg, slidePath);
  const cSld = slideRoot === undefined ? undefined : childrenWithTag(slideRoot, 'p:cSld')[0];
  const spTree = cSld === undefined ? undefined : childrenWithTag(cSld, 'p:spTree')[0];
  const shapes: ContentShape[] = [];
  if (spTree !== undefined) {
    walkShapeTreeChildren(spTree.children, undefined, context, slideRels, pkg, shapes);
  }
  return { size, shapes, notes: readNotes(pkg, slidePath) };
}

// Resolves a generic OOXML Package into PptxDocument: slide order via p:sldIdLst (never slide filename order), the placeholder -> layout -> master -> theme inheritance cascade, DrawingML geometry, and embedded images sniffed from their media parts. It is a one-way read, not a round-trip path, and a PptxDocument cannot be written back to a package.
export function readPptxContent(pkg: Package): PptxDocument {
  const presentationRoot = rootElement(pkg.parts[PRESENTATION_PATH]);
  const size = readSlideSize(presentationRoot);
  const slides = readSlidePathsInOrder(pkg, presentationRoot).map((slidePath) => readSlide(pkg, slidePath, size));
  slides.forEach((slide, slideIndex) => {
    slide.shapes.forEach((shape, shapeIndex) => {
      const shapePath = `slides[${slideIndex}].shapes[${shapeIndex}]`;
      shape.sourcePath = shapePath;
      assignSourcePaths(shape.blocks, shapePath);
    });
  });
  return { metadata: readCoreProperties(pkg), slides };
}
