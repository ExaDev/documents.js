import { describe, expect, it } from "vitest";
import type { ContentShape, ContentBlock } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import { el } from "../../xml/fragment";
import { attrValue } from "../../xml/query";
import { StyleRegistry } from "../../styles/registry";
import type { ListPlanState } from "../shared/list";
import {
  planShapeContent,
  frameGeometryAttrs,
  odfZIndexOf,
  writeDrawFrame,
  canonicalDrawShape,
  writeDrawShapes,
  createDrawShapeWriteState,
  type DrawShapeWriteState,
} from "./write-shapes";

// This module had no direct unit tests at all — every function here was only exercised indirectly through typed/odp/write.test.ts and typed/odg/write.test.ts's own whole-document round-trip suites, which (see typed/shared/canonicalise.ts's own top-of-file note) cannot observe a mutation that changes what gets WRITTEN in a way the reader's own inverse tolerates.

function freshListState(): ListPlanState {
  return { cursor: { next: 1 } };
}

function writeState(): {
  state: DrawShapeWriteState;
  mintedStyles: () => XmlElement[];
} {
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
  return {
    state: createDrawShapeWriteState(pkg, registry, automaticStyles),
    mintedStyles: () =>
      automaticStyles.children.filter(
        (c): c is XmlElement => c.type === "element" && c.tag === "style:style",
      ),
  };
}

function attr(
  element: XmlElement | undefined,
  name: string,
): string | undefined {
  return element === undefined ? undefined : attrValue(element, name);
}

const ZERO_INSETS = {
  insetLeftPt: 0,
  insetTopPt: 0,
  insetRightPt: 0,
  insetBottomPt: 0,
};

function shape(overrides: Partial<ContentShape> = {}): ContentShape {
  return {
    frame: { xPt: 0, yPt: 0, widthPt: 100, heightPt: 50 },
    ...ZERO_INSETS,
    blocks: [],
    ...overrides,
  };
}

function paragraphBlock(text: string): ContentBlock {
  return { kind: "paragraph", runs: [{ text }] };
}

describe("planShapeContent", () => {
  it("resolves a single table block to kind: table", () => {
    const table: ContentBlock = { kind: "table", rows: [], columns: [] };
    const plan = planShapeContent([table], freshListState());
    expect(plan.kind).toBe("table");
  });

  it("resolves a single image block to kind: image", () => {
    const image: ContentBlock = {
      kind: "image",
      format: "png",
      base64: "",
      widthPt: 1,
      heightPt: 1,
    };
    const plan = planShapeContent([image], freshListState());
    expect(plan.kind).toBe("image");
  });

  it("resolves a single embeddedObject block to kind: embedded", () => {
    const object: ContentBlock = {
      kind: "embeddedObject",
      objectKind: "wordprocessing",
      document: { kind: "wordprocessing", metadata: {}, sections: [] },
      frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
    };
    const plan = planShapeContent([object], freshListState());
    expect(plan.kind).toBe("embedded");
  });

  it("resolves any list of paragraphs (including a single one) to kind: text", () => {
    const plan = planShapeContent([paragraphBlock("hi")], freshListState());
    expect(plan.kind).toBe("text");
    if (plan.kind === "text") {
      expect(plan.paragraphs).toHaveLength(1);
    }
  });

  it("refuses a table alongside another block", () => {
    const table: ContentBlock = { kind: "table", rows: [], columns: [] };
    expect(() =>
      planShapeContent([table, paragraphBlock("x")], freshListState()),
    ).toThrow(/a table alongside other content/);
  });

  it("refuses an image alongside another block", () => {
    const image: ContentBlock = {
      kind: "image",
      format: "png",
      base64: "",
      widthPt: 1,
      heightPt: 1,
    };
    expect(() =>
      planShapeContent([image, paragraphBlock("x")], freshListState()),
    ).toThrow(/an image alongside other content/);
  });

  it("refuses a page break", () => {
    const pageBreak: ContentBlock = { kind: "pageBreak" };
    expect(() => planShapeContent([pageBreak], freshListState())).toThrow(
      /a page break/,
    );
  });

  it("refuses an embedded object alongside another block", () => {
    const object: ContentBlock = {
      kind: "embeddedObject",
      objectKind: "wordprocessing",
      document: { kind: "wordprocessing", metadata: {}, sections: [] },
      frame: { xPt: 0, yPt: 0, widthPt: 1, heightPt: 1 },
    };
    expect(() =>
      planShapeContent([object, paragraphBlock("x")], freshListState()),
    ).toThrow(/an embedded object alongside other content/);
  });

  it("refuses a construct boundary marker", () => {
    const marker: ContentBlock = {
      kind: "constructStart",
      descriptor: { kind: "division" },
    };
    expect(() => planShapeContent([marker], freshListState())).toThrow(
      /a construct boundary marker/,
    );
  });

  it("refuses a heading paragraph", () => {
    const heading: ContentBlock = {
      kind: "paragraph",
      runs: [{ text: "H" }],
      headingLevel: 1,
    };
    expect(() => planShapeContent([heading], freshListState())).toThrow(
      /a heading/,
    );
  });

  it("force-closes the plan's currently open run unconditionally, even when the next shape's own blocks carry no list membership at all", () => {
    const listState = freshListState();
    planShapeContent(
      [
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "bullet:l1", level: 0 },
        },
      ],
      listState,
    );
    expect(listState.cursor.openNumId).toBeDefined();
    planShapeContent([paragraphBlock("b")], listState);
    expect(listState.cursor.openNumId).toBeUndefined();
  });

  it("canonicalises list membership onto a fresh numId for a new shape's first paragraph, even when its incoming numId string happens to match a still-open run from before this call", () => {
    const listState = freshListState();
    const first = planShapeContent(
      [
        {
          kind: "paragraph",
          runs: [{ text: "a" }],
          list: { numId: "bullet:l1", level: 0 },
        },
      ],
      listState,
    );
    const second = planShapeContent(
      [
        {
          kind: "paragraph",
          runs: [{ text: "b" }],
          list: { numId: "bullet:l1", level: 0 },
        },
      ],
      listState,
    );
    if (first.kind !== "text" || second.kind !== "text") {
      throw new Error("expected text plans");
    }
    expect(first.paragraphs[0]?.list?.numId).not.toBe(
      second.paragraphs[0]?.list?.numId,
    );
  });
});

describe("frameGeometryAttrs", () => {
  const frame = { xPt: 10, yPt: 20, widthPt: 100, heightPt: 50 };

  it("writes plain svg:x/y/width/height with no draw:transform when rotationDeg is undefined", () => {
    const attrs = frameGeometryAttrs(frame, undefined);
    expect(attrs["svg:x"]).toBe("10pt");
    expect(attrs["svg:y"]).toBe("20pt");
    expect(attrs["svg:width"]).toBe("100pt");
    expect(attrs["svg:height"]).toBe("50pt");
    expect(attrs["draw:transform"]).toBeUndefined();
  });

  it("treats rotationDeg === 0 identically to undefined", () => {
    expect(frameGeometryAttrs(frame, 0)).toEqual(
      frameGeometryAttrs(frame, undefined),
    );
  });

  it("writes svg:width/height plus draw:transform (no svg:x/y) for a genuinely rotated frame", () => {
    const attrs = frameGeometryAttrs(frame, 90);
    expect(attrs["svg:width"]).toBe("100pt");
    expect(attrs["svg:height"]).toBe("50pt");
    expect(attrs["svg:x"]).toBeUndefined();
    expect(attrs["svg:y"]).toBeUndefined();
    expect(attrs["draw:transform"]).toMatch(
      /^rotate\(.+\) translate\(.+ .+\)$/,
    );
  });

  it("a 90-degree rotation's own transform matches the documented algebraic derivation exactly", () => {
    const attrs = frameGeometryAttrs(frame, 90);
    const angleRad = (-90 * Math.PI) / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    const halfW = frame.widthPt / 2;
    const halfH = frame.heightPt / 2;
    const txPt = frame.xPt + halfW - halfW * cos - halfH * sin;
    const tyPt = frame.yPt + halfH - halfH * cos + halfW * sin;
    expect(attrs["draw:transform"]).toBe(
      `rotate(${angleRad}) translate(${txPt}pt ${tyPt}pt)`,
    );
  });
});

describe("odfZIndexOf", () => {
  it("returns undefined for an undefined paintOrder", () => {
    expect(odfZIndexOf(undefined)).toBeUndefined();
  });

  it("returns undefined for a negative paintOrder", () => {
    expect(odfZIndexOf(-1)).toBeUndefined();
  });

  it("returns undefined for a fractional paintOrder", () => {
    expect(odfZIndexOf(1.5)).toBeUndefined();
  });

  it("returns undefined for a paintOrder beyond Number.isSafeInteger's own bound", () => {
    expect(odfZIndexOf(Number.MAX_SAFE_INTEGER + 2)).toBeUndefined();
  });

  it("returns the value unchanged for a genuine non-negative safe integer, including zero", () => {
    expect(odfZIndexOf(0)).toBe(0);
    expect(odfZIndexOf(5)).toBe(5);
  });
});

describe("writeDrawFrame", () => {
  it("uses the shape's own resolvable paintOrder over documentIndex, and falls back to documentIndex otherwise", () => {
    const { state } = writeState();
    const withPaintOrder = writeDrawFrame(
      shape({ paintOrder: 9 }),
      freshListState(),
      state,
      2,
    );
    expect(attr(withPaintOrder, "draw:z-index")).toBe("9");
    const withoutPaintOrder = writeDrawFrame(
      shape(),
      freshListState(),
      state,
      2,
    );
    expect(attr(withoutPaintOrder, "draw:z-index")).toBe("2");
  });

  it("writes draw:name only when the shape actually states one", () => {
    const { state } = writeState();
    expect(
      attr(writeDrawFrame(shape(), freshListState(), state, 0), "draw:name"),
    ).toBeUndefined();
    expect(
      attr(
        writeDrawFrame(shape({ name: "Rect 1" }), freshListState(), state, 0),
        "draw:name",
      ),
    ).toBe("Rect 1");
  });

  it("writes a draw:text-box for an all-paragraph shape", () => {
    const { state } = writeState();
    const written = writeDrawFrame(
      shape({ blocks: [paragraphBlock("hi")] }),
      freshListState(),
      state,
      0,
    );
    expect(written.children[0]).toMatchObject({ tag: "draw:text-box" });
  });

  it("writes a table:table for a single-table shape", () => {
    const { state } = writeState();
    const written = writeDrawFrame(
      shape({
        blocks: [{ kind: "table", rows: [], columns: [] }],
      }),
      freshListState(),
      state,
      0,
    );
    expect(written.children[0]).toMatchObject({ tag: "table:table" });
  });

  it("writes a draw:image for a single-image shape", () => {
    const { state } = writeState();
    const written = writeDrawFrame(
      shape({
        blocks: [
          {
            kind: "image",
            format: "png",
            base64: "abc",
            widthPt: 1,
            heightPt: 1,
          },
        ],
      }),
      freshListState(),
      state,
      0,
    );
    expect(
      written.children.some(
        (c) => c.type === "element" && c.tag === "draw:image",
      ),
    ).toBe(true);
  });

  it("mints a graphic-family style stating explicit no-fill/no-stroke, with padding attributes only when an inset is non-zero", () => {
    const { state, mintedStyles } = writeState();
    writeDrawFrame(shape(), freshListState(), state, 0);
    const zeroInsetStyle = mintedStyles().find(
      (s) => attrValue(s, "style:family") === "graphic",
    );
    const zeroProps = zeroInsetStyle?.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:graphic-properties",
    );
    expect(attr(zeroProps, "draw:fill")).toBe("none");
    expect(attr(zeroProps, "draw:stroke")).toBe("none");
    expect(attr(zeroProps, "fo:padding-left")).toBeUndefined();

    const { state: state2, mintedStyles: mintedStyles2 } = writeState();
    writeDrawFrame(shape({ insetLeftPt: 3 }), freshListState(), state2, 0);
    const withInsetStyle = mintedStyles2().find(
      (s) => attrValue(s, "style:family") === "graphic",
    );
    const withProps = withInsetStyle?.children.find(
      (c): c is XmlElement =>
        c.type === "element" && c.tag === "style:graphic-properties",
    );
    expect(attr(withProps, "fo:padding-left")).toBe("3pt");
    expect(attr(withProps, "fo:padding-top")).toBe("0pt");
  });
});

describe("canonicalDrawShape", () => {
  it("resolves paintOrder to documentIndex when the shape states none, and to its own value when it does", () => {
    expect(canonicalDrawShape(shape(), 4, freshListState()).paintOrder).toBe(4);
    expect(
      canonicalDrawShape(shape({ paintOrder: 7 }), 4, freshListState())
        .paintOrder,
    ).toBe(7);
  });

  it("collapses rotationDeg === 0 to absent, but keeps a genuine non-zero rotation", () => {
    expect(
      canonicalDrawShape(shape({ rotationDeg: 0 }), 0, freshListState())
        .rotationDeg,
    ).toBeUndefined();
    expect(
      canonicalDrawShape(shape({ rotationDeg: 30 }), 0, freshListState())
        .rotationDeg,
    ).toBe(30);
  });

  it("carries name through only when stated", () => {
    expect(
      canonicalDrawShape(shape(), 0, freshListState()).name,
    ).toBeUndefined();
    expect(
      canonicalDrawShape(shape({ name: "X" }), 0, freshListState()).name,
    ).toBe("X");
  });

  it("overrides an image block's own widthPt/heightPt with the enclosing shape's frame size", () => {
    const result = canonicalDrawShape(
      shape({
        frame: { xPt: 0, yPt: 0, widthPt: 200, heightPt: 80 },
        blocks: [
          {
            kind: "image",
            format: "png",
            base64: "abc",
            widthPt: 1,
            heightPt: 1,
          },
        ],
      }),
      0,
      freshListState(),
    );
    expect(result.blocks[0]).toMatchObject({ widthPt: 200, heightPt: 80 });
  });

  it("carries frame/insets through unchanged", () => {
    const s = shape({ insetLeftPt: 5 });
    const result = canonicalDrawShape(s, 0, freshListState());
    expect(result.frame).toEqual(s.frame);
    expect(result.insetLeftPt).toBe(5);
  });
});

describe("writeDrawShapes", () => {
  it("writes each shape at its own array index as documentIndex, in order", () => {
    const { state } = writeState();
    const written = writeDrawShapes(
      [shape(), shape()],
      freshListState(),
      state,
    );
    expect(attr(written[0], "draw:z-index")).toBe("0");
    expect(attr(written[1], "draw:z-index")).toBe("1");
  });
});
