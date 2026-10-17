import { describe, expect, it, vi } from "vitest";
import type * as PdfCodecRead from "pdf-codec/read";
import { readPdf } from "pdf-codec/read";
import { markdownToPdf } from "./convert";
import { readDocumentMetadata } from "./from-pdf";
import { encodeMarkdownText } from "../markdown/text";

// readPdf wrapped so the test can see which pages a metadata read asked for. The real reader still runs.
vi.mock("pdf-codec/read", async (importOriginal) => {
  const actual = await importOriginal<typeof PdfCodecRead>();
  return { ...actual, readPdf: vi.fn(actual.readPdf) };
});

describe("readDocumentMetadata for a pdf", () => {
  it("reads no page, and reports the same metadata a full read does", () => {
    const pdf = markdownToPdf(
      encodeMarkdownText("# Title\n\nBody.\n\n<!-- page break -->\n\nMore.\n"),
    );
    vi.mocked(readPdf).mockClear();
    const metadata = readDocumentMetadata("pdf", pdf);
    expect(
      vi.mocked(readPdf).mock.calls.map(([, options]) => options?.pages),
    ).toEqual([[]]);
    expect(metadata).toEqual(vi.mocked(readPdf)(pdf).metadata);
  });
});
