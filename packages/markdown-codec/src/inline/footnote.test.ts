import { describe, expect, it } from "vitest";
import {
  isValidFootnoteLabel,
  matchFootnoteDefinitionMarker,
  matchFootnoteLabel,
} from "./footnote";

describe("matchFootnoteLabel", () => {
  it("matches a `[^label]` marker and reports the index one past its closing bracket", () => {
    expect(matchFootnoteLabel("[^abc] rest", 0)).toEqual({
      label: "abc",
      end: 6,
    });
  });

  it("returns undefined for a bracket that is not a footnote label at all", () => {
    expect(matchFootnoteLabel("[abc] rest", 0)).toBeUndefined();
  });
});

describe("matchFootnoteDefinitionMarker", () => {
  it("matches a real `[^label]:` definition marker", () => {
    expect(matchFootnoteDefinitionMarker("[^abc]: body text")).toEqual({
      label: "abc",
      markerLength: 7,
    });
  });

  it("rejects a valid label marker with no following colon -- this is a reference, not a definition", () => {
    expect(
      matchFootnoteDefinitionMarker("[^abc] not a definition"),
    ).toBeUndefined();
  });

  it("rejects text that is not even a valid footnote label", () => {
    expect(
      matchFootnoteDefinitionMarker("not a marker at all"),
    ).toBeUndefined();
  });
});

describe("isValidFootnoteLabel", () => {
  it("accepts an ordinary label", () => {
    expect(isValidFootnoteLabel("note-1")).toBe(true);
  });

  it("rejects a label carrying whitespace or a bracket, which this grammar cannot represent", () => {
    expect(isValidFootnoteLabel("has space")).toBe(false);
    expect(isValidFootnoteLabel("has]bracket")).toBe(false);
  });
});
