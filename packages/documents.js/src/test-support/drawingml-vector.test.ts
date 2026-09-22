import { describe, expect, it } from "vitest";
import { el } from "../xml/fragment";
import { collectDrawingMlVectors } from "./drawingml-vector";

describe("collectDrawingMlVectors", () => {
  it("throws a descriptive error for a shape carrying a:ln whose geometry the production reader does not recognise", () => {
    const spPr = el("wps:spPr", {}, [el("a:ln")]);
    const root = el("w:body", {}, [spPr]);
    expect(() => collectDrawingMlVectors(root, "wps:spPr")).toThrow(
      "unrecognised DrawingML vector shape: wps:spPr",
    );
  });

  it("does not treat an element with a matching a:ln child but a different tag as a vector shape", () => {
    // If the tag comparison were dropped, this element — carrying the same a:ln child a real spPrTag element would — would be misread as a vector and either throw (unrecognised geometry) or be collected; the correct behaviour is to walk straight past it.
    const decoy = el("not-a-spPr-tag", {}, [el("a:ln")]);
    const root = el("w:body", {}, [decoy]);
    expect(collectDrawingMlVectors(root, "wps:spPr")).toEqual([]);
  });
});
