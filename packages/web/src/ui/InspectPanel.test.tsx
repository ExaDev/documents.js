import { afterEach, describe, expect, it } from "vitest";

import type {
  ContentInspectResult,
  PdfInspectResult,
} from "../hooks/useInspect";
import { SAMPLE_DOCUMENT_TREE } from "../test/fixtures";
import { mountWithMantine } from "../test/mountComponent";
import { InspectPanel } from "./InspectPanel";

let unmount: (() => void) | undefined;

afterEach(() => {
  unmount?.();
  unmount = undefined;
});

function renderPanel(props: Parameters<typeof InspectPanel>[0]): string {
  const mounted = mountWithMantine(<InspectPanel {...props} />);
  unmount = mounted.unmount;
  return mounted.container.innerHTML;
}

function contentResult(
  overrides: Partial<ContentInspectResult> = {},
): ContentInspectResult {
  return {
    backing: "content",
    diagnostics: [],
    summary: ["1 section", "1 paragraph"],
    package: SAMPLE_DOCUMENT_TREE,
    ...overrides,
  };
}

function pdfResult(
  overrides: Partial<PdfInspectResult> = {},
): PdfInspectResult {
  return {
    backing: "pdf",
    diagnostics: [],
    pageCount: 2,
    itemKindCounts: { text: 3, image: 1 },
    metadata: {},
    layout: { formatVersion: 1, metadata: {}, pages: [], images: {} },
    ...overrides,
  };
}

describe("InspectPanel", () => {
  it("renders a skeleton while loading, regardless of any data or error also present", () => {
    const html = renderPanel({ loading: true, data: contentResult() });
    expect(html).toContain("mantine-Skeleton-root");
  });

  it("renders an error alert when an error is present and not loading", () => {
    const html = renderPanel({ error: new Error("boom") });
    expect(html).toContain("Could not inspect this document.");
  });

  it("renders nothing when there is no data, no error, and not loading", () => {
    const html = renderPanel({});
    expect(html).not.toContain("mantine-Stack-root");
    expect(html).not.toContain("mantine-Skeleton-root");
    expect(html).not.toContain("Could not inspect");
  });

  it("renders a content-backed result's summary lines and structure tree", () => {
    const html = renderPanel({
      data: contentResult({ summary: ["2 sections", "5 paragraphs"] }),
    });
    expect(html).toContain("2 sections");
    expect(html).toContain("5 paragraphs");
    expect(html).toContain("Document structure");
    expect(html).toContain("mantine-Tree-root");
  });

  it("renders a pdf-backed result's plural page count, item-kind table, and structure tree", () => {
    const html = renderPanel({ data: pdfResult({ pageCount: 2 }) });
    expect(html).toContain("2");
    expect(html).toContain("pages");
    expect(html).toContain("text");
    expect(html).toContain("3");
    expect(html).toContain("image");
    expect(html).toContain("1");
  });

  it("renders a pdf-backed result's page count as singular for exactly one page", () => {
    const html = renderPanel({ data: pdfResult({ pageCount: 1 }) });
    expect(html).toContain(">1</strong> page<");
  });

  it("shows the title and producer lines when metadata carries them", () => {
    const html = renderPanel({
      data: pdfResult({
        metadata: { title: "My Document", producer: "Acme PDF" },
      }),
    });
    expect(html).toContain("Title: My Document");
    expect(html).toContain("Producer: Acme PDF");
  });

  it("omits the title and producer lines when metadata carries neither", () => {
    const html = renderPanel({ data: pdfResult({ metadata: {} }) });
    expect(html).not.toContain("Title:");
    expect(html).not.toContain("Producer:");
  });
});
