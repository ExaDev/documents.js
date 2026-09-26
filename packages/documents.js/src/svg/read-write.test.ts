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
      {
        onSvgDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
        },
      },
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
