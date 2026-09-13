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

  it("does not quarantine a <link> whose rel is not stylesheet, nor an unrelated element that merely carries a rel=stylesheet attribute", () => {
    // Distinguishes the two-part `node.tag === "link" && attrValue(node, "rel") === "stylesheet"` test from either half alone: a <link> with the wrong rel, and a non-<link> tag that happens to carry rel="stylesheet", must each fail the full conjunction on their own.
    const { source } = readXhtmlBody(
      bodyWithHead('<link rel="icon" href="a.ico"/><meta rel="stylesheet"/>'),
      {
        resolveImage: () => undefined,
        sink: () => undefined,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(source).toBeUndefined();
  });

  it("states the exact style-residue diagnostic message", () => {
    const sink = vi.fn();
    readXhtmlBody(bodyWithHead("<style>p { color: red; }</style>"), {
      resolveImage: () => undefined,
      sink,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    });
    expect(sink).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "the document's own <head> style declarations (CSS) are quarantined as residue rather than interpreted; the schema is content, not styling",
      }),
    );
  });
});
