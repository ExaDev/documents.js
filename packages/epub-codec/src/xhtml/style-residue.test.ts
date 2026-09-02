import { describe, expect, it, vi } from "vitest";
import { readXhtmlBody } from "./read";

const CONTENT_WIDTH_PT = 451.28;

function bodyWithHead(headInner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head>${headInner}</head><body><p>text</p></body></html>`;
}

describe("readXhtmlBody: <head> style residue", () => {
  it("quarantines a <link rel=stylesheet> as residue, with a diagnostic", () => {
    const sink = vi.fn();
    const { source } = readXhtmlBody(
      bodyWithHead('<link rel="stylesheet" href="styles.css"/>'),
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(source).toEqual({
      format: "epub",
      xml: '<link rel="stylesheet" href="styles.css"></link>',
    });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({ code: "epub/style-residue" }),
    );
  });

  it("quarantines an inline <style> element as residue", () => {
    const { source } = readXhtmlBody(
      bodyWithHead("<style>p { color: red; }</style>"),
      {
        resolveImage: () => undefined,
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(source?.format).toBe("epub");
    expect(source?.xml).toContain("color: red");
  });

  it("carries no residue when the head has no style declarations", () => {
    const { source } = readXhtmlBody(bodyWithHead("<title>No styles</title>"), {
      resolveImage: () => undefined,
      sink: () => undefined,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    });
    expect(source).toBeUndefined();
  });
});
