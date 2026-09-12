import type { LayoutMetadata } from "document-schema.js";
import { describe, expect, it } from "vitest";

import { BiffWriteError } from "./biff/write-errors";
import { layoutMetadataToSummaryInformation } from "./metadata";

describe("layoutMetadataToSummaryInformation", () => {
  it("maps a metadata object carrying no dates through unchanged", () => {
    const metadata: LayoutMetadata = { title: "Report" };

    expect(layoutMetadataToSummaryInformation(metadata).title).toBe("Report");
  });

  it("accepts a valid createdIso date", () => {
    const metadata: LayoutMetadata = { createdIso: "2024-01-01T00:00:00.000Z" };

    expect(() => layoutMetadataToSummaryInformation(metadata)).not.toThrow();
  });

  it("accepts a valid modifiedIso date", () => {
    const metadata: LayoutMetadata = {
      modifiedIso: "2024-06-15T12:30:00.000Z",
    };

    expect(() => layoutMetadataToSummaryInformation(metadata)).not.toThrow();
  });

  it("rejects a malformed createdIso date, naming the field", () => {
    const metadata: LayoutMetadata = { createdIso: "not a date" };

    expect(() => layoutMetadataToSummaryInformation(metadata)).toThrow(
      BiffWriteError,
    );
    expect(() => layoutMetadataToSummaryInformation(metadata)).toThrow(
      /createdIso/,
    );
  });

  it("rejects a malformed modifiedIso date, naming the field", () => {
    const metadata: LayoutMetadata = { modifiedIso: "not a date" };

    expect(() => layoutMetadataToSummaryInformation(metadata)).toThrow(
      BiffWriteError,
    );
    expect(() => layoutMetadataToSummaryInformation(metadata)).toThrow(
      /modifiedIso/,
    );
  });

  it("rejects a malformed createdIso even when modifiedIso is valid", () => {
    const metadata: LayoutMetadata = {
      createdIso: "garbage",
      modifiedIso: "2024-01-01T00:00:00.000Z",
    };

    expect(() => layoutMetadataToSummaryInformation(metadata)).toThrow(
      /createdIso/,
    );
  });
});
