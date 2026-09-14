import type * as DocumentsJs from "documents.js";
import { describe, expect, it, vi } from "vitest";
import { createNewDocument } from "./open-document.js";
import { metadataFor } from "./read-metadata.js";

// A dedicated file, isolated from read-metadata.test.ts's own real-fixture tests: mocking every readXContent reader here is file-wide, so it must never share a module with a test that needs the genuine implementation. Proves metadataFor's switch dispatches to the ONE reader matching its own case, not a neighbouring one -- docx/pptx are adjacent OOXML cases sharing the identical docProps/core.xml metadata convention, and odt/odp/ods/odg are adjacent ODF cases sharing the identical meta.xml convention, so a case whose own `return` were lost to a fall-through into the next case would still read a structurally valid, often equal, LayoutMetadata object from the wrong reader -- real-fixture equality assertions comparing metadataFor's result against the SAME reader called a second time can't tell a genuine dispatch from a silent fall-through that happens to land on a compatible reader. Each mock returns a distinct, unmistakable sentinel instead, so only an exact reader match can satisfy the assertion.
vi.mock("documents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentsJs>();
  return {
    ...actual,
    readDocxContent: vi.fn(() => ({ metadata: { title: "docx-sentinel" } })),
    readPptxContent: vi.fn(() => ({ metadata: { title: "pptx-sentinel" } })),
    readOdtContent: vi.fn(() => ({ metadata: { title: "odt-sentinel" } })),
    readOdpContent: vi.fn(() => ({ metadata: { title: "odp-sentinel" } })),
    readOdsContent: vi.fn(() => ({ metadata: { title: "ods-sentinel" } })),
    readOdgContent: vi.fn(() => ({ metadata: { title: "odg-sentinel" } })),
    readMarkdownContent: vi.fn(() => ({
      metadata: { title: "markdown-sentinel" },
    })),
  };
});

describe("metadataFor dispatches to exactly its own case's reader", () => {
  it("reads docx through readDocxContent alone", () => {
    const doc = createNewDocument("docx");
    expect(metadataFor(doc).title).toBe("docx-sentinel");
  });

  it("reads pptx through readPptxContent alone", () => {
    const doc = createNewDocument("pptx");
    expect(metadataFor(doc).title).toBe("pptx-sentinel");
  });

  it("reads odt through readOdtContent alone", () => {
    const doc = createNewDocument("odt");
    expect(metadataFor(doc).title).toBe("odt-sentinel");
  });

  it("reads odp through readOdpContent alone", () => {
    const doc = createNewDocument("odp");
    expect(metadataFor(doc).title).toBe("odp-sentinel");
  });

  it("reads ods through readOdsContent alone", () => {
    const doc = createNewDocument("ods");
    expect(metadataFor(doc).title).toBe("ods-sentinel");
  });

  it("reads odg through readOdgContent alone", () => {
    const doc = createNewDocument("odg");
    expect(metadataFor(doc).title).toBe("odg-sentinel");
  });

  it("reads markdown through readMarkdownContent alone", () => {
    const doc = createNewDocument("markdown");
    expect(metadataFor(doc).title).toBe("markdown-sentinel");
  });
});
