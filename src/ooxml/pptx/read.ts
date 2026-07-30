import type { Package, Relationship, XmlElement, XmlNode } from 'ooxml.js';
import { attr, base64ToBytes, childrenWithTag, elementsWithTag, resolveRelationships, rootElement, textContent } from 'ooxml.js';
import type { ContentBlock, ContentDocument, ContentImageBlock, ContentParagraph, ContentRun, ContentShape, ContentSlide, ContentTable, ContentTableCell } from '../../model/content';
import { CONTENT_FORMAT_VERSION } from '../../model/content';
import type { Box, PageSize } from '../../model/geometry';
import { SLIDE_SIZE_WIDESCREEN } from '../../model/geometry';
import type { Alignment } from '../../model/style';
import { drawingMlFontSizeToPt, emuToPt } from '../../model/units';
import { sniffImageFormat } from '../../image/sniff';
import { applyGroupTransform, readGroupXfrm, readSolidFillColor, readXfrm } from '../drawingml';
import type { GroupChildTransform } from '../drawingml';
import { readCoreProperties } from '../core-properties';
import type { DefaultRunProperties, SlideInheritanceContext } from './inherit';
import { readPlaceholderKey, readRunPropertiesFromElement, resolveDefaultRunProperties, resolvePlaceholderXfrm, resolveSlideInheritance } from './inherit';

// Package -> ContentDocument (the presentation variant). Walks PresentationML directly over Package/XmlElement -- ooxml.js's own readPptx is a lossy, geometry-free projection not usable here (see the implementation plan's verified-facts table): document order, placeholder inheritance, and theme resolution all matter for conversion fidelity in a way readPptx doesn't model.

const PRESENTATION_PATH = 'ppt/presentation.xml';
const TABLE_GRAPHIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table';

function readSlideSize(presentationRoot: XmlElement | undefined): PageSize {
  const sldSz = presentationRoot === undefined ? undefined : childrenWithTag(presentationRoot, 'p:sldSz')[0];
  const cx = sldSz === undefined ? undefined : attr(sldSz, 'cx');
  const cy = sldSz === undefined ? undefined : attr(sldSz, 'cy');
  return cx === undefined || cy === undefined ? SLIDE_SIZE_WIDESCREEN : { widthPt: emuToPt(Number(cx)), heightPt: emuToPt(Number(cy)) };
}

// Slide order comes from p:presentation/p:sldIdLst, resolved through the presentation's own relationships -- never from slide part filenames, which carry no ordering guarantee (the live-view editor's own moveSlide reorders p:sldIdLst without renaming files, so a filename-sort reader would silently disagree with the editor about slide order).
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

// a:spcBef/a:spcAft wrap either an absolute a:spcPts (hundredths of a point, the same scale as run font size) or a relative a:spcPct (percentage of line height). Only the absolute form is read for v1 -- resolving a percentage needs the paragraph's own effective font size, which complicates this reader for a case real-world content uses far less often than the absolute form.
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

function readParagraph(pEl: XmlElement, placeholderType: string | undefined, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>): ContentParagraph {
  const pPr = childrenWithTag(pEl, 'a:pPr')[0];
  const level = pPr === undefined ? 0 : Number(attr(pPr, 'lvl') ?? '0');
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
      // A forced line break within the paragraph, modelled as a run containing a literal newline -- src/pdf/text-layout.ts's atomizer already treats an embedded '\n' as a forced break within a run's own text.
      runs.push({ text: '\n' });
    }
  }

  const marL = pPr === undefined ? undefined : attr(pPr, 'marL');
  const indent = pPr === undefined ? undefined : attr(pPr, 'indent');

  return {
    kind: 'paragraph',
    runs,
    alignment: pPr === undefined ? undefined : readAlignment(attr(pPr, 'algn')),
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
  // Rotation deliberately passes through from the shape's own local a:xfrm@rot unchanged, never composed with a parent group's own rotation -- ECMA-376's real composition rule for rotated shapes inside a rotated/flipped group is one of DrawingML's more arcane corners, and a documented pass-through is more honest than a plausible-looking wrong composition.
  return {
    frame: parentTransform === undefined ? localFrame : applyGroupTransform(parentTransform, localFrame),
    rotationDeg: xfrm.rotationDeg === 0 ? undefined : xfrm.rotationDeg,
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
  return { name: shapeName(sp), frame: resolved.frame, rotationDeg: resolved.rotationDeg, blocks };
}

function readPicShape(pic: XmlElement, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>, pkg: Package, parentTransform: GroupChildTransform | undefined): ContentShape | undefined {
  const resolved = resolveShapeFrame(pic, context, parentTransform);
  if (resolved === undefined) {
    return undefined;
  }
  const blipFill = childrenWithTag(pic, 'p:blipFill')[0];
  const blip = blipFill === undefined ? undefined : childrenWithTag(blipFill, 'a:blip')[0];
  const rId = blip === undefined ? undefined : attr(blip, 'r:embed');
  const rel = rId === undefined ? undefined : slideRels.get(rId);
  const mediaPart = rel === undefined ? undefined : pkg.parts[rel.target];
  const blocks: ContentBlock[] = [];
  if (mediaPart?.kind === 'binary') {
    const bytes = base64ToBytes(mediaPart.base64);
    const format = sniffImageFormat(bytes);
    if (format !== undefined) {
      const image: ContentImageBlock = { kind: 'image', format, base64: mediaPart.base64, widthPt: resolved.frame.widthPt, heightPt: resolved.frame.heightPt };
      blocks.push(image);
    }
  }
  // An unresolvable image (missing relationship/part, or bytes that don't sniff as PNG/JPEG) keeps the shape's geometry with empty content, rather than dropping the shape entirely.
  return { name: shapeName(pic), frame: resolved.frame, rotationDeg: resolved.rotationDeg, blocks };
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
  const rows = childrenWithTag(tbl, 'a:tr').map((tr) => ({ cells: childrenWithTag(tr, 'a:tc').map((tc) => readTableCell(tc, context, slideRels)) }));
  return { kind: 'table', rows, columnWidthsPt };
}

function readGraphicFrameShape(gf: XmlElement, context: SlideInheritanceContext, slideRels: ReadonlyMap<string, Relationship>, parentTransform: GroupChildTransform | undefined): ContentShape | undefined {
  // p:graphicFrame's own transform is a direct p:xfrm child (not nested under p:spPr, unlike p:sp/p:pic) -- verified against ECMA-376's CT_GraphicalObjectFrame element sequence.
  const xfrm = readXfrm(childrenWithTag(gf, 'p:xfrm')[0]);
  if (xfrm === undefined) {
    return undefined;
  }
  const localFrame: Box = { xPt: xfrm.xPt, yPt: xfrm.yPt, widthPt: xfrm.widthPt, heightPt: xfrm.heightPt };
  const frame = parentTransform === undefined ? localFrame : applyGroupTransform(parentTransform, localFrame);
  const rotationDeg = xfrm.rotationDeg === 0 ? undefined : xfrm.rotationDeg;

  const graphic = childrenWithTag(gf, 'a:graphic')[0];
  const graphicData = graphic === undefined ? undefined : childrenWithTag(graphic, 'a:graphicData')[0];
  const uri = graphicData === undefined ? undefined : attr(graphicData, 'uri');
  const tbl = uri === TABLE_GRAPHIC_URI && graphicData !== undefined ? childrenWithTag(graphicData, 'a:tbl')[0] : undefined;
  // A non-table graphic frame (chart/SmartArt/OLE) keeps its geometry with empty content -- out of v1 scope beyond their raster mc:Fallback, which lives outside a:graphicData entirely and isn't reached from here.
  const blocks: ContentBlock[] = tbl === undefined ? [] : [readTable(tbl, context, slideRels)];
  return { name: shapeName(gf), frame, rotationDeg, blocks };
}

// Flattens the shape tree, including nested p:grpSp groups, into ContentSlide's flat shapes list -- ContentDocument has no representation for a nested group, so group resolution (composing each level's chOff/chExt transform into an absolute frame) happens here rather than being deferred to the layout stage. p:cxnSp (connector lines) are skipped: decorative, no text content, general vector-path recovery is out of v1 scope.
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
      const shape = readGraphicFrameShape(node, context, slideRels, parentTransform);
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

// A nested group's own off/ext is itself expressed in the OUTER group's child coordinate space, so it must be mapped through the outer transform before it can anchor the inner group's own children.
function composeGroupTransform(own: GroupChildTransform | undefined, parent: GroupChildTransform | undefined): GroupChildTransform | undefined {
  if (own === undefined) {
    return undefined;
  }
  if (parent === undefined) {
    return own;
  }
  const absolute = applyGroupTransform(parent, { xPt: own.offXPt, yPt: own.offYPt, widthPt: own.extWidthPt, heightPt: own.extHeightPt });
  return { ...own, offXPt: absolute.xPt, offYPt: absolute.yPt, extWidthPt: absolute.widthPt, extHeightPt: absolute.heightPt };
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

export function readPptxContent(pkg: Package): ContentDocument {
  const presentationRoot = rootElement(pkg.parts[PRESENTATION_PATH]);
  const size = readSlideSize(presentationRoot);
  const slides = readSlidePathsInOrder(pkg, presentationRoot).map((slidePath) => readSlide(pkg, slidePath, size));
  return { kind: 'presentation', formatVersion: CONTENT_FORMAT_VERSION, metadata: readCoreProperties(pkg), slides };
}
