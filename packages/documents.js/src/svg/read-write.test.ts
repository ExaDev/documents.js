import { describe, expect, it } from "vitest";
import type { ContentDocument, ContentVector } from "document-schema.js";

import type { SvgDiagnostic } from "./diagnostics";
import { readSvgContent } from "./read";
import { SvgMissingRootElementError } from "./read";
import { buildSvgText } from "./write";
import {
  SvgMultiPageNotSpecifiedError,
  SvgPageNotFoundError,
  SvgUnsupportedDocumentKindError,
} from "./write";
import {
  decodeSvgText,
  encodeSvgText,
  SvgUndecodableTextError,
  SvgUnsupportedEncodingError,
} from "./text";

// The read tests below want an identity root map — width/height in pt equal to the viewBox extents — so every user-unit coordinate lands in the page-point space unchanged and assertions read the SVG's own numbers back.
const IDENTITY_ROOT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="0 0 100 60">';
const svg = (inner: string, root = IDENTITY_ROOT): string =>
  `${root}${inner}</svg>`;

function readVectors(
  text: string,
  diagnostics?: SvgDiagnostic[],
): ContentVector[] {
  const document = readSvgContent(
    text,
    diagnostics === undefined
      ? undefined
      : { onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
  );
  if (document.kind !== "drawing") {
    throw new Error("expected a drawing ContentDocument");
  }
  return document.pages[0]!.vectors;
}

function drawingDocument(
  pages: readonly { readonly vectors: readonly ContentVector[] }[],
  title?: string,
): ContentDocument {
  return {
    kind: "drawing",
    metadata: title === undefined ? {} : { title },
    pages: pages.map((page) => ({
      size: { widthPt: 100, heightPt: 60 },
      shapes: [],
      vectors: [...page.vectors],
    })),
  };
}

describe("readSvgContent", () => {
  it("maps the six shape primitives onto ContentVector kinds", () => {
    const vectors = readVectors(
      svg(`
      <rect x="10" y="10" width="40" height="20" fill="#ff0000"/>
      <circle cx="30" cy="40" r="10"/>
      <ellipse cx="60" cy="40" rx="15" ry="10"/>
      <line x1="0" y1="0" x2="100" y2="60" stroke="#000000"/>
      <polyline points="0,0 10,20 20,0" fill="none" stroke="blue"/>
      <polygon points="30,0 40,20 20,20"/>
    `),
    );
    expect(vectors.map((vector) => vector.kind)).toEqual([
      "rect",
      "ellipse",
      "ellipse",
      "line",
      "path",
      "path",
    ]);
    expect(vectors[0]).toMatchObject({
      kind: "rect",
      frame: { xPt: 10, yPt: 10, widthPt: 40, heightPt: 20 },
      fill: { r: 1, g: 0, b: 0 },
    });
    expect(vectors[1]).toMatchObject({
      kind: "ellipse",
      frame: { xPt: 20, yPt: 30, widthPt: 20, heightPt: 20 },
    });
    expect(vectors[2]).toMatchObject({
      kind: "ellipse",
      frame: { xPt: 45, yPt: 30, widthPt: 30, heightPt: 20 },
    });
    expect(vectors[3]).toMatchObject({
      kind: "line",
      from: { xPt: 0, yPt: 0 },
      to: { xPt: 100, yPt: 60 },
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
    });
    // A polyline is an open path: the frame is the tight box of its points and the subpath carries them rebased into that frame's local space.
    expect(vectors[4]).toMatchObject({
      kind: "path",
      frame: { xPt: 0, yPt: 0, widthPt: 20, heightPt: 20 },
      subpaths: [
        {
          start: { xPt: 0, yPt: 0 },
          closed: false,
          segments: [
            { kind: "line", to: { xPt: 10, yPt: 20 } },
            { kind: "line", to: { xPt: 20, yPt: 0 } },
          ],
        },
      ],
    });
    expect(vectors[5]).toMatchObject({
      kind: "path",
      frame: { xPt: 20, yPt: 0, widthPt: 20, heightPt: 20 },
      subpaths: [
        {
          start: { xPt: 10, yPt: 0 },
          closed: true,
          segments: [
            { kind: "line", to: { xPt: 20, yPt: 20 } },
            { kind: "line", to: { xPt: 0, yPt: 20 } },
          ],
        },
      ],
    });
  });

  it("reads a bare d attribute as a path whose frame is the tight hull of all points including cubic controls", () => {
    const vectors = readVectors(
      svg('<path d="M 10 10 L 90 50" stroke="#0000ff" fill="none"/>'),
    );
    expect(vectors[0]).toMatchObject({
      kind: "path",
      frame: { xPt: 10, yPt: 10, widthPt: 80, heightPt: 40 },
      subpaths: [
        {
          start: { xPt: 0, yPt: 0 },
          closed: false,
          segments: [{ kind: "line", to: { xPt: 80, yPt: 40 } }],
        },
      ],
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 },
    });
  });

  it("builds a rounded rect as a path of four edges and four kappa corners", () => {
    const vectors = readVectors(
      svg('<rect x="10" y="10" width="40" height="20" rx="5"/>'),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    const subpath = vector.subpaths[0];
    expect(subpath?.closed).toBe(true);
    expect(
      subpath?.segments.filter((segment) => segment.kind === "line"),
    ).toHaveLength(4);
    expect(
      subpath?.segments.filter((segment) => segment.kind === "cubic"),
    ).toHaveLength(4);
  });

  it("reads the root title into metadata.title, entity-decoded", () => {
    const document = readSvgContent(
      svg(
        '<title>My &amp; drawing</title><rect x="1" y="1" width="2" height="2"/>',
      ),
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.metadata.title).toBe("My & drawing");
  });

  it("throws SvgMissingRootElementError when no svg root element is present", () => {
    expect(() => readSvgContent("<foo/>")).toThrow(SvgMissingRootElementError);
  });

  it("matches element and attribute names namespace-agnostically", () => {
    const document = readSvgContent(
      '<svg:svg xmlns:svg="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><svg:rect svg:x="10" y="10" width="5" height="5"/></svg:svg>',
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.vectors[0]).toMatchObject({
      kind: "rect",
      frame: { xPt: 10, yPt: 10, widthPt: 5, heightPt: 5 },
    });
  });
});

describe("readSvgContent root geometry", () => {
  it("falls back to the viewBox extents as the page size when width/height are absent, at a 1:1 map", () => {
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><rect x="10" y="10" width="5" height="5"/></svg>',
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 100, heightPt: 60 });
    expect(document.pages[0]?.vectors[0]).toMatchObject({
      frame: { xPt: 10, yPt: 10, widthPt: 5, heightPt: 5 },
    });
  });

  it("scales user units at the exact 0.75pt/px ratio when only width/height size the page", () => {
    // No viewBox: one user unit is one CSS px = 0.75pt, so 40 user units of width become 30pt.
    const vectors = readVectors(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt"><rect x="10" y="10" width="40" height="20"/></svg>',
    );
    expect(vectors[0]).toMatchObject({
      frame: { xPt: 7.5, yPt: 7.5, widthPt: 30, heightPt: 15 },
    });
  });

  it("assumes the CSS default replaced-element size (300x150 px) when nothing sizes the root, and names it", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="10" y="10" width="5" height="5"/></svg>',
      { onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 225, heightPt: 112.5 });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/default-size-assumed",
    );
  });

  it("discards a lone width or height (the CSS intrinsic-sizing rule) and falls to the viewBox", () => {
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" viewBox="0 0 50 25"><rect x="0" y="0" width="10" height="5"/></svg>',
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 50, heightPt: 25 });
    expect(document.pages[0]?.vectors[0]).toMatchObject({
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 5 },
    });
  });

  it("translates a viewBox with a non-zero origin so the viewBox minimum lands at the page origin", () => {
    const vectors = readVectors(
      svg(
        '<rect x="10" y="5" width="40" height="20"/>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="10 5 100 60">',
      ),
    );
    expect(vectors[0]).toMatchObject({
      frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 20 },
    });
  });

  it('stretches a viewBox whose aspect differs from the page, under a diagnostic, and honours preserveAspectRatio="none" silently', () => {
    const diagnostics: SvgDiagnostic[] = [];
    const stretched =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="100pt" viewBox="0 0 100 100">';
    const vectors = readVectors(
      `${stretched}<rect x="0" y="0" width="50" height="50"/></svg>`,
      diagnostics,
    );
    expect(vectors[0]).toMatchObject({
      frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/preserve-aspect-ratio-stretched",
    );
    const silent: SvgDiagnostic[] = [];
    readVectors(
      `${stretched.replace('viewBox="0 0 100 100"', 'viewBox="0 0 100 100" preserveAspectRatio="none"')}<rect x="0" y="0" width="50" height="50"/></svg>`,
      silent,
    );
    expect(silent.map((diagnostic) => diagnostic.code)).not.toContain(
      "svg/preserve-aspect-ratio-stretched",
    );
  });
});

describe("readSvgContent paint", () => {
  it("paints an absent fill black and an absent stroke not at all — SVG's own defaults", () => {
    const vectors = readVectors(
      svg('<rect x="1" y="1" width="5" height="5"/>'),
    );
    expect(vectors[0]).toMatchObject({ fill: { r: 0, g: 0, b: 0 } });
    expect(vectors[0]?.stroke).toBeUndefined();
  });

  it('unpaints fill="none" and keeps the element only when a stroke paints it', () => {
    const diagnostics: SvgDiagnostic[] = [];
    const vectors = readVectors(
      svg(
        '<rect x="1" y="1" width="5" height="5" fill="none" stroke="blue"/><rect x="1" y="1" width="5" height="5" fill="none"/>',
      ),
      diagnostics,
    );
    expect(vectors).toHaveLength(1);
    const kept = vectors[0];
    if (kept?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(kept.fill).toBeUndefined();
    expect(kept).toMatchObject({
      stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 },
    });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/element-skipped",
    );
  });

  it("inherits presentation attributes from groups, with the child's own value winning", () => {
    const vectors = readVectors(
      svg(
        '<g fill="red"><rect x="0" y="0" width="5" height="5"/><rect x="10" y="0" width="5" height="5" fill="blue"/></g>',
      ),
    );
    expect(vectors[0]).toMatchObject({ fill: { r: 1, g: 0, b: 0 } });
    expect(vectors[1]).toMatchObject({ fill: { r: 0, g: 0, b: 1 } });
  });

  it("scales stroke width by the CTM's mean scale and carries dash styles onto the stroke enum", () => {
    const vectors = readVectors(
      svg(
        '<g transform="scale(2)" stroke-width="2" stroke-dasharray="6 4" fill="none" stroke="black"><line x1="0" y1="0" x2="10" y2="0"/></g>',
      ),
    );
    expect(vectors[0]?.stroke).toMatchObject({ widthPt: 4, style: "dashed" });
    const dotted = readVectors(
      svg(
        '<line x1="0" y1="0" x2="10" y2="0" fill="none" stroke="black" stroke-dasharray="1 3"/>',
      ),
    );
    expect(dotted[0]?.stroke).toMatchObject({ style: "dotted" });
  });
});

describe("readSvgContent transforms", () => {
  it("composes group transforms with the viewBox map into every coordinate", () => {
    const vectors = readVectors(
      svg(
        '<g transform="translate(10,5)"><rect x="0" y="0" width="10" height="10"/></g>',
      ),
    );
    expect(vectors[0]).toMatchObject({
      frame: { xPt: 10, yPt: 5, widthPt: 10, heightPt: 10 },
    });
  });

  it("emits a rotated rect as the scaled pre-rotation box centred on the transformed centre, plus rotationDeg", () => {
    // rotate(90) moves the box centre (20,5) to (-5,20); the frame is the 20x10 pre-rotation box centred there, and the renderer\'s own rotation about that centre lands on the true corners.
    const vectors = readVectors(
      svg(
        '<g transform="rotate(90)"><rect x="10" y="0" width="20" height="10"/></g>',
      ),
    );
    expect(vectors[0]).toMatchObject({
      kind: "rect",
      frame: { xPt: -15, yPt: 15, widthPt: 20, heightPt: 10 },
      rotationDeg: 90,
    });
  });

  it("narrows a sheared circle to the path variant, since only paths express a skewed conic", () => {
    const vectors = readVectors(
      svg(
        '<g transform="matrix(1 1 0 1 0 0)"><circle cx="30" cy="30" r="10"/></g>',
      ),
    );
    expect(vectors[0]?.kind).toBe("path");
  });

  it("honours a transform attribute on the shape element itself, not only on groups", () => {
    // The write side emits rotation exactly this way — a transform directly on the rect — so the reader must apply an element's own transform for its own output to round trip. The rotation comes back through atan2, so 30 degrees carries double-precision dust, not the literal 30.
    const vectors = readVectors(
      svg(
        '<rect x="10" y="20" width="30" height="10" transform="rotate(30 25 25)"/>',
      ),
    );
    const rotated = vectors[0];
    if (rotated?.kind !== "rect") {
      throw new Error("expected a rect vector");
    }
    expect(rotated).toMatchObject({
      frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 10 },
    });
    expect(rotated.rotationDeg).toBeCloseTo(30, 9);
  });
});

describe("readSvgContent diagnostics", () => {
  it("names every out-of-scope construct through the diagnostic channel, never a silent drop", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg(`
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
    `),
      diagnostics,
    );
    const codes = diagnostics.map((diagnostic) => diagnostic.code);
    // A defs block and its gradient definition paint nothing by design — only the element that references the gradient fires gradient-unsupported, exactly once.
    expect(
      codes.filter((code) => code === "svg/gradient-unsupported"),
    ).toHaveLength(1);
    for (const code of [
      "svg/text-unsupported",
      "svg/image-unsupported",
      "svg/use-unsupported",
      "svg/gradient-unsupported",
      "svg/element-unsupported",
      "svg/element-skipped",
      "svg/paint-unsupported",
      "svg/css-style-ignored",
      "svg/opacity-ignored",
    ]) {
      expect(codes).toContain(code);
    }
    expect(
      codes.filter((code) => code === "svg/css-style-ignored"),
    ).toHaveLength(2);
  });
});

describe("readSvgContent error and helper details", () => {
  it("gives SvgMissingRootElementError its own real message and name, not a placeholder", () => {
    const error = new SvgMissingRootElementError();
    expect(error.message).toBe("svg text must contain an <svg> root element");
    expect(error.name).toBe("SvgMissingRootElementError");
  });

  it("slices a namespaced tag exactly after its own colon", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(svg("<xlink:foo/>"), diagnostics);
    expect(diagnostics[0]).toMatchObject({
      code: "svg/element-unsupported",
      detail: "foo",
    });
  });

  it("carries a group's fill-rule down to a child only when the child doesn't set its own", () => {
    const vectors = readVectors(
      svg(
        '<g fill-rule="evenodd"><path d="M0,0 L10,0 L10,10 L0,10 Z"/><path d="M0,0 L10,0 L10,10 L0,10 Z" fill-rule="nonzero"/></g>',
      ),
    );
    expect(vectors[0]).toMatchObject({ fillRule: "evenodd" });
    expect(vectors[1]).not.toHaveProperty("fillRule");
  });
});

describe("readSvgContent paintOrder and sourcePath", () => {
  it("assigns increasing paintOrder and a positional sourcePath across every vector kind", () => {
    const vectors = readVectors(
      svg(`
      <rect x="0" y="0" width="5" height="5"/>
      <circle cx="10" cy="10" r="3"/>
      <line x1="0" y1="0" x2="5" y2="5" stroke="black"/>
      <path d="M0,0 L5,5"/>
    `),
    );
    expect(vectors.map((vector) => vector.paintOrder)).toEqual([0, 1, 2, 3]);
    expect(vectors.map((vector) => vector.sourcePath)).toEqual([
      "svg/vector[0]",
      "svg/vector[1]",
      "svg/vector[2]",
      "svg/vector[3]",
    ]);
  });
});

describe("readSvgContent stroke width", () => {
  it("drops a stroke whose scaled width is exactly zero, but keeps one that's barely positive", () => {
    const zero = readVectors(
      svg(
        '<rect x="0" y="0" width="5" height="5" fill="none" stroke="black" stroke-width="0"/>',
      ),
    );
    expect(zero[0]?.stroke).toBeUndefined();
    const barelyPositive = readVectors(
      svg(
        '<rect x="0" y="0" width="5" height="5" fill="none" stroke="black" stroke-width="0.001"/>',
      ),
    );
    expect(barelyPositive[0]?.stroke).toBeDefined();
  });
});

describe("readSvgContent path frame and rebasing", () => {
  it("keeps an open path whose frame collapses on only one axis, not both", () => {
    // A vertical path has widthPt === 0 but heightPt > 0 — the drop check requires BOTH to be zero, matching a genuinely single-point path, not a straight line.
    const vertical = readVectors(
      svg('<path d="M5,5 L5,20" stroke="black" fill="none"/>'),
    );
    expect(vertical).toHaveLength(1);
    const horizontal = readVectors(
      svg('<path d="M5,5 L20,5" stroke="black" fill="none"/>'),
    );
    expect(horizontal).toHaveLength(1);
    const singlePoint = readVectors(svg('<path d="M5,5" stroke="black"/>'));
    expect(singlePoint).toHaveLength(0);
  });

  it("rebases a cubic segment's control points and endpoint into the frame's own local space by subtraction, not addition", () => {
    const vectors = readVectors(
      svg(
        '<path d="M30,40 L60,40 C70,20 90,20 100,40" fill="none" stroke="black"/>',
      ),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.frame).toEqual({
      xPt: 30,
      yPt: 20,
      widthPt: 70,
      heightPt: 20,
    });
    expect(vector.subpaths[0]?.segments[1]).toMatchObject({
      kind: "cubic",
      control1: { xPt: 40, yPt: 0 },
      control2: { xPt: 60, yPt: 0 },
      to: { xPt: 70, yPt: 20 },
    });
  });
});

describe("readSvgContent rounded rect geometry", () => {
  it("places every edge and kappa corner of an asymmetric rounded rect at its own exact coordinate", () => {
    const KAPPA = (4 / 3) * (Math.SQRT2 - 1);
    const x = 10;
    const y = 20;
    const width = 50;
    const height = 30;
    const rx = 8;
    const ry = 5;
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;

    const vectors = readVectors(
      svg(
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ry="${ry}"/>`,
      ),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    // The frame is the tight bound of the four straight edges plus the four rounded corners, so its own origin is exactly the rect's own (x, y) and its extent the rect's own (width, height) — every rebased point below is relative to that.
    expect(vector.frame).toEqual({
      xPt: x,
      yPt: y,
      widthPt: width,
      heightPt: height,
    });
    const subpath = vector.subpaths[0];
    if (subpath === undefined) {
      throw new Error("expected a subpath");
    }
    expect(subpath.closed).toBe(true);
    expect(subpath.start).toEqual({ xPt: rx, yPt: 0 });
    const segments = subpath.segments;
    // Exact edge/endpoint coordinates first — these involve no KAPPA arithmetic, so plain equality applies.
    expect(segments[0]).toMatchObject({
      kind: "line",
      to: { xPt: width - rx, yPt: 0 },
    });
    expect(segments[1]).toMatchObject({
      kind: "cubic",
      control1: { yPt: 0 },
      to: { xPt: width, yPt: ry },
    });
    expect(segments[2]).toMatchObject({
      kind: "line",
      to: { xPt: width, yPt: height - ry },
    });
    expect(segments[3]).toMatchObject({
      kind: "cubic",
      to: { xPt: width - rx, yPt: height },
    });
    expect(segments[4]).toMatchObject({
      kind: "line",
      to: { xPt: rx, yPt: height },
    });
    expect(segments[5]).toMatchObject({
      kind: "cubic",
      to: { xPt: 0, yPt: height - ry },
    });
    expect(segments[6]).toMatchObject({
      kind: "line",
      to: { xPt: 0, yPt: ry },
    });
    expect(segments[7]).toMatchObject({
      kind: "cubic",
      control2: { yPt: 0 },
      to: { xPt: rx, yPt: 0 },
    });
    // The kappa-derived control-point coordinates, each checked against the independently-computed kx/ky, catching every sign flip and every variable substitution (x for width, radiusX for radiusY, and so on) across the eight corners.
    const cubic1 = segments[1];
    const cubic3 = segments[3];
    const cubic5 = segments[5];
    const cubic7 = segments[7];
    if (
      cubic1?.kind !== "cubic" ||
      cubic3?.kind !== "cubic" ||
      cubic5?.kind !== "cubic" ||
      cubic7?.kind !== "cubic"
    ) {
      throw new Error("expected four cubic segments");
    }
    expect(cubic1.control1.xPt).toBeCloseTo(width - rx + kx, 9);
    expect(cubic1.control2.xPt).toBe(width);
    expect(cubic1.control2.yPt).toBeCloseTo(ry - ky, 9);
    expect(cubic3.control1.xPt).toBe(width);
    expect(cubic3.control1.yPt).toBeCloseTo(height - ry + ky, 9);
    expect(cubic3.control2.xPt).toBeCloseTo(width - rx + kx, 9);
    expect(cubic3.control2.yPt).toBe(height);
    expect(cubic5.control1.xPt).toBeCloseTo(rx - kx, 9);
    expect(cubic5.control1.yPt).toBe(height);
    expect(cubic5.control2.xPt).toBe(0);
    expect(cubic5.control2.yPt).toBeCloseTo(height - ry + ky, 9);
    expect(cubic7.control1.xPt).toBe(0);
    expect(cubic7.control1.yPt).toBeCloseTo(ry - ky, 9);
    expect(cubic7.control2.xPt).toBeCloseTo(rx - kx, 9);
  });

  it("clamps each radius to half its own side, independently, when the radius would otherwise overrun a short rect", () => {
    // width=20 clamps radiusX to 10 (half-width); height=6 clamps radiusY to 3 (half-height) — independent clamps, since a single shared clamp would let one radius overrun its own axis.
    const vectors = readVectors(
      svg('<rect x="0" y="0" width="20" height="6" rx="15" ry="15"/>'),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    expect(vector.subpaths[0]?.start).toEqual({ xPt: 10, yPt: 0 });
    expect(vector.subpaths[0]?.segments[0]).toMatchObject({
      kind: "line",
      to: { xPt: 10, yPt: 0 },
    });
  });
});

describe("readSvgContent ellipse-as-path geometry", () => {
  it("places every cardinal point and kappa control of a sheared ellipse's path at its own exact coordinate", () => {
    // matrix(1,0.5,0,1,0,0): x' = x, y' = 0.5x + y — x is untouched by the shear, so every rebased local x below is exactly (original local ellipse x) - (cx - rx), independent of the shear itself, while y still needs the full transform.
    const KAPPA = (4 / 3) * (Math.SQRT2 - 1);
    const cx = 20;
    const cy = 10;
    const rx = 8;
    const ry = 4;
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;
    // Every point the algorithm places, in local (pre-transform) ellipse space, named by its position on the circle.
    const east = { x: cx + rx, y: cy };
    const eastKappaTop = { x: cx + rx, y: cy + ky };
    const northKappaEast = { x: cx + kx, y: cy + ry };
    const north = { x: cx, y: cy + ry };
    const northKappaWest = { x: cx - kx, y: cy + ry };
    const westKappaTop = { x: cx - rx, y: cy + ky };
    const west = { x: cx - rx, y: cy };
    const westKappaBottom = { x: cx - rx, y: cy - ky };
    const southKappaWest = { x: cx - kx, y: cy - ry };
    const south = { x: cx, y: cy - ry };
    const southKappaEast = { x: cx + kx, y: cy - ry };
    const eastKappaBottom = { x: cx + rx, y: cy - ky };
    const allPoints = [
      east,
      eastKappaTop,
      northKappaEast,
      north,
      northKappaWest,
      westKappaTop,
      west,
      westKappaBottom,
      southKappaWest,
      south,
      southKappaEast,
      eastKappaBottom,
    ];
    const shearedY = (point: { x: number; y: number }) =>
      0.5 * point.x + point.y;
    // x is untouched by this shear (x' = x), so the frame's own x-origin is just the local minimum x; the y-origin needs the full sheared value at every point, not just the geometrically extreme ones, since the shear can make an off-axis point the new extreme.
    const frameXPt = Math.min(...allPoints.map((point) => point.x));
    const frameYPt = Math.min(...allPoints.map(shearedY));
    const local = (point: { x: number; y: number }) => ({
      xPt: point.x - frameXPt,
      yPt: shearedY(point) - frameYPt,
    });

    const vectors = readVectors(
      svg(
        `<g transform="matrix(1 0.5 0 1 0 0)"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></g>`,
      ),
    );
    const vector = vectors[0];
    if (vector?.kind !== "path") {
      throw new Error("expected a path vector");
    }
    const subpath = vector.subpaths[0];
    if (subpath === undefined) {
      throw new Error("expected a subpath");
    }
    expect(subpath.start).toMatchObject(local(east));
    const segments = subpath.segments;
    expect(segments[0]).toMatchObject({
      kind: "cubic",
      control1: local(eastKappaTop),
      control2: local(northKappaEast),
      to: local(north),
    });
    expect(segments[1]).toMatchObject({
      kind: "cubic",
      control1: local(northKappaWest),
      control2: local(westKappaTop),
      to: local(west),
    });
    expect(segments[2]).toMatchObject({
      kind: "cubic",
      control1: local(westKappaBottom),
      control2: local(southKappaWest),
      to: local(south),
    });
    expect(segments[3]).toMatchObject({
      kind: "cubic",
      control1: local(southKappaEast),
      control2: local(eastKappaBottom),
      to: local(east),
    });
  });
});

describe("readSvgContent rect/circle/ellipse fill and size handling", () => {
  it("skips a rect when either width or height alone is non-positive, not only when both are", () => {
    expect(
      readVectors(svg('<rect x="0" y="0" width="0" height="10"/>')),
    ).toHaveLength(0);
    expect(
      readVectors(svg('<rect x="0" y="0" width="10" height="0"/>')),
    ).toHaveLength(0);
    expect(
      readVectors(svg('<rect x="0" y="0" width="-5" height="10"/>')),
    ).toHaveLength(0);
    expect(
      readVectors(svg('<rect x="0" y="0" width="0.5" height="0.5"/>')),
    ).toHaveLength(1);
  });

  it("takes the rounded-rect path when either radius alone is positive, not only when both are", () => {
    const onlyRxPositive = readVectors(
      svg('<rect x="0" y="0" width="20" height="20" rx="4" ry="0"/>'),
    );
    expect(onlyRxPositive[0]?.kind).toBe("path");
    const onlyRyPositive = readVectors(
      svg('<rect x="0" y="0" width="20" height="20" rx="0" ry="4"/>'),
    );
    expect(onlyRyPositive[0]?.kind).toBe("path");
    const neitherPositive = readVectors(
      svg('<rect x="0" y="0" width="20" height="20" rx="0" ry="0"/>'),
    );
    expect(neitherPositive[0]?.kind).toBe("rect");
  });

  it("skips a plain rect's rotated frame when the transform collapses only its width, or only its height", () => {
    expect(
      readVectors(
        svg(
          '<g transform="scale(0,1)"><rect x="0" y="0" width="10" height="10"/></g>',
        ),
      ),
    ).toHaveLength(0);
    expect(
      readVectors(
        svg(
          '<g transform="scale(1,0)"><rect x="0" y="0" width="10" height="10"/></g>',
        ),
      ),
    ).toHaveLength(0);
  });

  it("omits a rect's fill key when unpainted by fill, and its stroke key when unpainted by stroke", () => {
    const strokedOnly = readVectors(
      svg(
        '<rect x="0" y="0" width="5" height="5" fill="none" stroke="black"/>',
      ),
    );
    expect(strokedOnly[0]).not.toHaveProperty("fill");
    expect(strokedOnly[0]).toHaveProperty("stroke");
    const filledOnly = readVectors(
      svg('<rect x="0" y="0" width="5" height="5" fill="red"/>'),
    );
    expect(filledOnly[0]).toHaveProperty("fill");
    expect(filledOnly[0]).not.toHaveProperty("stroke");
  });

  it("skips a circle or ellipse when either radius alone is non-positive", () => {
    expect(readVectors(svg('<circle cx="10" cy="10" r="0"/>'))).toHaveLength(0);
    expect(readVectors(svg('<circle cx="10" cy="10" r="-2"/>'))).toHaveLength(
      0,
    );
    expect(
      readVectors(svg('<ellipse cx="10" cy="10" rx="0" ry="5"/>')),
    ).toHaveLength(0);
    expect(
      readVectors(svg('<ellipse cx="10" cy="10" rx="5" ry="0"/>')),
    ).toHaveLength(0);
  });

  it("omits an ellipse's fill key when unpainted by fill, and its stroke key when unpainted by stroke", () => {
    const strokedOnly = readVectors(
      svg('<circle cx="10" cy="10" r="5" fill="none" stroke="black"/>'),
    );
    expect(strokedOnly[0]).not.toHaveProperty("fill");
    expect(strokedOnly[0]).toHaveProperty("stroke");
    const filledOnly = readVectors(
      svg('<circle cx="10" cy="10" r="5" fill="blue"/>'),
    );
    expect(filledOnly[0]).toHaveProperty("fill");
    expect(filledOnly[0]).not.toHaveProperty("stroke");
  });

  it("skips an ellipse's rotated frame only when the transform collapses its own width or height, and takes the axis-aligned branch (not the similarity one) when the CTM has no rotation", () => {
    expect(
      readVectors(
        svg('<g transform="scale(0,1)"><circle cx="10" cy="10" r="5"/></g>'),
      ),
    ).toHaveLength(0);
    expect(
      readVectors(
        svg('<g transform="scale(1,0)"><circle cx="10" cy="10" r="5"/></g>'),
      ),
    ).toHaveLength(0);
    const axisAligned = readVectors(
      svg('<g transform="scale(2)"><circle cx="10" cy="10" r="5"/></g>'),
    );
    expect(axisAligned[0]).toMatchObject({
      kind: "ellipse",
      frame: { xPt: 10, yPt: 10, widthPt: 20, heightPt: 20 },
    });
    expect(axisAligned[0]).not.toHaveProperty("rotationDeg");
  });
});

describe("readSvgContent line endpoints and zero-length skip", () => {
  it("reads a line's endpoints from their own named attributes, not a placeholder that always defaults to zero", () => {
    const vectors = readVectors(
      svg('<line x1="3" y1="4" x2="30" y2="40" stroke="black"/>'),
    );
    expect(vectors[0]).toMatchObject({
      from: { xPt: 3, yPt: 4 },
      to: { xPt: 30, yPt: 40 },
    });
  });

  it("skips a truly zero-length line", () => {
    const vectors = readVectors(
      svg('<line x1="5" y1="5" x2="5" y2="5" stroke="black"/>'),
    );
    expect(vectors).toHaveLength(0);
  });

  it("keeps a line whose endpoints share only one coordinate, since it still has length on the other axis", () => {
    const sameX = readVectors(
      svg('<line x1="5" y1="5" x2="5" y2="20" stroke="black"/>'),
    );
    expect(sameX).toHaveLength(1);
    const sameY = readVectors(
      svg('<line x1="5" y1="5" x2="20" y2="5" stroke="black"/>'),
    );
    expect(sameY).toHaveLength(1);
  });
});

describe("readSvgContent polyline/polygon points parsing", () => {
  it("parses a points attribute via a real numeric split, not a placeholder that skips the element", () => {
    const vectors = readVectors(
      svg('<polyline points="0,0 10,20 20,0" fill="none" stroke="blue"/>'),
    );
    expect(vectors[0]).toMatchObject({
      kind: "path",
      subpaths: [
        {
          closed: false,
          segments: [{ to: { xPt: 10, yPt: 20 } }, { to: { xPt: 20, yPt: 0 } }],
        },
      ],
    });
  });

  it("closes a polygon but leaves a polyline open, over the same point list", () => {
    const polygon = readVectors(svg('<polygon points="0,0 10,0 10,10"/>'));
    expect(polygon[0]).toMatchObject({
      kind: "path",
      subpaths: [{ closed: true }],
    });
    const polyline = readVectors(
      svg('<polyline points="0,0 10,0 10,10" fill="none" stroke="black"/>'),
    );
    expect(polyline[0]).toMatchObject({
      kind: "path",
      subpaths: [{ closed: false }],
    });
  });

  it("reports a points list with an odd count of numbers, or a non-finite number, as malformed rather than truncating it", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(svg('<polygon points="0,0 10,0 10"/>'), diagnostics);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/element-unsupported",
    );
    const nonFinite: SvgDiagnostic[] = [];
    readVectors(svg('<polygon points="0,0 10,abc 10,10"/>'), nonFinite);
    expect(nonFinite.map((diagnostic) => diagnostic.code)).toContain(
      "svg/element-unsupported",
    );
  });

  it("skips a points list with fewer than two points, distinctly from a malformed one", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const vectors = readVectors(svg('<polygon points="5,5"/>'), diagnostics);
    expect(vectors).toHaveLength(0);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/element-skipped",
    );
  });
});

describe("readSvgContent path element edge cases", () => {
  it("skips a path with no d attribute, or one that is empty after trimming", () => {
    const diagnostics: SvgDiagnostic[] = [];
    expect(readVectors(svg("<path/>"), diagnostics)).toHaveLength(0);
    expect(readVectors(svg('<path d="   "/>'), diagnostics)).toHaveLength(0);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "svg/element-skipped",
      "svg/element-skipped",
    ]);
  });

  it("reports genuinely malformed path data distinctly from an absent d attribute", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(svg('<path d="not path data at all !!"/>'), diagnostics);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/element-unsupported",
    );
  });
});

describe("readSvgContent opacity diagnostics", () => {
  it("names each of opacity, fill-opacity, and stroke-opacity independently when below 1, and stays silent at or above 1", () => {
    const opacity: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" opacity="0.5"/>'),
      opacity,
    );
    expect(opacity.map((diagnostic) => diagnostic.detail)).toContain(
      "rect: opacity=0.5",
    );
    const fillOpacity: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" fill-opacity="0.5"/>'),
      fillOpacity,
    );
    expect(fillOpacity.map((diagnostic) => diagnostic.detail)).toContain(
      "rect: fill-opacity=0.5",
    );
    const strokeOpacity: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" stroke-opacity="0.5"/>'),
      strokeOpacity,
    );
    expect(strokeOpacity.map((diagnostic) => diagnostic.detail)).toContain(
      "rect: stroke-opacity=0.5",
    );
    const atOne: SvgDiagnostic[] = [];
    readVectors(
      svg('<rect x="0" y="0" width="5" height="5" opacity="1"/>'),
      atOne,
    );
    expect(atOne.map((diagnostic) => diagnostic.code)).not.toContain(
      "svg/opacity-ignored",
    );
  });
});

describe("readSvgContent group and unsupported-element dispatch", () => {
  it("walks both a <g> and an <a> element's children the same way, applying their own transform", () => {
    const group = readVectors(
      svg(
        '<g transform="translate(5,5)"><rect x="0" y="0" width="2" height="2"/></g>',
      ),
    );
    expect(group[0]).toMatchObject({ frame: { xPt: 5, yPt: 5 } });
    const anchor = readVectors(
      svg(
        '<a transform="translate(5,5)"><rect x="0" y="0" width="2" height="2"/></a>',
      ),
    );
    expect(anchor[0]).toMatchObject({ frame: { xPt: 5, yPt: 5 } });
  });

  it("walks past a non-rendering element's children silently, and reports an element it doesn't know at all", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      svg(
        '<clipPath id="c"><rect x="0" y="0" width="5" height="5"/></clipPath><foreignObject/>',
      ),
      diagnostics,
    );
    // The rect inside clipPath is never walked, so it produces no vector and no diagnostic of its own — only foreignObject's own unsupported report appears.
    expect(diagnostics).toEqual([
      { code: "svg/element-unsupported", detail: "foreignObject" },
    ]);
  });

  it("names each text-family element (tspan, textPath, tref) as unsupported, not only the bare text element", () => {
    for (const tag of ["tspan", "textPath", "tref"]) {
      const diagnostics: SvgDiagnostic[] = [];
      readVectors(svg(`<${tag}/>`), diagnostics);
      expect(diagnostics).toEqual([
        { code: "svg/text-unsupported", detail: tag },
      ]);
    }
  });
});

describe("readSvgContent root geometry boundaries", () => {
  it("ignores a viewBox whose width or height is exactly zero or negative, falling to the CSS default size", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 60"><rect x="0" y="0" width="5" height="5"/></svg>',
      { onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 225, heightPt: 112.5 });
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/default-size-assumed",
    );
  });

  it("discards a zero or negative width/height attribute the same way it discards an absent one", () => {
    const document = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="0pt" height="-5pt" viewBox="0 0 50 25"><rect x="0" y="0" width="10" height="5"/></svg>',
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.pages[0]?.size).toEqual({ widthPt: 50, heightPt: 25 });
  });

  it("discards width alone or height alone even when the other is present and positive, per the CSS intrinsic-sizing rule", () => {
    const widthOnly = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" viewBox="0 0 40 20"><rect x="0" y="0" width="5" height="5"/></svg>',
    );
    if (widthOnly.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(widthOnly.pages[0]?.size).toEqual({ widthPt: 40, heightPt: 20 });
    const heightOnly = readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg" height="60pt" viewBox="0 0 40 20"><rect x="0" y="0" width="5" height="5"/></svg>',
    );
    if (heightOnly.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(heightOnly.pages[0]?.size).toEqual({ widthPt: 40, heightPt: 20 });
  });

  it("names the CSS default replaced-element size assumption with its own explanatory detail text", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readSvgContent(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="5" height="5"/></svg>',
      {
        onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      },
    );
    expect(diagnostics[0]).toMatchObject({
      code: "svg/default-size-assumed",
      detail:
        "neither width/height nor a usable viewBox was present; assuming the CSS default replaced-element size of 300x150 px",
    });
  });

  it("defaults preserveAspectRatio to 'xMidYMid meet' when absent, still firing the stretched diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    readVectors(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="100pt" viewBox="0 0 100 100"><rect x="0" y="0" width="50" height="50"/></svg>',
      diagnostics,
    );
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "svg/preserve-aspect-ratio-stretched",
    );
  });

  it("scales a non-zero viewBox origin into the page map by the same per-axis factor as the extents", () => {
    const vectors = readVectors(
      svg(
        '<rect x="10" y="5" width="20" height="10"/>',
        '<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="120pt" viewBox="10 5 100 60">',
      ),
    );
    // sx = 200/100 = 2, sy = 120/60 = 2; the rect sits exactly at the viewBox origin, so it must map to page (0,0), which only holds if the translation term is -origin * scale (2*10 + -10*2 = 0) rather than -origin / scale (2*10 + -10/2 = 15).
    expect(vectors[0]).toMatchObject({
      frame: { xPt: 0, yPt: 0, widthPt: 40, heightPt: 20 },
    });
  });
});

describe("readSvgContent title metadata", () => {
  it("omits metadata.title entirely when no title element is present, rather than an empty string", () => {
    const document = readSvgContent(
      svg('<rect x="0" y="0" width="5" height="5"/>'),
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.metadata).not.toHaveProperty("title");
  });

  it("omits metadata.title when the title element is present but empty after trimming", () => {
    const document = readSvgContent(
      svg('<title>   </title><rect x="0" y="0" width="5" height="5"/>'),
    );
    if (document.kind !== "drawing") {
      throw new Error("expected a drawing ContentDocument");
    }
    expect(document.metadata).not.toHaveProperty("title");
  });
});

describe("buildSvgText", () => {
  it("writes each vector kind as its own shape element at 1:1 page points", () => {
    const text = buildSvgText(
      drawingDocument([
        {
          vectors: [
            {
              kind: "rect",
              frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 },
              fill: { r: 1, g: 0, b: 0 },
              paintOrder: 0,
            },
            {
              kind: "ellipse",
              frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 40 },
              paintOrder: 1,
            },
            {
              kind: "line",
              from: { xPt: 0, yPt: 0 },
              to: { xPt: 10, yPt: 10 },
              stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 1 },
              paintOrder: 2,
            },
            {
              kind: "path",
              frame: { xPt: 10, yPt: 20, widthPt: 20, heightPt: 20 },
              subpaths: [
                {
                  start: { xPt: 0, yPt: 0 },
                  closed: true,
                  segments: [{ kind: "line", to: { xPt: 20, yPt: 20 } }],
                },
              ],
              fill: { r: 1, g: 1, b: 0 },
              paintOrder: 3,
            },
          ],
        },
      ]),
    );
    expect(text).toContain(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="60pt" viewBox="0 0 100 60">',
    );
    expect(text).toContain(
      '<rect x="10" y="20" width="30" height="40" fill="#ff0000"/>',
    );
    // An ellipse without a fill writes fill="none", since an absent fill paints nothing rather than SVG's black default — which would change the drawing's appearance.
    expect(text).toContain(
      '<ellipse cx="25" cy="40" rx="15" ry="20" fill="none"/>',
    );
    expect(text).toContain(
      '<line x1="0" y1="0" x2="10" y2="10" stroke="#0000ff" stroke-width="1"/>',
    );
    expect(text).toContain('<path d="M10 20 L30 40 Z" fill="#ffff00"/>');
  });

  it("writes the stroke styles, and reports double as solid under a diagnostic", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const text = buildSvgText(
      drawingDocument([
        {
          vectors: [
            {
              kind: "line",
              from: { xPt: 0, yPt: 0 },
              to: { xPt: 10, yPt: 0 },
              stroke: {
                color: { r: 0, g: 0, b: 0 },
                widthPt: 1,
                style: "dashed",
              },
              paintOrder: 0,
            },
            {
              kind: "line",
              from: { xPt: 0, yPt: 5 },
              to: { xPt: 10, yPt: 5 },
              stroke: {
                color: { r: 0, g: 0, b: 0 },
                widthPt: 1,
                style: "dotted",
              },
              paintOrder: 1,
            },
            {
              kind: "line",
              from: { xPt: 0, yPt: 10 },
              to: { xPt: 10, yPt: 10 },
              stroke: {
                color: { r: 0, g: 0, b: 0 },
                widthPt: 1,
                style: "double",
              },
              paintOrder: 2,
            },
          ],
        },
      ]),
      { onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic) },
    );
    expect(text).toContain('stroke-dasharray="6 4"');
    expect(text).toContain('stroke-dasharray="1 3" stroke-linecap="round"');
    expect(text).not.toContain('stroke-dasharray="double"');
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "svg/stroke-style-unsupported",
    ]);
  });

  it("writes rotationDeg as a rotate() transform about the frame's own centre", () => {
    const text = buildSvgText(
      drawingDocument([
        {
          vectors: [
            {
              kind: "rect",
              frame: { xPt: 10, yPt: 20, widthPt: 30, heightPt: 20 },
              rotationDeg: 30,
              paintOrder: 0,
            },
          ],
        },
      ]),
    );
    expect(text).toContain('transform="rotate(30 25 30)"');
  });

  it("writes metadata.title as an escaped title element and omits it when absent", () => {
    expect(
      buildSvgText(drawingDocument([{ vectors: [] }]), undefined),
    ).not.toContain("<title>");
    const titled = buildSvgText(
      drawingDocument([{ vectors: [] }], "A & B <drawing>"),
    );
    expect(titled).toContain("<title>A &amp; B &lt;drawing&gt;</title>");
  });

  it("throws SvgUnsupportedDocumentKindError for a non-drawing ContentDocument", () => {
    const wordprocessing: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    expect(() => buildSvgText(wordprocessing)).toThrow(
      SvgUnsupportedDocumentKindError,
    );
  });

  it("requires a page index for a multi-page document, naming the count, and writes the selected page", () => {
    const document = drawingDocument([
      {
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 },
            paintOrder: 0,
          },
        ],
      },
      {
        vectors: [
          {
            kind: "rect",
            frame: { xPt: 50, yPt: 30, widthPt: 5, heightPt: 5 },
            paintOrder: 0,
          },
        ],
      },
    ]);
    expect(() => buildSvgText(document)).toThrow(SvgMultiPageNotSpecifiedError);
    try {
      buildSvgText(document);
    } catch (error) {
      if (error instanceof SvgMultiPageNotSpecifiedError) {
        expect(error.pageCount).toBe(2);
      }
    }
    expect(buildSvgText(document, { page: 1 })).toContain(
      '<rect x="50" y="30" width="5" height="5"',
    );
  });

  it("throws SvgPageNotFoundError for an out-of-range index and for a document with no pages", () => {
    const document = drawingDocument([{ vectors: [] }]);
    expect(() => buildSvgText(document, { page: 5 })).toThrow(
      SvgPageNotFoundError,
    );
    const empty: ContentDocument = { kind: "drawing", metadata: {}, pages: [] };
    expect(() => buildSvgText(empty)).toThrow(SvgPageNotFoundError);
  });

  it("reports draw:frame content through svg/shape-unsupported rather than silently dropping it", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const document: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 100, heightPt: 60 },
          shapes: [
            {
              name: "TextBox 1",
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [],
            },
          ],
          vectors: [],
        },
      ],
    };
    buildSvgText(document, {
      onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(diagnostics).toEqual([
      {
        code: "svg/shape-unsupported",
        detail:
          "TextBox 1: draw:frame text/image/table content has no SVG vector representation",
      },
    ]);
  });

  it("falls back to the literal 'shape' when a diagnostic's own shape has neither a name nor a sourcePath", () => {
    const diagnostics: SvgDiagnostic[] = [];
    const document: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 100, heightPt: 60 },
          shapes: [
            {
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              insetLeftPt: 0,
              insetTopPt: 0,
              insetRightPt: 0,
              insetBottomPt: 0,
              blocks: [],
            },
          ],
          vectors: [],
        },
      ],
    };
    buildSvgText(document, {
      onSvgDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    expect(diagnostics[0]?.detail).toMatch(/^shape:/);
  });

  it('writes a fill-rule="evenodd" attribute on a path vector whose own fillRule is evenodd', () => {
    const document: ContentDocument = {
      kind: "drawing",
      metadata: {},
      pages: [
        {
          size: { widthPt: 100, heightPt: 60 },
          shapes: [],
          vectors: [
            {
              kind: "path",
              frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
              fillRule: "evenodd",
              subpaths: [
                {
                  start: { xPt: 0, yPt: 0 },
                  segments: [],
                  closed: true,
                },
              ],
            },
          ],
        },
      ],
    };
    const text = buildSvgText(document);
    expect(text).toContain('fill-rule="evenodd"');
  });
});

describe("readSvgContent -> buildSvgText round trip", () => {
  it("round-trips the vector set exactly, rotation included, since write emits a 1:1 viewBox the reader maps through the identity", () => {
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
    if (first.kind !== "drawing" || second.kind !== "drawing") {
      throw new Error("expected drawing ContentDocuments");
    }
    expect(second.pages[0]?.vectors).toEqual(first.pages[0]?.vectors);
    expect(second.pages[0]?.size).toEqual(first.pages[0]?.size);
    expect(second.metadata).toEqual(first.metadata);
  });
});

// Latin-1 (0x00-0xFF) byte values for a string holding only characters in that range: JS's own charCodeAt already gives the exact byte value for every character both ISO-8859-1 and windows-1252 assign to that same code point, which is every character these fixtures use: accented Latin letters, never one of the five bytes (0x81/0x8D/0x8F/0x90/0x9D) the two encodings disagree on.
function latin1Bytes(text: string): number[] {
  return Array.from(text, (character) => character.charCodeAt(0));
}

// UTF-16LE bytes for a string holding only BMP characters (no surrogate pairs), with no byte order mark of its own; callers prepend one where the test wants it present.
function utf16leBytes(text: string): number[] {
  return Array.from(text, (character) => {
    const unit = character.charCodeAt(0);
    return [unit & 0xff, unit >> 8];
  }).flat();
}

describe("decodeSvgText / encodeSvgText", () => {
  it("round-trips text through the byte boundary, decoding as UTF-8 by default when the bytes carry no declaration or byte order mark", () => {
    expect(
      decodeSvgText(
        encodeSvgText('<svg xmlns="http://www.w3.org/2000/svg">café — ☃</svg>'),
      ),
    ).toBe('<svg xmlns="http://www.w3.org/2000/svg">café — ☃</svg>');
  });

  it("throws SvgUndecodableTextError on malformed UTF-8 rather than producing U+FFFD replacement characters", () => {
    const malformed = new Uint8Array([0xff, 0x00]);
    expect(() => decodeSvgText(malformed)).toThrow(SvgUndecodableTextError);
    let caught: unknown;
    try {
      decodeSvgText(malformed);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).name).toBe("SvgUndecodableTextError");
    expect((caught as SvgUndecodableTextError).encoding).toBe("utf-8");
    expect((caught as Error).message).toContain("not well-formed utf-8");
  });

  it("reads a non-UTF-8 encoding the XML prolog declares and decodes accordingly", () => {
    const text =
      '<?xml version="1.0" encoding="ISO-8859-1"?><svg xmlns="http://www.w3.org/2000/svg"><title>café</title></svg>';
    const bytes = Uint8Array.from(latin1Bytes(text));
    expect(decodeSvgText(bytes)).toBe(text);
  });

  it("decodes bytes behind a byte order mark even with no XML declaration naming an encoding", () => {
    const text =
      '<svg xmlns="http://www.w3.org/2000/svg"><title>hello</title></svg>';
    const bytes = Uint8Array.from([0xff, 0xfe, ...utf16leBytes(text)]);
    expect(decodeSvgText(bytes)).toBe(text);
  });

  it("throws SvgUnsupportedEncodingError when the XML prolog declares an encoding outside decodeText's own bounded set", () => {
    const bytes = Uint8Array.from(
      latin1Bytes(
        '<?xml version="1.0" encoding="Shift_JIS"?><svg xmlns="http://www.w3.org/2000/svg"/>',
      ),
    );
    expect(() => decodeSvgText(bytes)).toThrow(SvgUnsupportedEncodingError);
    let caught: unknown;
    try {
      decodeSvgText(bytes);
    } catch (error) {
      caught = error;
    }
    expect((caught as SvgUnsupportedEncodingError).name).toBe(
      "SvgUnsupportedEncodingError",
    );
    expect((caught as SvgUnsupportedEncodingError).label).toBe("Shift_JIS");
    expect((caught as Error).message).toContain("Shift_JIS");
  });

  it("throws SvgUndecodableTextError, naming the declared encoding, when bytes contradict it", () => {
    // Declares UTF-16LE, then pads to an odd total byte length, whatever the declaration's own length happens to be, which cannot hold a whole number of 16-bit code units.
    const declarationBytes = latin1Bytes(
      '<?xml version="1.0" encoding="UTF-16LE"?>',
    );
    const padding = declarationBytes.length % 2 === 0 ? [0x00] : [0x00, 0x00];
    const bytes = Uint8Array.from([...declarationBytes, ...padding]);
    let caught: unknown;
    try {
      decodeSvgText(bytes);
    } catch (error) {
      caught = error;
    }
    expect((caught as SvgUndecodableTextError).name).toBe(
      "SvgUndecodableTextError",
    );
    expect((caught as SvgUndecodableTextError).encoding).toBe("utf-16le");
  });
});
