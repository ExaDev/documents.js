import { describe, expect, it } from "vitest";
import type { ContentVector } from "document-schema.js";

import type { SvgDiagnostic } from "./diagnostics";
import { readSvgContent } from "./read";
import { SvgMissingRootElementError } from "./read";
import {} from "./write";
import {} from "./text";

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
      : {
          onSvgDiagnostic: (diagnostic) => {
            diagnostics.push(diagnostic);
          },
        },
  );
  if (document.kind !== "drawing") {
    throw new Error("expected a drawing ContentDocument");
  }
  return document.pages[0]!.vectors;
}

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
