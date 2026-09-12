import { describe, expect, it } from "vitest";
import {
  RtfInputTooLargeError,
  RtfNestingLimitExceededError,
  RtfNotAnRtfDocumentError,
  RtfParseError,
  RtfUnsupportedDocumentKindError,
  RtfWriteError,
} from "./diagnostics";

describe("RtfParseError", () => {
  it("carries the given code and message, named RtfParseError", () => {
    const error = new RtfParseError("rtf/example", "an example message");
    expect(error.name).toBe("RtfParseError");
    expect(error.code).toBe("rtf/example");
    expect(error.message).toBe("an example message");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("RtfNotAnRtfDocumentError", () => {
  it("defaults to its own code and message", () => {
    const error = new RtfNotAnRtfDocumentError();
    expect(error.name).toBe("RtfNotAnRtfDocumentError");
    expect(error.code).toBe("rtf/not-an-rtf-document");
    expect(error.message).toBe("input does not begin with '{\\rtf'");
    expect(error).toBeInstanceOf(RtfParseError);
  });

  it("accepts a caller-supplied message while keeping its own code", () => {
    const error = new RtfNotAnRtfDocumentError("custom message");
    expect(error.message).toBe("custom message");
    expect(error.code).toBe("rtf/not-an-rtf-document");
  });
});

describe("RtfInputTooLargeError", () => {
  it("names its own code, byteLength, maxInputBytes, and a message stating both", () => {
    const error = new RtfInputTooLargeError(100, 64);
    expect(error.name).toBe("RtfInputTooLargeError");
    expect(error.code).toBe("rtf/input-too-large");
    expect(error.byteLength).toBe(100);
    expect(error.maxInputBytes).toBe(64);
    expect(error.message).toBe("input is 100 bytes, over the 64-byte limit");
    expect(error).toBeInstanceOf(RtfParseError);
  });
});

describe("RtfNestingLimitExceededError", () => {
  it("names its own code, maxGroupDepth, and a message stating it", () => {
    const error = new RtfNestingLimitExceededError(256);
    expect(error.name).toBe("RtfNestingLimitExceededError");
    expect(error.code).toBe("rtf/nesting-limit-exceeded");
    expect(error.maxGroupDepth).toBe(256);
    expect(error.message).toBe("group nesting exceeded the 256-level limit");
    expect(error).toBeInstanceOf(RtfParseError);
  });
});

describe("RtfWriteError", () => {
  it("carries the given code and message, named RtfWriteError", () => {
    const error = new RtfWriteError(
      "rtf/example-write",
      "a write-side message",
    );
    expect(error.name).toBe("RtfWriteError");
    expect(error.code).toBe("rtf/example-write");
    expect(error.message).toBe("a write-side message");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("RtfUnsupportedDocumentKindError", () => {
  it("names its own code, documentKind, and a message stating it", () => {
    const error = new RtfUnsupportedDocumentKindError("spreadsheet");
    expect(error.name).toBe("RtfUnsupportedDocumentKindError");
    expect(error.code).toBe("rtf/unsupported-document-kind");
    expect(error.documentKind).toBe("spreadsheet");
    expect(error.message).toBe(
      "RTF is a wordprocessing format; a 'spreadsheet' ContentDocument has no RTF representation",
    );
    expect(error).toBeInstanceOf(RtfWriteError);
  });
});
