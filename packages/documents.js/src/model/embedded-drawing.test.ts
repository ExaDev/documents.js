import type {
  ContentEmbeddedObjectBlock,
  ContentVector,
} from "document-schema.js";
import { describe, expect, it } from "vitest";
import {
  buildDrawingBlock,
  drawingOfBlock,
  embeddedDrawingVectors,
  FLOW_CONTAINER_ORIGIN,
} from "./embedded-drawing";

describe("buildDrawingBlock / drawingOfBlock", () => {
  it("wraps the given vectors in a one-page drawing document sized to the given page, and drawingOfBlock recovers it", () => {
    const rect: ContentVector = {
      kind: "rect",
      frame: { xPt: 5, yPt: 10, widthPt: 20, heightPt: 30 },
      fill: { r: 1, g: 0, b: 0 },
    };
    const block = buildDrawingBlock({ widthPt: 100, heightPt: 200 }, [rect]);
    expect(block.frame).toEqual({
      xPt: 0,
      yPt: 0,
      widthPt: 100,
      heightPt: 200,
    });
    const drawing = drawingOfBlock(block);
    expect(drawing?.pages).toHaveLength(1);
    expect(drawing?.pages[0]?.vectors).toEqual([rect]);
  });

  it("drawingOfBlock returns undefined for a non-drawing embeddedObject block", () => {
    const nonDrawing: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      document: { kind: "formula", metadata: {}, formula: { mathml: [] } },
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    };
    expect(drawingOfBlock(nonDrawing)).toBeUndefined();
  });
});

describe("embeddedDrawingVectors", () => {
  it("translates a line's endpoints by adding dxPt/dyPt to each coordinate, not subtracting", () => {
    const line: ContentVector = {
      kind: "line",
      from: { xPt: 1, yPt: 2 },
      to: { xPt: 3, yPt: 7 },
      stroke: { color: { r: 0, g: 0, b: 0 }, widthPt: 1 },
    };
    const block = buildDrawingBlock({ widthPt: 100, heightPt: 100 }, [line]);
    // A non-zero, asymmetric (block frame != container origin) offset, so a sign flip on either axis produces a different result than the correct one.
    block.frame.xPt = 10;
    block.frame.yPt = 20;
    const [translated] = embeddedDrawingVectors(block, { xPt: 1, yPt: 2 });
    expect(translated?.kind).toBe("line");
    if (translated?.kind !== "line") {
      throw new Error("expected a line vector");
    }
    // dxPt = 10 + 1 = 11, dyPt = 20 + 2 = 22.
    expect(translated.from).toEqual({ xPt: 12, yPt: 24 });
    expect(translated.to).toEqual({ xPt: 14, yPt: 29 });
  });

  it("translates rect, ellipse, and path vectors identically by shifting only their own frame", () => {
    const rect: ContentVector = {
      kind: "rect",
      frame: { xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 },
      fill: { r: 1, g: 0, b: 0 },
    };
    const ellipse: ContentVector = {
      kind: "ellipse",
      frame: { xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 },
      fill: { r: 0, g: 1, b: 0 },
    };
    const block = buildDrawingBlock({ widthPt: 100, heightPt: 100 }, [
      rect,
      ellipse,
    ]);
    const translated = embeddedDrawingVectors(block, FLOW_CONTAINER_ORIGIN);
    expect(
      translated[0]?.kind === "rect" ? translated[0].frame : undefined,
    ).toEqual({ xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 });
    expect(
      translated[1]?.kind === "ellipse" ? translated[1].frame : undefined,
    ).toEqual({ xPt: 0, yPt: 0, widthPt: 5, heightPt: 5 });
  });

  it("returns an empty array for a non-drawing embeddedObject block", () => {
    const nonDrawing: ContentEmbeddedObjectBlock = {
      kind: "embeddedObject",
      objectKind: "formula",
      document: { kind: "formula", metadata: {}, formula: { mathml: [] } },
      frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
    };
    expect(embeddedDrawingVectors(nonDrawing, FLOW_CONTAINER_ORIGIN)).toEqual(
      [],
    );
  });
});
