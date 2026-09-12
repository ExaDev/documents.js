import { describe, expect, it } from "vitest";
import { readPropertySetStream } from "./read";
import {
  FMTID_SUMMARY_INFORMATION,
  readSummaryInformation,
  writeSummaryInformationStream,
} from "./summary-information";
import { writePropertySetStream } from "./write";
import { propertySetStream } from "../test-support/oleps";

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

  it("joins keywords with ', ' and splits them back apart", () => {
    const bytes = writeSummaryInformationStream({ keywords: ["a", "b", "c"] });
    const propertySet = readPropertySetStream(bytes);
    expect(propertySet.properties.get(5)).toEqual({
      type: "VT_LPWSTR",
      value: "a, b, c",
    });
    expect(readSummaryInformation(bytes).keywords).toEqual(["a", "b", "c"]);
  });

  it("drops empty entries a hand-written KEYWORDS value carries between commas", () => {
    // writeSummaryInformationStream's own join never produces an empty segment, so this builds the KEYWORDS property directly to exercise splitKeywords' own filter -- a real producer's comma-separated field is not guaranteed free of doubled or trailing delimiters.
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties: new Map([[5, { type: "VT_LPWSTR", value: "a,,b, ,c" }]]), // PIDSI_KEYWORDS
    });
    expect(readSummaryInformation(bytes).keywords).toEqual(["a", "b", "c"]);
  });

  it("reads keywords back as absent when every comma-separated entry is empty or whitespace", () => {
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties: new Map([[5, { type: "VT_LPWSTR", value: " , , " }]]), // PIDSI_KEYWORDS
    });
    expect(readSummaryInformation(bytes).keywords).toBeUndefined();
  });

  it("writes no KEYWORDS property for a defined but empty keywords array", () => {
    const bytes = writeSummaryInformationStream({ keywords: [] });
    expect(readPropertySetStream(bytes).properties.has(5)).toBe(false); // PIDSI_KEYWORDS
  });

  it("reads a genuine VT_LPSTR string property exactly as it reads the VT_LPWSTR this module itself writes", () => {
    // writeSummaryInformationStream never writes VT_LPSTR (see write.ts's own scope note; writePropertySetStream itself refuses to encode one), so a round trip through this module's own writer never exercises stringValue's VT_LPSTR branch -- built instead through test-support's own encoder, which supports VT_LPSTR directly, against a real producer's more common ANSI string encoding.
    const bytes = propertySetStream(FMTID_SUMMARY_INFORMATION, [
      { pid: 4, value: { type: "VT_LPSTR", value: "Ansi Author" } }, // PIDSI_AUTHOR
    ]);
    expect(readSummaryInformation(bytes).author).toBe("Ansi Author");
  });

  it("reads an explicit empty string property back as absent, not as an empty string", () => {
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties: new Map([[3, { type: "VT_LPWSTR", value: "" }]]), // PIDSI_SUBJECT
    });
    expect(readSummaryInformation(bytes).subject).toBeUndefined();
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
    expect(() => readSummaryInformation(bytes)).toThrow(
      'property set stream declares FMTID {D5CDD502-2E9C-101B-9397-08002B2CF9AE}, not FMTID_SummaryInformation ({F29F85E0-4FF9-1068-AB91-08002B27B3D9}); this is not a "\\x05SummaryInformation" stream',
    );
  });

  it("throws PropertySetFormatError when a known string field's property has the wrong type", () => {
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties: new Map([[2, { type: "VT_I4", value: 1 }]]), // PIDSI_TITLE, wrong type
    });
    expect(() => readSummaryInformation(bytes)).toThrow(
      "SummaryInformation property 2 has type VT_I4, not a string type as [MS-OLEPS]'s SummaryInformation Property Set defines",
    );
  });

  it("throws PropertySetFormatError when a known date field's property has the wrong type", () => {
    const bytes = writePropertySetStream({
      formatId: FMTID_SUMMARY_INFORMATION,
      properties: new Map([[12, { type: "VT_I4", value: 1 }]]), // PIDSI_CREATE_DTM, wrong type
    });
    expect(() => readSummaryInformation(bytes)).toThrow(
      "SummaryInformation property 12 has type VT_I4, not VT_FILETIME as [MS-OLEPS]'s SummaryInformation Property Set defines",
    );
  });
});
