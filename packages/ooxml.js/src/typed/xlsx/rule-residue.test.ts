import { describe, expect, it } from "vitest";
import type { XmlElement } from "../../model/node";
import {
  captureResidualAttributes,
  residualAttributesFor,
} from "./rule-residue";

function elementWith(
  attributes: { name: string; value: string }[],
): XmlElement {
  return { type: "element", tag: "cfRule", attributes, children: [] };
}

describe("captureResidualAttributes", () => {
  it("returns undefined when every attribute is managed", () => {
    const element = elementWith([{ name: "type", value: "cellIs" }]);
    expect(
      captureResidualAttributes(element, new Set(["type"])),
    ).toBeUndefined();
  });

  it("returns undefined for an element with no attributes at all", () => {
    expect(
      captureResidualAttributes(elementWith([]), new Set(["type"])),
    ).toBeUndefined();
  });

  it("captures only the unmanaged attributes, dropping every managed one", () => {
    const element = elementWith([
      { name: "type", value: "cellIs" },
      { name: "pivot", value: "1" },
    ]);
    const residue = captureResidualAttributes(element, new Set(["type"]));
    expect(residue).toEqual({
      format: "xlsx",
      xml: '<cfRule pivot="1"></cfRule>',
    });
  });

  it("captures every attribute when none is managed", () => {
    const element = elementWith([{ name: "pivot", value: "1" }]);
    const residue = captureResidualAttributes(element, new Set());
    expect(residue).toEqual({
      format: "xlsx",
      xml: '<cfRule pivot="1"></cfRule>',
    });
  });
});

describe("residualAttributesFor", () => {
  it("returns an empty object when the source is undefined", () => {
    expect(residualAttributesFor(undefined, "cfRule")).toEqual({});
  });

  it("returns an empty object when the source is a different format", () => {
    expect(
      residualAttributesFor({ format: "docx", xml: "<cfRule/>" }, "cfRule"),
    ).toEqual({});
  });

  it("returns an empty object when the residue does not parse as exactly one element", () => {
    expect(
      residualAttributesFor(
        { format: "xlsx", xml: "<cfRule/><cfRule/>" },
        "cfRule",
      ),
    ).toEqual({});
  });

  it("refuses a two-element residue even when the first element alone would otherwise match", () => {
    // The first parsed node's own type and tag both match here -- only the node-count check itself can tell this apart from a genuine single-element residue.
    expect(
      residualAttributesFor(
        { format: "xlsx", xml: '<cfRule pivot="1"/><cfRule id="{B}"/>' },
        "cfRule",
      ),
    ).toEqual({});
  });

  it("returns an empty object when the residue's own tag does not match the expected one", () => {
    expect(
      residualAttributesFor(
        { format: "xlsx", xml: '<dataValidation pivot="1"/>' },
        "cfRule",
      ),
    ).toEqual({});
  });

  it("returns every attribute of a matching residue element", () => {
    expect(
      residualAttributesFor(
        { format: "xlsx", xml: '<cfRule pivot="1" id="{A}"/>' },
        "cfRule",
      ),
    ).toEqual({ pivot: "1", id: "{A}" });
  });
});
