import { describe, expect, it } from 'vitest';
import { applyMatrix, composeMatrices, IDENTITY_MATRIX, isAxisAligned, isNonReflectingSimilarity, meanScaleFactor, parseSvgTransform, similarityRotationDeg } from './transform';

describe('parseSvgTransform', () => {
  it('applies a transform list left to right, innermost function first', () => {
    // translate(10,20) scale(2): scale applies to the point first, then the translate -- the SVG list order as function composition.
    const total = parseSvgTransform('translate(10,20) scale(2)');
    expect(total).toBeDefined();
    expect(applyMatrix(total!, 1, 1)).toEqual({ x: 12, y: 22 });
  });

  it('parses every function form, including rotate\'s optional centre', () => {
    expect(parseSvgTransform('translate(5)')).toBeDefined();
    expect(parseSvgTransform('scale(2,3)')).toBeDefined();
    expect(parseSvgTransform('skewX(45)')).toBeDefined();
    expect(parseSvgTransform('skewY(30)')).toBeDefined();
    expect(parseSvgTransform('matrix(1 2 3 4 5 6)')).toBeDefined();
    // rotate(90, 5, 5) is exactly translate(5,5) rotate(90) translate(-5,-5): the point (5,6) orbits the centre to (4,5).
    const rotated = parseSvgTransform('rotate(90, 5, 5)');
    expect(applyMatrix(rotated!, 5, 6)).toEqual({ x: 4, y: 5 });
  });

  it('returns undefined for any malformed list rather than a partial parse', () => {
    expect(parseSvgTransform('translate(10')).toBeUndefined();
    expect(parseSvgTransform('foo(1)')).toBeUndefined();
    expect(parseSvgTransform('scale(1,2,3)')).toBeUndefined();
    expect(parseSvgTransform('matrix(1 2 3)')).toBeUndefined();
    expect(parseSvgTransform('rotate(90,)')).toBeUndefined();
    expect(parseSvgTransform('TRANSLATE(10)')).toBeUndefined();
    expect(parseSvgTransform('')).toBeUndefined();
    expect(parseSvgTransform('  ')).toBeUndefined();
    expect(parseSvgTransform(undefined)).toBeUndefined();
  });
});

describe('matrix classification', () => {
  it('marks a matrix axis-aligned exactly when no rotation or shear terms exist', () => {
    expect(isAxisAligned(IDENTITY_MATRIX)).toBe(true);
    expect(isAxisAligned(parseSvgTransform('scale(2,3)')!)).toBe(true);
    expect(isAxisAligned(parseSvgTransform('translate(10,20)')!)).toBe(true);
    // Mirroring is still axis-aligned: a bounding box absorbs it exactly.
    expect(isAxisAligned(parseSvgTransform('scale(-1,1)')!)).toBe(true);
    expect(isAxisAligned(parseSvgTransform('rotate(90)')!)).toBe(false);
    expect(isAxisAligned(parseSvgTransform('skewX(45)')!)).toBe(false);
  });

  it('classifies by frame representability: axis-aligned maps pass however they scale or mirror, rotation-composed non-uniform maps and shears fail', () => {
    expect(isNonReflectingSimilarity(parseSvgTransform('rotate(30)')!)).toBe(true);
    expect(isNonReflectingSimilarity(parseSvgTransform('rotate(30) scale(2) scale(0.5)')!)).toBe(true);
    // An axis-aligned non-uniform scale or mirror still maps a frame onto a frame (an ellipse stays an axis-aligned ellipse, with new radii), so both pass the classification; only composed with rotation or shear does the map become a shape no frame carries.
    expect(isNonReflectingSimilarity(parseSvgTransform('scale(2,3)')!)).toBe(true);
    expect(isNonReflectingSimilarity(parseSvgTransform('scale(-1,1)')!)).toBe(true);
    expect(isNonReflectingSimilarity(parseSvgTransform('matrix(-1 1 0 1 0 0)')!)).toBe(false);
    expect(isNonReflectingSimilarity(parseSvgTransform('rotate(30) scale(2,3)')!)).toBe(false);
    expect(isNonReflectingSimilarity(parseSvgTransform('skewX(45)')!)).toBe(false);
  });

  it('reads a similarity\'s rotation straight off the first column, in screen-clockwise degrees', () => {
    expect(similarityRotationDeg(parseSvgTransform('rotate(90)')!)).toBeCloseTo(90, 9);
    expect(similarityRotationDeg(parseSvgTransform('rotate(-30)')!)).toBeCloseTo(-30, 9);
    expect(similarityRotationDeg(composeMatrices(parseSvgTransform('scale(2)')!, parseSvgTransform('rotate(45)')!))).toBeCloseTo(45, 9);
  });
});

describe('meanScaleFactor', () => {
  it('is 1 for the identity and any rotation, the mean of the two column scales otherwise', () => {
    expect(meanScaleFactor(IDENTITY_MATRIX)).toBe(1);
    expect(meanScaleFactor(parseSvgTransform('rotate(90)')!)).toBeCloseTo(1, 12);
    expect(meanScaleFactor(parseSvgTransform('scale(2,3)')!)).toBe(2.5);
    // The mean, not the determinant\'s square root: under this shear the columns disagree (1 and sqrt(2)), and the stroke width tracks their average.
    expect(meanScaleFactor(parseSvgTransform('matrix(1 0 1 1 0 0)')!)).toBeCloseTo((1 + Math.SQRT2) / 2, 12);
  });
});
