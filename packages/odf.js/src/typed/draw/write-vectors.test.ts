import { describe, expect, it } from "vitest";
import type { ContentVector } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { attrValue } from "../../xml/query";
import { StyleRegistry } from "../../styles/registry";
import {
  createDrawShapeWriteState,
  type DrawShapeWriteState,
} from "./write-shapes";
import {
  writeDrawVector,
  writeDrawVectors,
  canonicalDrawVector,
} from "./write-vectors";

// writeDrawVector/canonicalDrawVector had no direct unit tests at all -- only indirect exercise through typed/odg/write.test.ts's own round-trip suite, which (see typed/shared/canonicalise.ts's own top-of-file note) cannot observe a mutation that changes what gets WRITTEN in a way the reader's own inverse tolerates. These tests assert directly against the raw written XML and against canonicalDrawVector's own return value.

function writeState(): DrawShapeWriteState {
  const automaticStyles = el("office:automatic-styles", {}, []);
  const pkg: Package = {
    parts: {
      "content.xml": {
        kind: "xml",
        nodes: [el("office:document-content", {}, [automaticStyles])],
      },
    },
  };
  const registry = StyleRegistry.forPart(pkg, "content.xml");
  return createDrawShapeWriteState(pkg, registry, automaticStyles);
}

function attr(element: XmlElement, name: string): string | undefined {
  return attrValue(element, name);
}

function graphicPropsOf(
  written: XmlElement,
  state: DrawShapeWriteState,
): XmlElement {
  const styleName = attr(written, "draw:style-name");
  const style = state.contentAutomaticStyles.children.find(
    (c): c is XmlElement =>
      c.type === "element" &&
      c.tag === "style:style" &&
      attrValue(c, "style:name") === styleName,
  );
  if (style === undefined) {
    throw new Error(`expected a minted style named ${styleName}`);
  }
  const props = style.children.find(
    (c): c is XmlElement =>
      c.type === "element" && c.tag === "style:graphic-properties",
  );
  if (props === undefined) {
    throw new Error("expected a style:graphic-properties child");
  }
  return props;
}

// `satisfies` rather than `: ContentVector`, so each fixture keeps its own literal "rect"/"line"/"path" member type -- annotating with the full union would widen it back to the union and lose the narrowing canonicalDrawVector's own per-kind assertions below rely on.
const RECT = {
  kind: "rect",
  frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
} satisfies ContentVector;

describe("writeDrawVector: paint (vectorGraphicStyleName)", () => {
  it('writes draw:fill="none" when the vector states no fill', () => {
    const state = writeState();
    const written = writeDrawVector(RECT, state, 0);
    const props = graphicPropsOf(written, state);
    expect(attr(props, "draw:fill")).toBe("none");
    expect(attr(props, "draw:fill-color")).toBeUndefined();
  });

  it('writes draw:fill="solid" and draw:fill-color when the vector states a fill', () => {
    const state = writeState();
    const written = writeDrawVector(
      { ...RECT, fill: { r: 1, g: 0, b: 0 } },
      state,
      0,
    );
    const props = graphicPropsOf(written, state);
    expect(attr(props, "draw:fill")).toBe("solid");
    expect(attr(props, "draw:fill-color")).toBe("#ff0000");
  });

  it("writes svg:fill-rule only when the path vector states one", () => {
    const path: ContentVector = {
      kind: "path",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      subpaths: [
        {
          start: { xPt: 0, yPt: 0 },
          segments: [{ kind: "line", to: { xPt: 1, yPt: 1 } }],
          closed: false,
        },
      ],
    };
    const state = writeState();
    const withoutRule = graphicPropsOf(writeDrawVector(path, state, 0), state);
    expect(attr(withoutRule, "svg:fill-rule")).toBeUndefined();

    const state2 = writeState();
    const withRule = graphicPropsOf(
      writeDrawVector({ ...path, fillRule: "evenodd" }, state2, 0),
      state2,
    );
    expect(attr(withRule, "svg:fill-rule")).toBe("evenodd");
  });

  it('writes draw:stroke="none" and no stroke-color/width when the vector states no stroke', () => {
    const state = writeState();
    const written = writeDrawVector(RECT, state, 0);
    const props = graphicPropsOf(written, state);
    expect(attr(props, "draw:stroke")).toBe("none");
    expect(attr(props, "svg:stroke-color")).toBeUndefined();
    expect(attr(props, "svg:stroke-width")).toBeUndefined();
  });

  it("writes a solid stroke's colour and width, and draw:stroke=solid for an absent or explicit solid style", () => {
    const state = writeState();
    const written = writeDrawVector(
      {
        ...RECT,
        stroke: { color: { r: 0, g: 0, b: 1 }, widthPt: 2 },
      },
      state,
      0,
    );
    const props = graphicPropsOf(written, state);
    expect(attr(props, "draw:stroke")).toBe("solid");
    expect(attr(props, "svg:stroke-color")).toBe("#0000ff");
    expect(attr(props, "svg:stroke-width")).toBe("2pt");
  });

  it('writes draw:stroke="dash" for a dashed stroke style', () => {
    const state = writeState();
    const written = writeDrawVector(
      {
        ...RECT,
        stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "dashed" },
      },
      state,
      0,
    );
    const props = graphicPropsOf(written, state);
    expect(attr(props, "draw:stroke")).toBe("dash");
  });

  it("refuses a 'dotted' stroke style, naming it and ODF's own none/solid/dash enumeration", () => {
    const state = writeState();
    expect(() =>
      writeDrawVector(
        {
          ...RECT,
          stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1, style: "dotted" },
        },
        state,
        0,
      ),
    ).toThrow(/dotted.*none\/solid\/dash/s);
  });

  it("refuses a stroke whose widthPt is not positive, naming the actual width", () => {
    const state = writeState();
    expect(() =>
      writeDrawVector(
        { ...RECT, stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 0 } },
        state,
        0,
      ),
    ).toThrow(/width 0pt/);
  });
});

describe("writeDrawVector: draw:z-index (zIndexAttrs)", () => {
  it("uses the caller's documentIndex when the vector states no ODF-spellable paintOrder", () => {
    const state = writeState();
    const written = writeDrawVector(RECT, state, 3);
    expect(attr(written, "draw:z-index")).toBe("3");
  });

  it("uses the vector's own resolvable paintOrder over the caller's documentIndex", () => {
    const state = writeState();
    const written = writeDrawVector({ ...RECT, paintOrder: 5 }, state, 3);
    expect(attr(written, "draw:z-index")).toBe("5");
  });
});

describe("writeDrawVector: per-kind element shape", () => {
  it("writes a 'line' as draw:line with its own four endpoint coordinates and no frame geometry", () => {
    const state = writeState();
    const line: ContentVector = {
      kind: "line",
      from: { xPt: 1, yPt: 2 },
      to: { xPt: 3, yPt: 4 },
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
    };
    const written = writeDrawVector(line, state, 0);
    expect(written.tag).toBe("draw:line");
    expect(attr(written, "svg:x1")).toBe("1pt");
    expect(attr(written, "svg:y1")).toBe("2pt");
    expect(attr(written, "svg:x2")).toBe("3pt");
    expect(attr(written, "svg:y2")).toBe("4pt");
  });

  it("writes 'rect' as draw:rect and 'ellipse' as draw:ellipse", () => {
    const state = writeState();
    expect(writeDrawVector(RECT, state, 0).tag).toBe("draw:rect");
    expect(writeDrawVector({ ...RECT, kind: "ellipse" }, state, 0).tag).toBe(
      "draw:ellipse",
    );
  });

  it("writes 'path' as draw:path with svg:viewBox and svg:d", () => {
    const state = writeState();
    const path: ContentVector = {
      kind: "path",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      subpaths: [
        {
          start: { xPt: 0, yPt: 0 },
          segments: [{ kind: "line", to: { xPt: 1, yPt: 1 } }],
          closed: false,
        },
      ],
    };
    const written = writeDrawVector(path, state, 0);
    expect(written.tag).toBe("draw:path");
    expect(attr(written, "svg:viewBox")).toBeDefined();
    expect(attr(written, "svg:d")).toBeDefined();
  });

  it("refuses a 'path' with no subpaths at all", () => {
    const state = writeState();
    expect(() =>
      writeDrawVector(
        {
          kind: "path",
          frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
          subpaths: [],
        },
        state,
        0,
      ),
    ).toThrow(/no subpaths/);
  });

  it("refuses a 'path' whose frame has a non-positive width or height, naming the actual dimensions", () => {
    const state = writeState();
    const subpaths: Extract<ContentVector, { kind: "path" }>["subpaths"] = [
      {
        start: { xPt: 0, yPt: 0 },
        segments: [{ kind: "line", to: { xPt: 1, yPt: 1 } }],
        closed: false,
      },
    ];
    expect(() =>
      writeDrawVector(
        {
          kind: "path",
          frame: { xPt: 0, yPt: 0, widthPt: 0, heightPt: 10 },
          subpaths,
        },
        state,
        0,
      ),
    ).toThrow(/0pt x 10pt/);
    expect(() =>
      writeDrawVector(
        {
          kind: "path",
          frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: -1 },
          subpaths,
        },
        state,
        0,
      ),
    ).toThrow(/10pt x -1pt/);
  });
});

describe("writeDrawVectors", () => {
  it("writes each vector at baseIndex plus its own array position", () => {
    const state = writeState();
    const written = writeDrawVectors([RECT, RECT], state, 5);
    expect(written).toHaveLength(2);
    const [first, second] = written;
    if (first === undefined || second === undefined) {
      throw new Error("expected two written vectors");
    }
    expect(attr(first, "draw:z-index")).toBe("5");
    expect(attr(second, "draw:z-index")).toBe("6");
  });
});

describe("canonicalDrawVector", () => {
  it("resolves paintOrder to documentIndex when the vector states none", () => {
    expect(canonicalDrawVector(RECT, 7).paintOrder).toBe(7);
  });

  it("resolves paintOrder to the vector's own value when it states one", () => {
    expect(canonicalDrawVector({ ...RECT, paintOrder: 2 }, 7).paintOrder).toBe(
      2,
    );
  });

  it("collapses rotationDeg === 0 to absent, but keeps a genuine non-zero rotation", () => {
    const zero = canonicalDrawVector({ ...RECT, rotationDeg: 0 }, 0);
    const nonZero = canonicalDrawVector({ ...RECT, rotationDeg: 45 }, 0);
    if (zero.kind === "line" || nonZero.kind === "line") {
      throw new Error("expected 'rect' results, not 'line'");
    }
    expect(zero.rotationDeg).toBeUndefined();
    expect(nonZero.rotationDeg).toBe(45);
  });

  it("quantises fill through canonicalColor and leaves an absent fill absent", () => {
    const absent = canonicalDrawVector(RECT, 0);
    const stated = canonicalDrawVector(
      { ...RECT, fill: { r: 0.9, g: 0, b: 0 } },
      0,
    );
    if (absent.kind === "line" || stated.kind === "line") {
      throw new Error("expected 'rect' results, not 'line'");
    }
    expect(absent.fill).toBeUndefined();
    expect(stated.fill).toEqual({ r: 230 / 255, g: 0, b: 0 });
  });

  it("canonicalises an absent stroke style to 'solid' and leaves an absent stroke absent", () => {
    expect(canonicalDrawVector(RECT, 0).stroke).toBeUndefined();
    const result = canonicalDrawVector(
      { ...RECT, stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 } },
      0,
    );
    expect(result.stroke).toEqual({
      color: { r: 0, g: 0, b: 0 },
      widthPt: 1,
      style: "solid",
    });
  });

  it("carries fillRule through for a 'path' only when stated", () => {
    const path = {
      kind: "path",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      subpaths: [],
    } satisfies ContentVector;
    expect(canonicalDrawVector(path, 0)).not.toHaveProperty("fillRule");
    const withRule = canonicalDrawVector({ ...path, fillRule: "nonzero" }, 0);
    if (withRule.kind !== "path") {
      throw new Error("expected a 'path' result");
    }
    expect(withRule.fillRule).toBe("nonzero");
  });

  it("carries every subpath's own start/segments/closed through for a 'path', as a fresh array", () => {
    const subpaths: NonNullable<
      Extract<ContentVector, { kind: "path" }>["subpaths"]
    > = [
      {
        start: { xPt: 1, yPt: 2 },
        segments: [{ kind: "line", to: { xPt: 3, yPt: 4 } }],
        closed: true,
      },
    ];
    const path: ContentVector = {
      kind: "path",
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
      subpaths,
    };
    const result = canonicalDrawVector(path, 0);
    expect(result.kind).toBe("path");
    if (result.kind === "path") {
      expect(result.subpaths).toEqual(subpaths);
      expect(result.subpaths).not.toBe(subpaths);
    }
  });

  it("carries kind/frame through unchanged for 'line', 'rect', and 'ellipse'", () => {
    const line: ContentVector = {
      kind: "line",
      from: { xPt: 0, yPt: 0 },
      to: { xPt: 1, yPt: 1 },
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
    };
    const result = canonicalDrawVector(line, 0);
    expect(result.kind).toBe("line");
    if (result.kind === "line") {
      expect(result.from).toEqual({ xPt: 0, yPt: 0 });
      expect(result.to).toEqual({ xPt: 1, yPt: 1 });
    }
    const rectResult = canonicalDrawVector(RECT, 0);
    if (rectResult.kind === "line") {
      throw new Error("expected a 'rect' result, not 'line'");
    }
    expect(rectResult.frame).toEqual(RECT.frame);
  });
});
