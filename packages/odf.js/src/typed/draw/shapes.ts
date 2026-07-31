import type { Box, ContentBlock, ContentImageBlock, ContentShape } from 'document-content-model';
import type { XmlElement, XmlNode } from '../../model/node';
import type { Package } from '../../model/package';
import { attrValue, childrenWithTag, elementsWithTag } from '../../xml/query';
import { base64ToBytes } from '../../util/base64';
import { sniffImageFormat } from '../../image/sniff';
import { resolveStyleElementChain } from '../shared/cascade';
import { readOdfParagraph } from '../shared/paragraph';
import { readOdfTable } from '../shared/table';
import { parseOdfLength } from '../shared/units';
import type { OdfTransformFunction } from '../shared/transform';
import { composeOdfGroupTransform, parseOdfTransform, resolveOdfShapeGeometry } from '../shared/transform';

// The shape vocabulary shared between odp (this task) and odg (a LATER task, which will EXTEND this same file additively with vector-primitive kinds -- draw:rect/draw:ellipse/draw:line/draw:path and friends). This task builds only what a real presentation slide actually needs: draw:frame (a positioned container for text/image/table content) and draw:g (a group, flattened into its parent's own flat shape list -- ContentShape has no representation for a nested group). A vector-primitive draw: element that is NOT wrapped in a draw:frame (a plain draw:rect/draw:ellipse/draw:custom-shape sitting directly under a draw:page or draw:g -- valid, real ODF, Impress does allow it) is silently skipped by walkDrawShapes below: a deliberate, documented scope boundary for this task, not a gap introduced by accident, exactly mirroring how ooxml.js's own pptx shape-tree walker skips p:cxnSp connector shapes for the same "no vector-primitive recovery in this reader" reason.

interface FrameInsets {
  readonly insetLeftPt: number;
  readonly insetTopPt: number;
  readonly insetRightPt: number;
  readonly insetBottomPt: number;
}

const ZERO_INSETS: FrameInsets = { insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0 };

function readPaddingPt(props: XmlElement, attrName: string): number | undefined {
  const value = attrValue(props, attrName);
  return value === undefined ? undefined : parseOdfLength(value);
}

// A draw:frame's own text insets come from its graphic-family style's style:graphic-properties/fo:padding-* (verified against real LibreOffice output: e.g. the built-in "standard" graphic style sets fo:padding-top="0.125cm" fo:padding-bottom="0.125cm" fo:padding-left="0.25cm" fo:padding-right="0.25cm") -- a dimensional/decorative property style/properties.ts deliberately does not model (see that module's own top-of-file note), so this reads style:graphic-properties directly. Unlike table.ts's own single-level findStyleElement lookups, this WALKS the full style:parent-style-name chain (via cascade.ts's resolveStyleElementChain, root-first) because real LibreOffice output routinely inherits padding from a parent style (a shape's own automatic style commonly sets only its own min-height/min-width directly, leaving fo:padding-* to be inherited from its style:parent-style-name="standard" chain) rather than repeating the full declaration on every shape's own automatic style.
function readFrameInsets(frame: XmlElement, pkg: Package): FrameInsets {
  const styleName = attrValue(frame, 'draw:style-name');
  const { elements } = resolveStyleElementChain(styleName, 'graphic', pkg);
  let insets = ZERO_INSETS;
  for (const element of elements) {
    const props = childrenWithTag(element, 'style:graphic-properties')[0];
    if (props === undefined) {
      continue;
    }
    insets = {
      insetLeftPt: readPaddingPt(props, 'fo:padding-left') ?? insets.insetLeftPt,
      insetTopPt: readPaddingPt(props, 'fo:padding-top') ?? insets.insetTopPt,
      insetRightPt: readPaddingPt(props, 'fo:padding-right') ?? insets.insetRightPt,
      insetBottomPt: readPaddingPt(props, 'fo:padding-bottom') ?? insets.insetBottomPt,
    };
  }
  return insets;
}

// draw:image is a direct child of draw:frame, referencing its media part by a plain package path via xlink:href -- ODF has no relationships mechanism (see this package's own top-level README), so this IS the reference, not an indirection to resolve. Real saved .odp packages always use xlink:href against a real Pictures/ part (confirmed against a real LibreOffice-produced .odp); the flat-XML office:binary-data inline form is specific to the .fodp/.fods/.fodt single-file variants this reader (operating on a decoded zip-of-XML Package) never encounters, so it is not handled here.
function readDrawImageBlock(image: XmlElement, frameBox: Box, pkg: Package): ContentImageBlock | undefined {
  const href = attrValue(image, 'xlink:href');
  const part = href === undefined ? undefined : pkg.parts[href];
  if (part?.kind !== 'binary') {
    return undefined;
  }
  const bytes = base64ToBytes(part.base64);
  const format = sniffImageFormat(bytes);
  if (format === undefined) {
    return undefined;
  }
  // The image renders at the FRAME's own resolved size, not the source image's native pixel dimensions -- matching ooxml.js's own readPicShape convention.
  return { kind: 'image', format, base64: part.base64, widthPt: frameBox.widthPt, heightPt: frameBox.heightPt };
}

// A draw:frame's content is exactly one of table:table, draw:text-box, or draw:image (verified against real LibreOffice output) -- table:table is checked FIRST because a real saved presentation table frame also carries a sibling draw:image (an .svm fallback preview LibreOffice writes for consumers that can't render a real table), which must not be mistaken for the frame's own image content.
function readDrawFrameContent(frame: XmlElement, frameBox: Box, pkg: Package): ContentBlock[] {
  const table = childrenWithTag(frame, 'table:table')[0];
  if (table !== undefined) {
    return [readOdfTable(table, pkg)];
  }
  const textBox = childrenWithTag(frame, 'draw:text-box')[0];
  if (textBox !== undefined) {
    // elementsWithTag (a DEEP search, not childrenWithTag's direct-children-only) so a text:p nested inside a text:list/text:list-item (a real, valid ODF bulleted/numbered text box) is still read as a paragraph -- its text is preserved, though list numbering membership (ContentParagraph.list) is not populated: that needs ODF list-style resolution (text:list-style -> numId/level), a genuinely separate feature this task does not build, and a documented, narrow gap rather than a silently dropped one.
    return elementsWithTag(textBox.children, 'text:p').map((p) => readOdfParagraph(p, pkg));
  }
  const image = childrenWithTag(frame, 'draw:image')[0];
  if (image !== undefined) {
    const block = readDrawImageBlock(image, frameBox, pkg);
    return block === undefined ? [] : [block];
  }
  return [];
}

// Reads one draw:frame into a ContentShape, in the coordinate space `groupFunctions` maps FROM (its own immediate parent's local space) TO the page: composeOdfGroupTransform is the identity when groupFunctions is empty (the overwhelmingly common case -- a frame with no enclosing draw:g), so this is cheap for the non-grouped case. Returns undefined for a frame with no resolvable geometry of its own -- see transform.ts's resolveOdfShapeGeometry for the documented "inherited positioning" scope boundary this defers to.
export function readDrawFrame(frame: XmlElement, groupFunctions: readonly OdfTransformFunction[], pkg: Package): ContentShape | undefined {
  const ownGeometry = resolveOdfShapeGeometry(frame);
  if (ownGeometry === undefined) {
    return undefined;
  }
  const geometry = composeOdfGroupTransform(groupFunctions, ownGeometry);
  return {
    name: attrValue(frame, 'draw:name'),
    frame: geometry.frame,
    rotationDeg: geometry.rotationDeg,
    ...readFrameInsets(frame, pkg),
    blocks: readDrawFrameContent(frame, geometry.frame, pkg),
  };
}

function readOwnTransformFunctions(element: XmlElement): OdfTransformFunction[] {
  const value = attrValue(element, 'draw:transform');
  return value === undefined ? [] : parseOdfTransform(value);
}

// Walks a shape container's direct children (a draw:page, or a draw:g's own children) in document order, flattening any draw:g group into `out`'s own flat ContentShape list: `groupFunctions` accumulates each enclosing group's own draw:transform, INNERMOST first (a nested group's own functions are prepended ahead of whatever its own parent already accumulated), so composeOdfGroupTransform at the leaf applies them in the correct innermost-to-outermost order -- mirroring ooxml.js's own p:grpSp flattening (src/typed/pptx/read.ts's walkShapeTreeChildren/composeGroupTransform), adapted to ODF's own transform-function-list model instead of OOXML's chOff/chExt scaling. See this file's own top-of-file note on why a bare vector-primitive shape (not wrapped in a draw:frame) is silently skipped here.
export function walkDrawShapes(children: readonly XmlNode[], groupFunctions: readonly OdfTransformFunction[], pkg: Package, out: ContentShape[]): void {
  for (const node of children) {
    if (node.type !== 'element') {
      continue;
    }
    if (node.tag === 'draw:frame') {
      const shape = readDrawFrame(node, groupFunctions, pkg);
      if (shape !== undefined) {
        out.push(shape);
      }
    } else if (node.tag === 'draw:g') {
      const ownFunctions = readOwnTransformFunctions(node);
      const nested = ownFunctions.length === 0 ? groupFunctions : [...ownFunctions, ...groupFunctions];
      walkDrawShapes(node.children, nested, pkg, out);
    }
  }
}
