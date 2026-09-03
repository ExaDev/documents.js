import { describe, expect, it } from "vitest";
import { PropertySetFormatError, readPropertySetStream } from "./read";
import {
  FMTID_SUMMARY_INFORMATION,
  readSummaryInformation,
  writeSummaryInformationStream,
} from "./summary-information";
import { writePropertySetStream } from "./write";

describe("readSummaryInformation / writeSummaryInformationStream", () => {
  it("round-trips every field this module covers", () => {
    const metadata = {
      title: "Q3 report",
      subject: "Finance",
      author: "Joe",
      keywords: ["quarterly", "finance", "report"],
      comments: "Draft for review",
      createdIso: "2024-01-15T09:00:00.000Z",
      lastSavedIso: "2024-03-20T14:30:00.000Z",
      lastPrintedIso: "2024-03-21T08:00:00.000Z",
    };
    const bytes = writeSummaryInformationStream(metadata);
    expect(readSummaryInformation(bytes)).toEqual(metadata);
  });

  it("writes and reads back an honestly-empty stream for {}", () => {
    const bytes = writeSummaryInformationStream({});
    expect(readSummaryInformation(bytes)).toEqual({});
  });

  it("omits a field entirely rather than writing it as an empty/zero placeholder", () => {
    const bytes = writeSummaryInformationStream({ title: "Only a title" });
    const propertySet = readPropertySetStream(bytes);
    expect(propertySet.properties.has(3)).toBe(false); // PIDSI_SUBJECT
    expect(propertySet.properties.has(4)).toBe(false); // PIDSI_AUTHOR
    expect(propertySet.properties.has(12)).toBe(false); // PIDSI_CREATE_DTM
  });

  it("joins keywords with ', ' and splits them back apart, dropping empty entries", () => {
    const bytes = writeSummaryInformationStream({ keywords: ["a", "b", "c"] });
    const propertySet = readPropertySetStream(bytes);
    expect(propertySet.properties.get(5)).toEqual({
      type: "VT_LPWSTR",
      value: "a, b, c",
    });
    expect(readSummaryInformation(bytes).keywords).toEqual(["a", "b", "c"]);
  });

  it("declares CP_WINUNICODE as its CodePage property", () => {
    const bytes = writeSummaryInformationStream({ title: "x" });
    expect(readPropertySetStream(bytes).properties.get(1)).toEqual({
      type: "VT_I2",
      value: 1200,
    });
  });

  it("reads a zero FILETIME (the conventional 'never printed' spelling) back as absent", () => {
    // [MS-OLEPS] 2.15: an all-zero FILETIME (low=0, high=0) decodes to the FILETIME epoch itself, 1601-01-01T00:00:00Z -- the value a real producer writes for "never printed" rather than omitting PIDSI_LASTPRINTED outright.
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties: new Map([
        [
          11,
          { type: "VT_FILETIME", value: new Date("1601-01-01T00:00:00.000Z") },
        ],
      ]), // PIDSI_LASTPRINTED
    });
    expect(readSummaryInformation(bytes).lastPrintedIso).toBeUndefined();
  });

  it("throws PropertySetFormatError for a stream whose FMTID is not FMTID_SummaryInformation", () => {
    const bytes = writePropertySetStream({
      formatId: "{D5CDD502-2E9C-101B-9397-08002B2CF9AE}", // FMTID_DocSummaryInformation
      properties: new Map([[2, { type: "VT_LPWSTR", value: "x" }]]),
    });
    expect(() => readSummaryInformation(bytes)).toThrow(PropertySetFormatError);
  });

  it("throws PropertySetFormatError when a known field's property has the wrong type", () => {
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties: new Map([[2, { type: "VT_I4", value: 1 }]]), // PIDSI_TITLE, wrong type
    });
    expect(() => readSummaryInformation(bytes)).toThrow(PropertySetFormatError);
  });
});
