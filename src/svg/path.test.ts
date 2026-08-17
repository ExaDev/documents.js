import { describe, expect, it } from 'vitest';
import { parseSvgPathData } from './path';

describe('parseSvgPathData', () => {
  it('parses absolute M/L into one open subpath of line segments', () => {
    const parsed = parseSvgPathData('M 10 20 L 30 40');
    expect(parsed).toEqual([
      { start: { x: 10, y: 20 }, closed: false, segments: [{ kind: 'line', to: { x: 30, y: 40 } }] },
    ]);
  });

  it('parses the relative lowercase forms against the running current point', () => {
    const parsed = parseSvgPathData('m 10 20 l 5 5 L 100 100');
    expect(parsed).toEqual([
      { start: { x: 10, y: 20 }, closed: false, segments: [{ kind: 'line', to: { x: 15, y: 25 } }, { kind: 'line', to: { x: 100, y: 100 } }] },
    ]);
  });

  it('parses H/V (and h/v) as lines that keep the other coordinate fixed', () => {
    const parsed = parseSvgPathData('M 10 20 H 30 V 5 h -5 v -3');
    expect(parsed).toEqual([
      { start: { x: 10, y: 20 }, closed: false, segments: [
        { kind: 'line', to: { x: 30, y: 20 } },
        { kind: 'line', to: { x: 30, y: 5 } },
        { kind: 'line', to: { x: 25, y: 5 } },
        { kind: 'line', to: { x: 25, y: 2 } },
      ] },
    ]);
  });

  it('parses absolute C with its three points verbatim', () => {
    const parsed = parseSvgPathData('M 0 0 C 10 0 10 10 20 10');
    expect(parsed).toEqual([
      { start: { x: 0, y: 0 }, closed: false, segments: [{ kind: 'cubic', control1: { x: 10, y: 0 }, control2: { x: 10, y: 10 }, to: { x: 20, y: 10 } }] },
    ]);
  });

  it('reflects S\'s first control through the current point exactly (the previous cubic\'s second control)', () => {
    // After C lands at (20,10) with second control (10,10), S\'s own first control must be the mirror image (30,10) -- the author\'s intended smooth join, reproduced with no approximation.
    const parsed = parseSvgPathData('M 0 0 C 10 0 10 10 20 10 S 30 20 30 30');
    expect(parsed).toEqual([
      { start: { x: 0, y: 0 }, closed: false, segments: [
        { kind: 'cubic', control1: { x: 10, y: 0 }, control2: { x: 10, y: 10 }, to: { x: 20, y: 10 } },
        { kind: 'cubic', control1: { x: 30, y: 10 }, control2: { x: 30, y: 20 }, to: { x: 30, y: 30 } },
      ] },
    ]);
  });

  it('falls back to the current point as S\'s first control when no cubic precedes it', () => {
    // The spec\'s own rule: with no previous cubic\'s control to reflect, the reflected control is the current point itself.
    const parsed = parseSvgPathData('M 0 0 S 10 10 20 20');
    expect(parsed).toEqual([
      { start: { x: 0, y: 0 }, closed: false, segments: [{ kind: 'cubic', control1: { x: 0, y: 0 }, control2: { x: 10, y: 10 }, to: { x: 20, y: 20 } }] },
    ]);
  });

  it('elevates Q to a cubic exactly, with both controls at the 2/3 marks toward the shared control', () => {
    // A quadratic is the degree-2 special case of a cubic: the elevated controls at from + 2/3*(control-from) and to + 2/3*(control-to) trace the identical curve at every parameter.
    const parsed = parseSvgPathData('M 0 0 Q 30 0 30 30');
    expect(parsed).toEqual([
      { start: { x: 0, y: 0 }, closed: false, segments: [{ kind: 'cubic', control1: { x: 20, y: 0 }, control2: { x: 30, y: 10 }, to: { x: 30, y: 30 } }] },
    ]);
  });

  it('reflects T\'s control through the current point, then elevates the quadratic exactly', () => {
    // After Q (from (0,0), control (30,0), to (30,30)), T\'s control is the mirror of (30,0) through (30,30): (30,60). The elevated controls are then (30,50) and (40,60).
    const parsed = parseSvgPathData('M 0 0 Q 30 0 30 30 T 60 60');
    expect(parsed).toEqual([
      { start: { x: 0, y: 0 }, closed: false, segments: [
        { kind: 'cubic', control1: { x: 20, y: 0 }, control2: { x: 30, y: 10 }, to: { x: 30, y: 30 } },
        { kind: 'cubic', control1: { x: 30, y: 50 }, control2: { x: 40, y: 60 }, to: { x: 60, y: 60 } },
      ] },
    ]);
  });

  it('degenerates T to the current point as control when no quadratic precedes it, per the spec\'s own rule', () => {
    // With no previous quadratic control to reflect, the control is the current point (0,0) itself, and the same exact elevation applies -- control2 sits 2/3 of the way back from the endpoint, expressed here as the identical arithmetic so the assertion is bit-exact.
    const parsed = parseSvgPathData('M 0 0 T 10 10');
    expect(parsed).toEqual([
      { start: { x: 0, y: 0 }, closed: false, segments: [{ kind: 'cubic', control1: { x: 0, y: 0 }, control2: { x: 10 + (2 / 3) * (0 - 10), y: 10 + (2 / 3) * (0 - 10) }, to: { x: 10, y: 10 } }] },
    ]);
  });

  it('closes Z/z subpaths and opens a fresh one at the next moveto', () => {
    const parsed = parseSvgPathData('M 0 0 L 10 0 M 20 20 L 30 30 Z');
    expect(parsed).toEqual([
      { start: { x: 0, y: 0 }, closed: false, segments: [{ kind: 'line', to: { x: 10, y: 0 } }] },
      { start: { x: 20, y: 20 }, closed: true, segments: [{ kind: 'line', to: { x: 30, y: 30 } }] },
    ]);
  });

  it('treats further coordinate groups after one M as lineto (implicit repetition)', () => {
    const parsed = parseSvgPathData('M 10 10 20 20 30 30');
    expect(parsed).toEqual([
      { start: { x: 10, y: 10 }, closed: false, segments: [{ kind: 'line', to: { x: 20, y: 20 } }, { kind: 'line', to: { x: 30, y: 30 } }] },
    ]);
  });

  it('reads arc flags as single characters even when fused with the surrounding numbers', () => {
    // "01100" must split into flag 0, flag 1, and the number 100 -- the classic packed-flag form a number-based parser misreads. A half circle from (0,0) to (100,0), sweep 1.
    const parsed = parseSvgPathData('M 0 0 A 50 50 0 01100 0');
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    expect(segments.length).toBe(2);
    const last = segments[segments.length - 1]!;
    if (last.kind !== 'cubic') {
      throw new Error('expected the arc to emit cubic segments');
    }
    expect(last.to.x).toBeCloseTo(100, 9);
    expect(last.to.y).toBeCloseTo(0, 9);
  });

  it('renders a zero-radius arc as a straight line to the endpoint, per the spec\'s own rule', () => {
    const parsed = parseSvgPathData('M 0 0 A 0 0 0 0 1 10 0');
    expect(parsed).toEqual([
      { start: { x: 0, y: 0 }, closed: false, segments: [{ kind: 'line', to: { x: 10, y: 0 } }] },
    ]);
  });

  it('splits a 180-degree arc into two cubics whose segment boundaries sit on the true circle', () => {
    // From (0,0) to (100,0) with r=50 the chord is the diameter, so the centre is the midpoint (50,0) by symmetry and every segment boundary must sit exactly 50 from it (only the curve between boundaries is the bounded Bezier approximation).
    const parsed = parseSvgPathData('M 0 0 A 50 50 0 0 1 100 0');
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    expect(segments.length).toBe(2);
    for (const segment of segments) {
      if (segment.kind !== 'cubic') {
        throw new Error('expected the arc to emit cubic segments');
      }
      expect(Math.hypot(segment.to.x - 50, segment.to.y)).toBeCloseTo(50, 6);
    }
  });

  it('splits a 270-degree sweep into three cubics, every boundary on the true circle', () => {
    // Clockwise on screen (sweep=1, y-down) from (50,0) through (0,50), (-50,0) to (0,-50) is the large 270-degree arc around the origin: exactly three at-most-90-degree segments, each boundary at distance 50 from the origin.
    const parsed = parseSvgPathData('M 50 0 A 50 50 0 1 1 0 -50');
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    expect(segments.length).toBe(3);
    for (const segment of segments) {
      if (segment.kind !== 'cubic') {
        throw new Error('expected the arc to emit cubic segments');
      }
      expect(Math.hypot(segment.to.x, segment.to.y)).toBeCloseTo(50, 6);
    }
    const last = segments[segments.length - 1]!;
    if (last.kind !== 'cubic') {
      throw new Error('expected the arc to emit cubic segments');
    }
    expect(last.to.x).toBeCloseTo(0, 9);
    expect(last.to.y).toBeCloseTo(-50, 9);
  });

  it('scales up radii too small to span the endpoints, exactly the factor that makes them span', () => {
    // rx=1 cannot reach (100,0) from (0,0); F.6.6\'s correction scales it to 50, so the recovered curve still lands on the endpoint.
    const parsed = parseSvgPathData('M 0 0 A 1 1 0 0 1 100 0');
    expect(parsed).toBeDefined();
    const segments = parsed![0]!.segments;
    const last = segments[segments.length - 1]!;
    if (last.kind !== 'cubic') {
      throw new Error('expected the arc to emit cubic segments');
    }
    expect(last.to.x).toBeCloseTo(100, 9);
    expect(last.to.y).toBeCloseTo(0, 9);
  });

  it('drops subpaths that carry no segments (a bare moveto, or M immediately followed by Z)', () => {
    expect(parseSvgPathData('M 10 10')).toEqual([]);
    expect(parseSvgPathData('M 10 10 Z')).toEqual([]);
  });

  it('returns undefined for malformed data rather than a partial parse', () => {
    // A drawing command before the first moveto has no subpath to draw into; an unknown command letter and an argument-count shortfall have no meaning at all -- none may half-parse.
    expect(parseSvgPathData('L 10 10')).toBeUndefined();
    expect(parseSvgPathData('M 0 0 X 10 10')).toBeUndefined();
    expect(parseSvgPathData('M 0 0 C 10 10 20')).toBeUndefined();
    expect(parseSvgPathData('M 10 10 Z 5 5')).toBeUndefined();
  });

  it('reads a sign as itself a separator, so "10-10" is two numbers', () => {
    const parsed = parseSvgPathData('M 10-10L20-20');
    expect(parsed).toEqual([
      { start: { x: 10, y: -10 }, closed: false, segments: [{ kind: 'line', to: { x: 20, y: -20 } }] },
    ]);
  });

  it('reads exponent-notation numbers', () => {
    const parsed = parseSvgPathData('M 1e1 2e1 L 1.5e1 .5e1');
    expect(parsed).toEqual([
      { start: { x: 10, y: 20 }, closed: false, segments: [{ kind: 'line', to: { x: 15, y: 5 } }] },
    ]);
  });
});
