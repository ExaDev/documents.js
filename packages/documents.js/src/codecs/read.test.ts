import { describe, expect, it, vi } from "vitest";
import { CONTENT_READERS, readDocumentLayout } from "./read";
import { encodeMarkdownText } from "../markdown/text";

describe("CONTENT_READERS.markdown", () => {
  it("forwards the images resolver through to readMarkdownContent", () => {
    const resolver = vi.fn(() => undefined);
    CONTENT_READERS.markdown(encodeMarkdownText("![alt](img.png)"), {
      images: resolver,
    });
    expect(resolver).toHaveBeenCalledWith("img.png", expect.anything());
  });

  it("forwards the abort signal through to readMarkdownContent, which checks it before parsing", () => {
    const controller = new AbortController();
    controller.abort();
    let caught: unknown;
    try {
      CONTENT_READERS.markdown(encodeMarkdownText("hi"), {
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");
  });
});

describe("CONTENT_READERS.rtf", () => {
  it("forwards the abort signal through to readRtfContent, which checks it before tokenizing", () => {
    const controller = new AbortController();
    controller.abort();
    let caught: unknown;
    try {
      CONTENT_READERS.rtf(new TextEncoder().encode("{\\rtf1 hi}"), {
        signal: controller.signal,
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");
  });
});

describe("readDocumentLayout", () => {
  it("forwards the signal option through to readPdf, which checks it before parsing", () => {
    const controller = new AbortController();
    controller.abort();
    // A real "%PDF-" header but otherwise garbage bytes: readPdf checks the header first, then the abort signal, before it ever opens the document -- if the signal were not forwarded (an empty options object), this would fail trying to parse the document instead.
    const bytes = new TextEncoder().encode("%PDF-1.4\n%garbage");
    let caught: unknown;
    try {
      readDocumentLayout(bytes, { signal: controller.signal });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(DOMException);
    expect((caught as DOMException).name).toBe("AbortError");
  });
});
