import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { FieldWizard, requireFieldValue } from "./field-wizard.js";

describe("requireFieldValue", () => {
  it("returns the recorded value for a known key", () => {
    expect(requireFieldValue({ width: "3" }, "width")).toBe("3");
  });

  it("throws naming the missing key when it was never recorded", () => {
    expect(() => requireFieldValue({}, "width")).toThrow(
      "Field wizard field 'width' was never recorded before building the action.",
    );
  });
});

describe("FieldWizard", () => {
  it("throws naming the out-of-range stepIndex and the field count when given no fields at all", () => {
    // A field wizard is only ever built with at least one field in real use (onComplete always fires before stepIndex can advance past the last one); an empty field list stands in for that "should never happen" case the guard exists for.
    expect(() =>
      renderToString(
        <FieldWizard
          fields={[]}
          onCancel={() => undefined}
          onComplete={() => undefined}
        />,
      ),
    ).toThrow(
      "FieldWizard stepIndex 0 is out of range for 0 fields — onComplete always fires before stepIndex can advance past the last field, so this indicates a bug in that advance.",
    );
  });
});
