// The pure format-family predicates split from _document.convert.test.tsx's own suite: they exercise exported functions directly and need none of that suite's component harness, so they live here rather than padding its line count.

import { describe, expect, it } from "vitest";

import {
  isContentBackedPreview,
  isSheetFormat,
  isSlidesFormat,
  isWordProcessingFormat,
} from "./_document.convert";

describe("format-family predicates", () => {
  it("isSheetFormat is true for every spreadsheet-kind format and false otherwise", () => {
    expect(isSheetFormat("xlsx")).toBe(true);
    expect(isSheetFormat("ods")).toBe(true);
    expect(isSheetFormat("csv")).toBe(true);
    expect(isSheetFormat("xls")).toBe(true);
    expect(isSheetFormat("docx")).toBe(false);
    expect(isSheetFormat(null)).toBe(false);
  });

  it("isWordProcessingFormat is true for every wordprocessing-kind format and false otherwise", () => {
    expect(isWordProcessingFormat("docx")).toBe(true);
    expect(isWordProcessingFormat("odt")).toBe(true);
    expect(isWordProcessingFormat("rtf")).toBe(true);
    expect(isWordProcessingFormat("doc")).toBe(true);
    expect(isWordProcessingFormat("epub")).toBe(true);
    expect(isWordProcessingFormat("xlsx")).toBe(false);
    expect(isWordProcessingFormat(null)).toBe(false);
  });

  it("isSlidesFormat is true for every presentation/drawing-kind format and false otherwise", () => {
    expect(isSlidesFormat("pptx")).toBe(true);
    expect(isSlidesFormat("odp")).toBe(true);
    expect(isSlidesFormat("odg")).toBe(true);
    expect(isSlidesFormat("svg")).toBe(true);
    expect(isSlidesFormat("ppt")).toBe(true);
    expect(isSlidesFormat("docx")).toBe(false);
    expect(isSlidesFormat(null)).toBe(false);
  });

  it("isContentBackedPreview is false only for pdf and null", () => {
    expect(isContentBackedPreview("docx")).toBe(true);
    expect(isContentBackedPreview("markdown")).toBe(true);
    expect(isContentBackedPreview("pdf")).toBe(false);
    expect(isContentBackedPreview(null)).toBe(false);
  });
});
