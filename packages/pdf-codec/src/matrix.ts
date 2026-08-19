// Point is owned by document-schema.js (the neutral shared-schema package); imported here for the affine-matrix machinery below (PDF cm/Tm operand convention). A consumer needing Point itself imports it directly from document-schema.js.
import type { Point } from 'document-schema.js';

// A 6-element affine transformation matrix [a, b, c, d, e, f], representing: | a b 0 | | c d 0 | | e f 1 | exactly PDF's own cm/Tm operand convention (ISO 32000-1 section 8.3.4): a row vector [x y 1] is transformed by post-multiplying it by this matrix, [x' y' 1] = [x y 1] x M.
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

// Composes two matrices as "apply `m` first, then `n`" -- the PDF/PostScript convention where a new cm operand M is prepended to the CTM (CTM' = M x CTM). Verified against the row-vector matrix product by hand: for M=[[a1,b1,0],[c1,d1,0],[e1,f1,1]] and N=[[a2,b2,0],[c2,d2,0],[e2,f2,1]], M x N's top-left 2x2 block and translation row expand to exactly the six expressions below.
export function multiplyMatrices(m: Matrix, n: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

export function applyMatrix(m: Matrix, point: Point): Point {
  const [a, b, c, d, e, f] = m;
  return { x: point.x * a + point.y * c + e, y: point.x * b + point.y * d + f };
}

export function translationMatrix(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function scaleMatrix(sx: number, sy: number): Matrix {
  return [sx, 0, 0, sy, 0, 0];
}

// 4/3 * (sqrt(2) - 1): the standard cubic-Bezier approximation of a quarter circle, the control-point offset every ellipse-as-Beziers construction uses since neither PDF nor PostScript has a native ellipse (or even circle) path operator. It lives here, in the shared pure-geometry module, rather than in either half of the codec, because both halves genuinely need it: content-write.ts's writeEllipse emits an ellipse with it, and interpret.ts's read-side ellipse detection recognises one by it.
export const BEZIER_KAPPA = 0.5522847498;

// A rotation matrix for `degrees` measured counter-clockwise (the PDF/PostScript convention).
export function rotationMatrix(degrees: number): Matrix {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cos, sin, -sin, cos, 0, 0];
}

// The effective horizontal/vertical scale and rotation a matrix applies -- used both when building a placement matrix for an image (content-write.ts) and, on the read path, when recovering an image's placed size/rotation from an observed CTM (a future pdf/interpret.ts concern).
export function matrixScaleX(m: Matrix): number {
  return Math.hypot(m[0], m[1]);
}

export function matrixScaleY(m: Matrix): number {
  return Math.hypot(m[2], m[3]);
}

export function matrixRotationDegrees(m: Matrix): number {
  return (Math.atan2(m[1], m[0]) * 180) / Math.PI;
}

// Rotates `point` about `center` by `degrees` (counter-clockwise, this module's own convention). Used to reconcile two different rotation pivots: DrawingML rotates a shape about its own bounding-box centre (a:xfrm/@rot), but content-write.ts's writeText/writeImage rotate about the anchor point passed as xPt/yPt -- which is invariant under that rotation by construction (translationMatrix is applied after rotationMatrix, so whatever anchor is passed is exactly where it ends up). Feeding this function the shape's UNROTATED corner and its centre computes the corner position a caller must pass as xPt/yPt so the centre-pivot rotation PowerPoint actually performs comes out identical, without needing to change how the writer itself rotates.
export function rotatePointAboutCenter(point: Point, center: Point, degrees: number): Point {
  const relative: Point = { x: point.x - center.x, y: point.y - center.y };
  const rotated = applyMatrix(rotationMatrix(degrees), relative);
  return { x: rotated.x + center.x, y: rotated.y + center.y };
}
