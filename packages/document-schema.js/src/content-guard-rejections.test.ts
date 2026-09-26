import { describe, expect, it } from "vitest";
import {
  type ContentDocument,
  ContentDefinedNameSchema,
  isContentBlock,
  isContentConstructStart,
  isRunConstructExtent,
} from "./content";
import {} from "./content-vocabulary";
import {} from "./content-sheet";

import type { ConstructDescriptor } from "./construct";

function formulaDocument(): ContentDocument {
  return {
    kind: "formula",
    metadata: { title: "Pythagoras" },
    formula: {
      mathml: [
        {
          type: "declaration",
          attributes: [{ name: "version", value: "1.0" }],
        },
        { type: "text", value: "\n" },
        {
          type: "element",
          tag: "math",
          attributes: [
            { name: "xmlns", value: "http://www.w3.org/1998/Math/MathML" },
          ],
          children: [
            {
              type: "element",
              tag: "msup",
              attributes: [],
              children: [
                {
                  type: "element",
                  tag: "mi",
                  attributes: [],
                  children: [{ type: "text", value: "a" }],
                },
                {
                  type: "element",
                  tag: "mn",
                  attributes: [],
                  children: [{ type: "text", value: "2" }],
                },
              ],
            },
            {
              type: "element",
              tag: "mo",
              attributes: [],
              children: [{ type: "text", value: "+" }],
            },
            { type: "comment", value: " the other leg " },
          ],
        },
      ],
      starMath: "a^2 + b^2 = c^2",
    },
  };
}

describe("isContentConstructStart never accepts a value whose own kind isn't constructStart, even with an otherwise-valid descriptor", () => {
  it("rejects a construct-shaped value carrying the wrong kind discriminant", () => {
    expect(
      isContentConstructStart({
        kind: "constructEnd",
        descriptor: { kind: "anchor", anchorType: "bookmark", name: "b1" },
      }),
    ).toBe(false);
  });
});

describe("isRunConstructExtent rejects an out-of-range run bound, not just a non-integer one", () => {
  it("rejects a negative startRun/endRun", () => {
    const descriptor: ConstructDescriptor = {
      kind: "anchor",
      anchorType: "bookmark",
      name: "b1",
    };
    expect(isRunConstructExtent({ descriptor, startRun: -1, endRun: 1 })).toBe(
      false,
    );
    expect(isRunConstructExtent({ descriptor, startRun: 0, endRun: -1 })).toBe(
      false,
    );
  });
});

describe("isRunConstructExtent rejects a non-record value", () => {
  it("rejects null, a string, and an array", () => {
    expect(isRunConstructExtent(null)).toBe(false);
    expect(isRunConstructExtent("a string")).toBe(false);
    expect(isRunConstructExtent([])).toBe(false);
  });
});

describe("isContentBlock's embeddedObject arm rejects each individually-invalid field", () => {
  const validEmbedded = () => ({
    kind: "embeddedObject" as const,
    objectKind: "formula" as const,
    document: formulaDocument(),
    frame: { xPt: 0, yPt: 0, widthPt: 10, heightPt: 10 },
  });

  it("accepts a genuinely valid embedded object, and every recognised objectKind", () => {
    expect(isContentBlock(validEmbedded())).toBe(true);
    for (const objectKind of [
      "formula",
      "wordprocessing",
      "presentation",
      "spreadsheet",
      "drawing",
      "chart",
    ] as const) {
      expect(isContentBlock({ ...validEmbedded(), objectKind })).toBe(true);
    }
  });

  it("rejects an unrecognised objectKind", () => {
    expect(isContentBlock({ ...validEmbedded(), objectKind: "bogus" })).toBe(
      false,
    );
  });

  it("rejects a malformed frame", () => {
    expect(
      isContentBlock({ ...validEmbedded(), frame: { xPt: 0, yPt: 0 } }),
    ).toBe(false);
  });

  it("rejects a malformed document", () => {
    expect(
      isContentBlock({ ...validEmbedded(), document: { kind: "bogus" } }),
    ).toBe(false);
  });

  it("rejects a non-integer or negative anchorRow, and accepts a valid one", () => {
    expect(isContentBlock({ ...validEmbedded(), anchorRow: 1.5 })).toBe(false);
    expect(isContentBlock({ ...validEmbedded(), anchorRow: -1 })).toBe(false);
    expect(isContentBlock({ ...validEmbedded(), anchorRow: "1" })).toBe(false);
    expect(isContentBlock({ ...validEmbedded(), anchorRow: 1 })).toBe(true);
    expect(isContentBlock({ ...validEmbedded(), anchorRow: 0 })).toBe(true);
  });

  it("rejects a non-integer or negative anchorColumn, and accepts a valid one", () => {
    expect(isContentBlock({ ...validEmbedded(), anchorColumn: 1.5 })).toBe(
      false,
    );
    expect(isContentBlock({ ...validEmbedded(), anchorColumn: -1 })).toBe(
      false,
    );
    expect(isContentBlock({ ...validEmbedded(), anchorColumn: "1" })).toBe(
      false,
    );
    expect(isContentBlock({ ...validEmbedded(), anchorColumn: 1 })).toBe(true);
    expect(isContentBlock({ ...validEmbedded(), anchorColumn: 0 })).toBe(true);
  });

  it("rejects a non-number offsetXPt/offsetYPt, and accepts a valid one", () => {
    expect(isContentBlock({ ...validEmbedded(), offsetXPt: "1" })).toBe(false);
    expect(isContentBlock({ ...validEmbedded(), offsetXPt: 1 })).toBe(true);
    expect(isContentBlock({ ...validEmbedded(), offsetYPt: "1" })).toBe(false);
    expect(isContentBlock({ ...validEmbedded(), offsetYPt: 1 })).toBe(true);
  });
});

describe("ContentDefinedNameSchema", () => {
  it("validates a workbook-global defined name", () => {
    expect(
      ContentDefinedNameSchema.safeParse({
        name: "TaxRate",
        refersTo: "Sheet1!$B$2",
      }).success,
    ).toBe(true);
  });

  it("validates a sheet-scoped defined name", () => {
    expect(
      ContentDefinedNameSchema.safeParse({
        name: "TaxRate",
        refersTo: "$B$2",
        scopeSheetIndex: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects a missing name or refersTo, and a negative scopeSheetIndex", () => {
    expect(
      ContentDefinedNameSchema.safeParse({ refersTo: "Sheet1!$B$2" }).success,
    ).toBe(false);
    expect(
      ContentDefinedNameSchema.safeParse({ name: "TaxRate" }).success,
    ).toBe(false);
    expect(
      ContentDefinedNameSchema.safeParse({
        name: "TaxRate",
        refersTo: "Sheet1!$B$2",
        scopeSheetIndex: -1,
      }).success,
    ).toBe(false);
  });
});
