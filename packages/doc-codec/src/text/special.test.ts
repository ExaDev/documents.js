import { describe, expect, it } from "vitest";
import {
  ANNOTATION_REFERENCE,
  CELL_MARK,
  DRAWN_OBJECT,
  endsParagraph,
  FIELD_BEGIN,
  FIELD_END,
  FIELD_SEPARATOR,
  FOOTNOTE_REFERENCE,
  INLINE_PICTURE,
  isAnchorOnly,
  PARAGRAPH_MARK,
  SECTION_MARK,
} from "./special";

describe("endsParagraph", () => {
  it("recognises the paragraph mark", () => {
    expect(endsParagraph(PARAGRAPH_MARK)).toBe(true);
  });

  it("recognises the cell mark", () => {
    expect(endsParagraph(CELL_MARK)).toBe(true);
  });

  it("recognises the end-of-section character", () => {
    expect(endsParagraph(SECTION_MARK)).toBe(true);
  });

  it("does not treat an ordinary character as a paragraph terminator", () => {
    expect(endsParagraph(0x41)).toBe(false); // 'A'
  });

  it("does not treat a field character as a paragraph terminator", () => {
    expect(endsParagraph(FIELD_BEGIN)).toBe(false);
  });
});

describe("isAnchorOnly", () => {
  it("recognises the inline-picture anchor", () => {
    expect(isAnchorOnly(INLINE_PICTURE)).toBe(true);
  });

  it("recognises the footnote reference anchor", () => {
    expect(isAnchorOnly(FOOTNOTE_REFERENCE)).toBe(true);
  });

  it("recognises the annotation reference anchor", () => {
    expect(isAnchorOnly(ANNOTATION_REFERENCE)).toBe(true);
  });

  it("recognises the drawn-object anchor", () => {
    expect(isAnchorOnly(DRAWN_OBJECT)).toBe(true);
  });

  it("does not treat an ordinary character as an anchor", () => {
    expect(isAnchorOnly(0x41)).toBe(false); // 'A'
  });

  it("does not treat the paragraph mark as an anchor", () => {
    expect(isAnchorOnly(PARAGRAPH_MARK)).toBe(false);
  });

  it("does not treat a field character as an anchor", () => {
    expect(isAnchorOnly(FIELD_SEPARATOR)).toBe(false);
    expect(isAnchorOnly(FIELD_END)).toBe(false);
  });
});
