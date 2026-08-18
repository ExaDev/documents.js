import { describe, expect, it } from 'vitest';
import type { ContentDocument, ContentVector } from 'document-schema.js';

import type { SvgDiagnostic } from './diagnostics';
import { readSvgContent } from './read';
import { SvgMissingRootElementError } from './read';
import { buildSvgText } from './write';
import { SvgMultiPageNotSpecifiedError, SvgPageNotFoundError, SvgUnsupportedDocumentKindError } from './write';
import { decodeSvgText, encodeSvgText, SvgInvalidUtf8Error } from './text';

// The read tests below want an identity root map -- width/height in pt equal to the viewBox extents -- so every user-unit coordinate lands in the page-point space unchanged and assertions read the SVG's own numbers back.
const IDENTITY_ROOT = '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="0 0 100 60">';
const svg = (inner: string, root = IDENTITY_ROOT): string => `${root}${inner}</svg>`;

function readVectors(text: string, diagnostics?: SvgDiagnostic[]): ContentVector[] {
  const document = readSvgContent(text, diagnostics === undefined ? undefined : { onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
  if (document.kind !== 'drawing') {
    throw new Error('expected a drawing ContentDocument');
  }
  return document.pages[0]!.vectors;
}

function drawingDocument(pages: readonly { readonly vectors: readonly ContentVector[] }[], title?: string): ContentDocument {
  return {
    kind: 'drawing',
    metadata: title === undefined ? {} : { title },
    pages: pages.map((page) => ({ size: { widthPt: 100, heightPt: 60 }, shapes: [], vectors: [...page.vectors] })),
  };
}

describe('readSvgContent', () => {
  it('maps the six shape primitives onto ContentVector kinds', () => {
    const vectors = readVectors(svg(`
      <rect x="10" y="10" width="40" height="20" fill="#ff0000"/>
      <circle cx="30" cy="40" r="10"/>
      <ellipse cx="60" cy="40" rx="15" ry="10"/>
      <line x1="0" y1="0" x2="100" y2="60" stroke="#000000"/>
      <polyline points="0,0 10,20 20,0" fill="none" stroke="blue"/>
      <polygon points="30,0 40,20 20,20"/>
    `));
    expect(vectors.map((vector) => vector.kind)).toEqual(['rect', 'ellipse', 'ellipse', 'line', 'path', 'path']);
    expect(vectors[0]).toMatchObject({ kind: 'rect', frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 20 }, fill: { r: 1, g: 0, b: 0 } });
    expect(vectors[1]).toMatchObject({ kind: 'ellipse', frame: { xPt: 20, yPt: 30, widthPt: 20, heightPt: 20 } });
    expect(vectors[2]).toMatchObject({ kind: 'ellipse', frame: { xPt: 45, yPt: 30, widthPt: 30, heightPt: 20 } });
    expect(vectors[3]).toMatchObject({ kind: 'line', from: { xPt: 0, yPt: 0 }, to: { xPt: 100, yPt: 60 }, stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 } });
    // A polyline is an open path: the frame is the tight box of its points and the subpath carries them rebased into that frame's local space.
    expect(vectors[4]).toMatchObject({ kind: 'path', frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 20 }, subpaths: [{ start: { xPt: 0, yPt: 0 }, closed: false, segments: [{ kind: 'line', to: { xPt: 10, yPt: 20 } }, { kind: 'line', to: { xPt: 20, yPt: 0 } }] }] });
    expect(vectors[5]).toMatchObject({ kind: 'path', frame: { xPt: 20, yPt: 0, widthPt: 20, heightPt: 20 }, subpaths: [{ start: { xPt: 10, yPt: 0 }, closed: true, segments: [{ kind: 'line', to: { xPt: 20, yPt: 20 } }, { kind: 'line', to: { xPt: 0, yPt: 20 } }] }] });
  });

  it('reads a bare d attribute as a path whose frame is the tight hull of all points including cubic controls', () => {
    const vectors = readVectors(svg('<path d="M 10 10 L 90 50" stroke="#0000ff" fill="none"/>'));
    expect(vectors[0]).toMatchObject({ kind: 'path', frame: { xPt: 10, yPt: 10, widthPt: 80, heightPt: 40 }, subpaths: [{ start: { xPt: 0, yPt: 0 }, closed: false, segments: [{ kind: 'line', to: { xPt: 80, yPt: 40 } }] }], stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 } });
  });

  it('builds a rounded rect as a path of four edges and four kappa corners', () => {
    const vectors = readVectors(svg('<rect x="10" y="10" width="40" height="20" rx="5"/>'));
    const vector = vectors[0];
    if (vector?.kind !== 'path') {
      throw new Error('expected a path vector');
    }
    const subpath = vector.subpaths[0];
    expect(subpath?.closed).toBe(true);
    expect(subpath?.segments.filter((segment) => segment.kind === 'line')).toHaveLength(4);
    expect(subpath?.segments.filter((segment) => segment.kind === 'cubic')).toHaveLength(4);
  });

  it('reads the root title into metadata.title, entity-decoded', () => {
    const document = readSvgContent(svg('<title>My &amp; drawing</title><rect x="1" y="1" width="2" height="2"/>'));
    if (document.kind !== 'drawing') {
      throw new Error('expected a drawing ContentDocument');
    }
    expect(document.metadata.title).toBe('My & drawing');
  });

  it('throws SvgMissingRootElementError when no svg root element is present', () => {
    expect(() => readSvgContent('<foo/>')).toThrow(SvgMissingRootElementError);
  });

  it('matches element and attribute names namespace-agnostically', () => {
    const document = readSvgContent('<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><svg:rect svg:x="10" y="10" width="5" height="5"/></svg:svg>');
    if (document.kind !== 'drawing') {
      throw new Error('expected a drawing ContentDocument');
    }
    expect(document.pages[0]?.vectors[0]).toMatchObject({ kind: 'rect', frame: { xPt: 10, yPt: 10, widthPt: 5, heightPt: 5 } });
  });
});

describe('readSvgContent root geometry', () => {
  it('falls back to the viewBox extents as the page size when width/height are absent, at a 1:1 map', () => {
    const document = readSvgContent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect x="10" y="10" width="5" height="5"/></svg>');
    if (document.kind !== 'drawing') {
      throw new Error('expected a drawing ContentDocument');
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 100, heightPt: 60 });
    expect(document.pages[0]?.vectors[0]).toMatchObject({ frame: { xPt: 10, yPt: 10, widthPt: 5, heightPt: 5 } });
  });

  it('scales user units at the exact 0.75pt/px ratio when only width/height size the page', () => {
    // No viewBox: one user unit is one CSS px = 0.75pt, so 40 user units of width become 30pt.
    const vectors = readVectors('<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt"><rect x="10" y="10" width="40" height="20"/></svg>');
    expect(vectors[0]).toMatchObject({ frame: { xPt: 7.5, yPt: 7.5, widthPt: 30, heightPt: 15 } });
  });

  it('assumes the CSS default replaced-element size (300x150 px) when nothing sizes the root, and names it', () => {
    const diagnostics: SvgDiagnostic[] = [];
    const document = readSvgContent('<svg xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="5" height="5"/></svg>', { onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    if (document.kind !== 'drawing') {
      throw new Error('expected a drawing ContentDocument');
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 225, heightPt: 112.5 });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('svg/default-size-assumed');
  });

  it('discards a lone width or height (the CSS intrinsic-sizing rule) and falls to the viewBox', () => {
    const document = readSvgContent('<svg xmlns="http://www.w3.org/2000/svg" width="100pt" viewBox="0 0 50 25"><rect x="0" y="0" width="10" height="5"/></svg>');
    if (document.kind !== 'drawing') {
      throw new Error('expected a drawing ContentDocument');
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 50, heightPt: 25 });
    expect(document.pages[0]?.vectors[0]).toMatchObject({ frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 5 } });
  });

  it('translates a viewBox with a non-zero origin so the viewBox minimum lands at the page origin', () => {
    const vectors = readVectors(svg('<rect x="10" y="5" width="40" height="20"/>', '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="10 5 100 60">'));
    expect(vectors[0]).toMatchObject({ frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 20 } });
  });

  it('stretches a viewBox whose aspect differs from the page, under a diagnostic, and honours preserveAspectRatio="none" silently', () => {
    const diagnostics: SvgDiagnostic[] = [];
    const stretched = '<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="100pt" viewBox="0 0 100 100">';
    const vectors = readVectors(`${stretched}<rect x="0" y="0" width="50" height="50"/></svg>`, diagnostics);
    expect(vectors[0]).toMatchObject({ frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 } });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('svg/preserve-aspect-ratio-stretched');
    const silent: SvgDiagnostic[] = [];
    readVectors(`${stretched.replace('viewBox="0 0 100 100"', 'viewBox="0 0 100 100" preserveAspectRatio="none"')}<rect x="0" y="0" width="50" height="50"/></svg>`, silent);
    expect(silent.map((diagnostic) => diagnostic.code)).not.toContain('svg/preserve-aspect-ratio-stretched');
  });
});

describe('readSvgContent paint', () => {
  it('paints an absent fill black and an absent stroke not at all -- SVG\'s own defaults', () => {
    const vectors = readVectors(svg('<rect x="1" y="1" width="5" height="5"/>'));
    expect(vectors[0]).toMatchObject({ fill: { r: 0, g: 0, b: 0 } });
    expect(vectors[0]?.stroke).toBeUndefined();
  });

  it('unpaints fill="none" and keeps the element only when a stroke paints it', () => {
    const diagnostics: SvgDiagnostic[] = [];
    const vectors = readVectors(svg('<rect x="1" y="1" width="5" height="5" fill="none" stroke="blue"/><rect x="1" y="1" width="5" height="5" fill="none"/>'), diagnostics);
    expect(vectors).toHaveLength(1);
    const kept = vectors[0];
    if (kept?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(kept.fill).toBeUndefined();
    expect(kept).toMatchObject({ stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 } });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('svg/element-skipped');
  });

  it('inherits presentation attributes from groups, with the child\'s own value winning', () => {
    const vectors = readVectors(svg('<g fill="red"><rect x="0" y="0" width="5" height="5"/><rect x="10" y="0" width="5" height="5" fill="blue"/></g>'));
    expect(vectors[0]).toMatchObject({ fill: { r: 1, g: 0, b: 0 } });
    expect(vectors[1]).toMatchObject({ fill: { r: 0, g: 0, b: 1 } });
  });

  it('scales stroke width by the CTM\'s mean scale and carries dash styles onto the stroke enum', () => {
    const vectors = readVectors(svg('<g transform="scale(2)" stroke-width="2" stroke-dasharray="6 4" fill="none" stroke="black"><line x1="0" y1="0" x2="10" y2="0"/></g>'));
    expect(vectors[0]?.stroke).toMatchObject({ widthPt: 4, style: 'dashed' });
    const dotted = readVectors(svg('<line x1="0" y1="0" x2="10" y2="0" fill="none" stroke="black" stroke-dasharray="1 3"/>'));
    expect(dotted[0]?.stroke).toMatchObject({ style: 'dotted' });
  });
});

describe('readSvgContent transforms', () => {
  it('composes group transforms with the viewBox map into every coordinate', () => {
    const vectors = readVectors(svg('<g transform="translate(10,5)"><rect x="0" y="0" width="10" height="10"/></g>'));
    expect(vectors[0]).toMatchObject({ frame: { xPt: 10, yPt: 5, widthPt: 10, heightPt: 10 } });
  });

  it('emits a rotated rect as the scaled pre-rotation box centred on the transformed centre, plus rotationDeg', () => {
    // rotate(90) moves the box centre (20,5) to (-5,20); the frame is the 20x10 pre-rotation box centred there, and the renderer\'s own rotation about that centre lands on the true corners.
    const vectors = readVectors(svg('<g transform="rotate(90)"><rect x="10" y="0" width="20" height="10"/></g>'));
    expect(vectors[0]).toMatchObject({ kind: 'rect', frame: { xPt: -15, yPt: 15, widthPt: 20, heightPt: 10 }, rotationDeg: 90 });
  });

  it('narrows a sheared circle to the path variant, since only paths express a skewed conic', () => {
    const vectors = readVectors(svg('<g transform="matrix(1 1 0 1 0 0)"><circle cx="30" cy="30" r="10"/></g>'));
    expect(vectors[0]?.kind).toBe('path');
  });

  it('honours a transform attribute on the shape element itself, not only on groups', () => {
    // The write side emits rotation exactly this way -- a transform directly on the rect -- so the reader must apply an element's own transform for its own output to round trip. The rotation comes back through atan2, so 30 degrees carries double-precision dust, not the literal 30.
    const vectors = readVectors(svg('<rect x="10" y="20" width="30" height="10" transform="rotate(30 25 25)"/>'));
    const rotated = vectors[0];
    if (rotated?.kind !== 'rect') {
      throw new Error('expected a rect vector');
    }
    expect(rotated).toMatchObject({ frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 10 } });
    expect(rotated.rotationDeg).toBeCloseTo(30, 9);
  });
});

describe('readSvgContent diagnostics', () => {
  it('names every out-of-scope construct through the diagnostic channel, never a silent drop', () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(svg(`
      <defs><linearGradient id="grad"/></defs>
      <text>Hello</text>
      <image href="x.png"/>
      <use href="#grad"/>
      <rect x="0" y="0" width="10" height="10" fill="url(#grad)"/>
      <foreignObject/>
      <rect x="0" y="0" width="0" height="10"/>
      <rect x="0" y="0" width="10" height="10" fill="currentColor"/>
      <style>.a { fill: red }</style>
      <rect x="0" y="0" width="10" height="10" style="fill: red"/>
      <rect x="0" y="0" width="10" height="10" opacity="0.5"/>
    `), diagnostics);
    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    // A defs block and its gradient definition paint nothing by design -- only the element that references the gradient fires gradient-unsupported, exactly once.
    expect(codes.filter((code) => code === 'svg/gradient-unsupported')).toHaveLength(1);
    for (const code of ['svg/text-unsupported', 'svg/image-unsupported', 'svg/use-unsupported', 'svg/gradient-unsupported', 'svg/element-unsupported', 'svg/element-skipped', 'svg/paint-unsupported', 'svg/css-style-ignored', 'svg/opacity-ignored']) {
      expect(codes).toContain(code);
    }
    expect(codes.filter((code) => code === 'svg/css-style-ignored')).toHaveLength(2);
  });
});

describe('buildSvgText', () => {
  it('writes each vector kind as its own shape element at 1:1 page points', () => {
    const text = buildSvgText(drawingDocument([{ vectors: [
      { kind: 'rect', frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 }, fill: { r: 1, g: 0, b: 0 }, paintOrder: 0 },
      { kind: 'ellipse', frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 }, paintOrder: 1 },
      { kind: 'line', from: { xPt: 0, yPt: 0 }, to: { xPt: 10, yPt: 10 }, stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 }, paintOrder: 2 },
      { kind: 'path', frame: { xPt: 10, yPt: 20, widthPt: 20, heightPt: 20 }, subpaths: [{ start: { xPt: 0, yPt: 0 }, closed: true, segments: [{ kind: 'line', to: { xPt: 20, yPt: 20 } }] }], fill: { r: 1, g: 1, b: 0 }, paintOrder: 3 },
    ] }]));
    expect(text).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="0 0 100 60">');
    expect(text).toContain('<rect x="10" y="20" width="30" height="40" fill="#ff0000"/>');
    // An ellipse without a fill writes fill="none", since an absent fill paints nothing rather than SVG's black default -- which would change the drawing's appearance.
    expect(text).toContain('<ellipse cx="25" cy="40" rx="15" ry="20" fill="none"/>');
    expect(text).toContain('<line x1="0" y1="0" x2="10" y2="10" stroke="#0000ff" stroke-width="1"/>');
    expect(text).toContain('<path d="M10 20 L30 40 Z" fill="#ffff00"/>');
  });

  it('writes the stroke styles, and reports double as solid under a diagnostic', () => {
    const diagnostics: SvgDiagnostic[] = [];
    const text = buildSvgText(drawingDocument([{ vectors: [
      { kind: 'line', from: { xPt: 0, yPt: 0 }, to: { xPt: 10, yPt: 0 }, stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'dashed' }, paintOrder: 0 },
      { kind: 'line', from: { xPt: 0, yPt: 5 }, to: { xPt: 10, yPt: 5 }, stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'dotted' }, paintOrder: 1 },
      { kind: 'line', from: { xPt: 0, yPt: 10 }, to: { xPt: 10, yPt: 10 }, stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: 'double' }, paintOrder: 2 },
    ] }]), { onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    expect(text).toContain('stroke-dasharray="6 4"');
    expect(text).toContain('stroke-dasharray="1 3" stroke-linecap="round"');
    expect(text).not.toContain('stroke-dasharray="double"');
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['svg/stroke-style-unsupported']);
  });

  it('writes rotationDeg as a rotate() transform about the frame\'s own centre', () => {
    const text = buildSvgText(drawingDocument([{ vectors: [{ kind: 'rect', frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 20 }, rotationDeg: 30, paintOrder: 0 }] }]));
    expect(text).toContain('transform="rotate(30 25 30)"');
  });

  it('writes metadata.title as an escaped title element and omits it when absent', () => {
    expect(buildSvgText(drawingDocument([{ vectors: [] }]), undefined)).not.toContain('<title>');
    const titled = buildSvgText(drawingDocument([{ vectors: [] }], 'A & B <drawing>'));
    expect(titled).toContain('<title>A &amp; B &lt;drawing&gt;</title>');
  });

  it('throws SvgUnsupportedDocumentKindError for a non-drawing ContentDocument', () => {
    const wordprocessing: ContentDocument = { kind: 'wordprocessing', metadata: {}, sections: [] };
    expect(() => buildSvgText(wordprocessing)).toThrow(SvgUnsupportedDocumentKindError);
  });

  it('requires a page index for a multi-page document, naming the count, and writes the selected page', () => {
    const document = drawingDocument([
      { vectors: [{ kind: 'rect', frame: { xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 }, paintOrder: 0 }] },
      { vectors: [{ kind: 'rect', frame: { xPt: 50, yPt: 30, widthPt: 5, heightPt: 5 }, paintOrder: 0 }] },
    ]);
    expect(() => buildSvgText(document)).toThrow(SvgMultiPageNotSpecifiedError);
    try {
      buildSvgText(document);
    } catch (error) {
      if (error instanceof SvgMultiPageNotSpecifiedError) {
        expect(error.pageCount).toBe(2);
      }
    }
    expect(buildSvgText(document, { page: 1 })).toContain('<rect x="50" y="30" width="5" height="5"');
  });

  it('throws SvgPageNotFoundError for an out-of-range index and for a document with no pages', () => {
    const document = drawingDocument([{ vectors: [] }]);
    expect(() => buildSvgText(document, { page: 5 })).toThrow(SvgPageNotFoundError);
    const empty: ContentDocument = { kind: 'drawing', metadata: {}, pages: [] };
    expect(() => buildSvgText(empty)).toThrow(SvgPageNotFoundError);
  });

  it('reports draw:frame content through svg/shape-unsupported rather than silently dropping it', () => {
    const diagnostics: SvgDiagnostic[] = [];
    const document: ContentDocument = {
      kind: 'drawing',
      metadata: {},
      pages: [{
        size: { widthPt: 100, heightPt: 60 },
        shapes: [{ name: 'TextBox 1', frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 }, insetLeftPt: 0, insetTopPt: 0, insetRightPt: 0, insetBottomPt: 0, blocks: [] }],
        vectors: [],
      }],
    };
    buildSvgText(document, { onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
    expect(diagnostics).toEqual([{ code: 'svg/shape-unsupported', detail: 'TextBox 1: draw:frame text/image/table content has no SVG vector representation' }]);
  });
});

describe('readSvgContent -> buildSvgText round trip', () => {
  it('round-trips the vector set exactly, rotation included, since write emits a 1:1 viewBox the reader maps through the identity', () => {
    const source = svg(`
      <rect x="10" y="5" width="30" height="20" fill="#ff0000"/>
      <rect x="40" y="5" width="20" height="10" transform="rotate(30 50 10)" fill="#00ff00"/>
      <ellipse cx="30" cy="40" rx="15" ry="10" fill="none" stroke="#0000ff" stroke-width="2"/>
      <line x1="0" y1="0" x2="90" y2="55" stroke="#000000" stroke-dasharray="6 4"/>
      <path d="M 10 10 L 50 10 L 50 30 Z" fill="#ffff00"/>
    `);
    const first = readSvgContent(source);
    const written = buildSvgText(first);
    const second = readSvgContent(written);
    if (first.kind !== 'drawing' || second.kind !== 'drawing') {
      throw new Error('expected drawing ContentDocuments');
    }
    expect(second.pages[0]?.vectors).toEqual(first.pages[0]?.vectors);
    expect(second.pages[0]?.size).toEqual(first.pages[0]?.size);
    expect(second.metadata).toEqual(first.metadata);
  });
});

describe('decodeSvgText / encodeSvgText', () => {
  it('round-trips text through the byte boundary', () => {
    expect(decodeSvgText(encodeSvgText('<svg xmlns="http://www.w3.org/2000/svg">café — ☃</svg>'))).toBe('<svg xmlns="http://www.w3.org/2000/svg">café — ☃</svg>');
  });

  it('throws SvgInvalidUtf8Error on malformed UTF-8 rather than producing U+FFFD replacement characters', () => {
    expect(() => decodeSvgText(new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(SvgInvalidUtf8Error);
  });
});
