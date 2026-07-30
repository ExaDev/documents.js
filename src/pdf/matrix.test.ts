import { describe, expect, it } from 'vitest';
import {
  applyMatrix,
  IDENTITY_MATRIX,
  matrixRotationDegrees,
  matrixScaleX,
  matrixScaleY,
  multiplyMatrices,
  rotationMatrix,
  scaleMatrix,
  translationMatrix,
} from './matrix';

describe('applyMatrix', () => {
  it('the identity matrix leaves a point unchanged', () => {
    expect(applyMatrix(IDENTITY_MATRIX, { x: 5, y: 7 })).toEqual({ x: 5, y: 7 });
  });

  it('a translation matrix shifts a point', () => {
    expect(applyMatrix(translationMatrix(10, 20), { x: 1, y: 1 })).toEqual({ x: 11, y: 21 });
  });

  it('a scale matrix scales a point about the origin', () => {
    expect(applyMatrix(scaleMatrix(2, 3), { x: 4, y: 5 })).toEqual({ x: 8, y: 15 });
  });

  it('a 90-degree rotation maps (1,0) to (0,1)', () => {
    const result = applyMatrix(rotationMatrix(90), { x: 1, y: 0 });
    expect(result.x).toBeCloseTo(0, 10);
    expect(result.y).toBeCloseTo(1, 10);
  });
});

describe('multiplyMatrices', () => {
  it('composing with identity on either side is a no-op', () => {
    const m = translationMatrix(3, 4);
    expect(multiplyMatrices(m, IDENTITY_MATRIX)).toEqual(m);
    expect(multiplyMatrices(IDENTITY_MATRIX, m)).toEqual(m);
  });

  it('applying a composed matrix equals applying each matrix in sequence', () => {
    const scale = scaleMatrix(2, 2);
    const translate = translationMatrix(10, 0);
    const composed = multiplyMatrices(scale, translate);
    const point = { x: 3, y: 3 };
    const sequential = applyMatrix(translate, applyMatrix(scale, point));
    expect(applyMatrix(composed, point)).toEqual(sequential);
  });

  it('is associative under repeated composition (two ways of grouping three matrices agree)', () => {
    const a = translationMatrix(1, 2);
    const b = scaleMatrix(2, 3);
    const c = rotationMatrix(45);
    const left = multiplyMatrices(multiplyMatrices(a, b), c);
    const right = multiplyMatrices(a, multiplyMatrices(b, c));
    const point = { x: 5, y: -2 };
    const leftResult = applyMatrix(left, point);
    const rightResult = applyMatrix(right, point);
    expect(leftResult.x).toBeCloseTo(rightResult.x, 10);
    expect(leftResult.y).toBeCloseTo(rightResult.y, 10);
  });
});

describe('matrixScaleX / matrixScaleY / matrixRotationDegrees', () => {
  it('recovers the scale factors from a scale matrix', () => {
    const m = scaleMatrix(2, 5);
    expect(matrixScaleX(m)).toBeCloseTo(2, 10);
    expect(matrixScaleY(m)).toBeCloseTo(5, 10);
  });

  it('recovers the rotation angle from a rotation matrix', () => {
    expect(matrixRotationDegrees(rotationMatrix(30))).toBeCloseTo(30, 10);
    expect(matrixRotationDegrees(rotationMatrix(0))).toBeCloseTo(0, 10);
  });
});
