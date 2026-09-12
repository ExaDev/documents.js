import { describe, expect, it } from "vitest";
import { DocFormatError } from "./errors";
import { layoutMetadataToSummaryInformation } from "./metadata";

describe("layoutMetadataToSummaryInformation", () => {
  it("passes valid createdIso/modifiedIso straight through to the SummaryInformation mapping", () => {
    const result = layoutMetadataToSummaryInformation({
      createdIso: "2024-01-01T00:00:00.000Z",
      modifiedIso: "2024-06-01T00:00:00.000Z",
    });
    expect(result.createdIso).toBe("2024-01-01T00:00:00.000Z");
    expect(result.lastSavedIso).toBe("2024-06-01T00:00:00.000Z");
  });

  it("rejects a malformed createdIso naming the field and the bad value in its message", () => {
    expect(() =>
      layoutMetadataToSummaryInformation({ createdIso: "not-a-date" }),
    ).toThrow(DocFormatError);
    expect(() =>
      layoutMetadataToSummaryInformation({ createdIso: "not-a-date" }),
    ).toThrow(/createdIso "not-a-date" is not a valid date string/);
  });

  it("rejects a malformed modifiedIso naming the field and the bad value in its message", () => {
    expect(() =>
      layoutMetadataToSummaryInformation({ modifiedIso: "also-not-a-date" }),
    ).toThrow(/modifiedIso "also-not-a-date" is not a valid date string/);
  });

  it("accepts metadata with neither date field set", () => {
    expect(() => layoutMetadataToSummaryInformation({})).not.toThrow();
  });
});
