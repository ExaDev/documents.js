import type { Box, Color, ContentPathPoint, ContentStroke, ContentSubpath, ContentVector } from 'document-schema.js';
import { rgbHexToColor } from 'document-schema.js';
import type { XmlElement } from 'ooxml.js';
import { attr, childrenWithTag } from 'ooxml.js';
import { emuToPt } from '../model/units';

// Reads a DrawingML shape back into the ContentVector it was written from -- the read-side inverse of src/edit/drawingml/vector.ts, for tests that need to prove a rect/ellipse/line/path survived buildDocxPackage/buildPptxPackage as real, correctly-valued markup rather than merely as a string that looks about right.
//
// WHY THIS LIVES IN test-support AND NOT IN src/: it has no production caller and, deliberately, no production role. readDocxContent/readPptxContent are thin adapters over ooxml.js's own readDocx/readPptx, neither of which reads vector geometry at all -- teaching them to is a genuinely separate, reader-side feature (the OOXML mirror of the second pass src/odf/formula/detect.ts already runs for embedded formulas), not a loose end of the write support this file verifies. Shipping an unused reader in src/ to make one test read nicer would be exactly the dead code this codebase's conventions rule out.
//
// The ODF side needs no equivalent: odf.js's own readDrawPageContent already reads draw:rect/draw:ellipse/draw:line/draw:path into real ContentVectors, so the odt and odp round-trip tests verify against a genuinely independent reader rather than against an inverse written alongside the writer. That asymmetry is real and worth knowing when reading what each test actually proves.
//
// Everything here throws on anything it does not recognise rather than degrading: this is an oracle for a writer whose exact output shape is the thing under test, so a surprise is a failure, never something to tolerate.

function requireChild(parent: XmlElement, tag: string): XmlElement {
  const [child] = childrenWithTag(parent, tag);
  if (child === undefined) {
    throw new Error(`expected a ${tag} child of ${parent.tag}`);
  }
  return child;
}

function requireAttrNumber(element: XmlElement, name: string): number {
  const value = attr(element, name);
  if (value === undefined) {
    throw new Error(`expected a ${name} attribute on ${element.tag}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${element.tag}/@${name} is not an integer: ${value}`);
  }
  return parsed;
}

function readSrgbColor(parent: XmlElement): Color {
  const value = attr(requireChild(parent, 'a:srgbClr'), 'val');
  if (value === undefined) {
    throw new Error('expected a val attribute on a:srgbClr');
  }
  return rgbHexToColor(value);
}

// a:noFill and a:solidFill are the only two src/edit/drawingml/vector.ts ever writes, at shape level and inside a:ln alike.
function readFill(parent: XmlElement): Color | undefined {
  if (childrenWithTag(parent, 'a:noFill').length > 0) {
    return undefined;
  }
  return readSrgbColor(requireChild(parent, 'a:solidFill'));
}

function readOutline(spPr: XmlElement): ContentStroke | undefined {
  const ln = requireChild(spPr, 'a:ln');
  const color = readFill(ln);
  if (color === undefined) {
    return undefined;
  }
  return { color, widthPt: emuToPt(requireAttrNumber(ln, 'w')) };
}

interface Placement {
  readonly frame: Box;
  readonly rotationDeg: number | undefined;
  readonly flipH: boolean;
  readonly flipV: boolean;
}

const ROTATION_UNITS_PER_DEGREE = 60000;

function readPlacement(spPr: XmlElement): Placement {
  const xfrm = requireChild(spPr, 'a:xfrm');
  const off = requireChild(xfrm, 'a:off');
  const ext = requireChild(xfrm, 'a:ext');
  const rot = attr(xfrm, 'rot');
  return {
    frame: {
      xPt: emuToPt(requireAttrNumber(off, 'x')),
      yPt: emuToPt(requireAttrNumber(off, 'y')),
      widthPt: emuToPt(requireAttrNumber(ext, 'cx')),
      heightPt: emuToPt(requireAttrNumber(ext, 'cy')),
    },
    rotationDeg: rot === undefined ? undefined : Number.parseInt(rot, 10) / ROTATION_UNITS_PER_DEGREE,
    flipH: attr(xfrm, 'flipH') === '1',
    flipV: attr(xfrm, 'flipV') === '1',
  };
}

function readPoint(container: XmlElement, index: number): ContentPathPoint {
  const point = childrenWithTag(container, 'a:pt')[index];
  if (point === undefined) {
    throw new Error(`expected an a:pt at index ${index} of ${container.tag}`);
  }
  return { xPt: emuToPt(requireAttrNumber(point, 'x')), yPt: emuToPt(requireAttrNumber(point, 'y')) };
}

function readSubpaths(custGeom: XmlElement): ContentSubpath[] {
  return childrenWithTag(requireChild(custGeom, 'a:pathLst'), 'a:path').map((path) => {
    const segments: ContentSubpath['segments'] = [];
    let start: ContentPathPoint | undefined;
    let closed = false;
    for (const command of path.children) {
      if (command.type !== 'element') {
        continue;
      }
      switch (command.tag) {
        case 'a:moveTo':
          start = readPoint(command, 0);
          break;
        case 'a:lnTo':
          segments.push({ kind: 'line', to: readPoint(command, 0) });
          break;
        case 'a:cubicBezTo':
          segments.push({ kind: 'cubic', control1: readPoint(command, 0), control2: readPoint(command, 1), to: readPoint(command, 2) });
          break;
        case 'a:close':
          closed = true;
          break;
        default:
          throw new Error(`unrecognised a:path command: ${command.tag}`);
      }
    }
    if (start === undefined) {
      throw new Error('an a:path carried no a:moveTo');
    }
    return { start, segments, closed };
  });
}

// A shape-properties element (pptx's p:spPr, docx's wps:spPr -- CT_ShapeProperties in both) back into its ContentVector.
export function readDrawingMlVector(spPr: XmlElement): ContentVector {
  const placement = readPlacement(spPr);
  const stroke = readOutline(spPr);
  const [custGeom] = childrenWithTag(spPr, 'a:custGeom');
  if (custGeom !== undefined) {
    return { kind: 'path', frame: placement.frame, rotationDeg: placement.rotationDeg, subpaths: readSubpaths(custGeom), fill: readFill(spPr), stroke };
  }
  const preset = attr(requireChild(spPr, 'a:prstGeom'), 'prst');
  if (preset === 'line') {
    if (stroke === undefined) {
      throw new Error('a line preset with no outline: ContentVector\'s own line variant requires a stroke');
    }
    const { xPt, yPt, widthPt, heightPt } = placement.frame;
    // The inverse of placementOf's own min-corner-plus-flips encoding (src/edit/drawingml/vector.ts): each flip says the endpoint on that axis is the far edge rather than the near one.
    const from = { xPt: placement.flipH ? xPt + widthPt : xPt, yPt: placement.flipV ? yPt + heightPt : yPt };
    const to = { xPt: placement.flipH ? xPt : xPt + widthPt, yPt: placement.flipV ? yPt : yPt + heightPt };
    return { kind: 'line', from, to, stroke };
  }
  if (preset === 'rect' || preset === 'ellipse') {
    return { kind: preset, frame: placement.frame, rotationDeg: placement.rotationDeg, fill: readFill(spPr), stroke };
  }
  throw new Error(`unrecognised a:prstGeom preset: ${String(preset)}`);
}

// Every vector-carrying shape under `root`, in document order -- which is paint order in both a w:body and a p:spTree. `spPrTag` selects the format: 'wps:spPr' for a docx w:drawing/wp:anchor shape, 'p:spPr' for a pptx p:sp.
//
// An explicit a:ln child is what distinguishes a vector shape from the other shapes a package can hold. src/edit/drawingml/vector.ts always writes one (a:noFill inside it when the vector has no stroke); this package's own text-box and picture writers -- which do write an a:prstGeom prst="rect" of their own, so geometry alone is not a discriminator -- never do, leaving the outline to be inherited. A document mixing in shapes from some other producer that DOES write an a:ln would need a narrower test, which is exactly the sort of assumption a test-support oracle over known-shaped input is entitled to make.
export function collectDrawingMlVectors(root: XmlElement, spPrTag: 'wps:spPr' | 'p:spPr'): ContentVector[] {
  const out: ContentVector[] = [];
  const visit = (element: XmlElement): void => {
    if (element.tag === spPrTag && childrenWithTag(element, 'a:ln').length > 0) {
      // Stamped from the walk position, exactly as odf.js's own readDrawPageContent stamps an ODF page's vectors: document order IS paint order here, and recording it is what lets a test compare a DrawingML-recovered vector against an ODF-recovered one on identical terms.
      out.push({ ...readDrawingMlVector(element), paintOrder: out.length });
      return;
    }
    for (const child of element.children) {
      if (child.type === 'element') {
        visit(child);
      }
    }
  };
  visit(root);
  return out;
}
