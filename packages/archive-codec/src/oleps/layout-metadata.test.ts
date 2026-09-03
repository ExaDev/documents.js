import type { LayoutMetadata } from "document-schema.js";
import { describe, expect, it } from "vitest";
import type { SummaryInformationProperties } from "./summary-information";
import {
  hasSummaryInformationFields,
  layoutMetadataToSummaryInformation,
  summaryInformationToLayoutMetadata,
} from "./layout-metadata";

// Direct unit coverage for the mapping doc-codec/xls-codec/ppt-codec's own metadata.ts modules used to duplicate three times before it moved here (ExaDev/documents.js#887 review finding 5). Each package's own write.test.ts still round-trips this through a real "\x05SummaryInformation" stream; these tests cover the mapping itself in isolation, including the two permanent gaps.

describe("summaryInformationToLayoutMetadata", () => {
  it("maps every field SummaryInformation and LayoutMetadata share, including the lastSavedIso -> modifiedIso rename", () => {
    const info: SummaryInformationProperties = {
      title: "Quarterly report",
      subject: "Finance",
      author: "Joe",
      keywords: ["finance", "quarterly"],
      createdIso: "2024-01-15T09:00:00.000Z",
      lastSavedIso: "2024-03-20T14:30:00.000Z",
    };
    expect(summaryInformationToLayoutMetadata(info)).toEqual({
      title: "Quarterly report",
      subject: "Finance",
      author: "Joe",
      keywords: ["finance", "quarterly"],
      createdIso: "2024-01-15T09:00:00.000Z",
      modifiedIso: "2024-03-20T14:30:00.000Z",
    });
  });

  it("drops comments/lastPrintedIso, which LayoutMetadata has no field for", () => {
    const info: SummaryInformationProperties = {
      title: "Report",
      comments: "Draft only",
      lastPrintedIso: "2024-02-01T00:00:00.000Z",
    };
    const metadata = summaryInformationToLayoutMetadata(info);
    expect(metadata).not.toHaveProperty("comments");
    expect(metadata).not.toHaveProperty("lastPrintedIso");
  });

  it("copies keywords into a new array rather than aliasing the input", () => {
    const keywords = ["a", "b"];
    const info: SummaryInformationProperties = { keywords };
    const metadata = summaryInformationToLayoutMetadata(info);
    expect(metadata.keywords).toEqual(keywords);
    expect(metadata.keywords).not.toBe(keywords);
  });
});

describe("layoutMetadataToSummaryInformation", () => {
  it("maps every field SummaryInformation and LayoutMetadata share, including the modifiedIso -> lastSavedIso rename", () => {
    const metadata: LayoutMetadata = {
      title: "Quarterly report",
      subject: "Finance",
      author: "Joe",
      keywords: ["finance", "quarterly"],
      createdIso: "2024-01-15T09:00:00.000Z",
      modifiedIso: "2024-03-20T14:30:00.000Z",
    };
    expect(layoutMetadataToSummaryInformation(metadata)).toEqual({
      title: "Quarterly report",
      subject: "Finance",
      author: "Joe",
      keywords: ["finance", "quarterly"],
      createdIso: "2024-01-15T09:00:00.000Z",
      lastSavedIso: "2024-03-20T14:30:00.000Z",
    });
  });

  it("drops creator/producer/language, which SummaryInformation has no field for", () => {
    const metadata: LayoutMetadata = {
      creator: "Some Tool",
      producer: "Some Producer",
      language: "en-GB",
    };
    const info = layoutMetadataToSummaryInformation(metadata);
    expect(info).not.toHaveProperty("creator");
    expect(info).not.toHaveProperty("producer");
    expect(info).not.toHaveProperty("language");
  });

  it("does not validate createdIso/modifiedIso as real dates -- that is each caller's own responsibility", () => {
    const metadata: LayoutMetadata = { createdIso: "not-a-real-date" };
    expect(() => layoutMetadataToSummaryInformation(metadata)).not.toThrow();
    expect(layoutMetadataToSummaryInformation(metadata).createdIso).toBe(
      "not-a-real-date",
    );
  });
});

describe("hasSummaryInformationFields", () => {
  it("is false for metadata carrying only fields SummaryInformation cannot hold", () => {
    expect(
      hasSummaryInformationFields({
        creator: "Some Tool",
        producer: "Some Producer",
        language: "en-GB",
      }),
    ).toBe(false);
  });

  it("is false for an empty metadata object", () => {
    expect(hasSummaryInformationFields({})).toBe(false);
  });

  it("is false for an empty keywords array", () => {
    expect(hasSummaryInformationFields({ keywords: [] })).toBe(false);
  });

  it.each([
    ["title", { title: "x" }],
    ["subject", { subject: "x" }],
    ["author", { author: "x" }],
    ["keywords", { keywords: ["x"] }],
    ["createdIso", { createdIso: "2024-01-15T09:00:00.000Z" }],
    ["modifiedIso", { modifiedIso: "2024-01-15T09:00:00.000Z" }],
  ])("is true when metadata carries %s", (_field, metadata) => {
    expect(hasSummaryInformationFields(metadata)).toBe(true);
  });
});
