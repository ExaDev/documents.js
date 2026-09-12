import { assembleTree } from "document-schema.js";
import type { ContentDocument } from "documents.js";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../test/mockRpcClient";
import { renderHookWithQueryClient } from "../test/renderHook";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../rpc/client";
import {
  contentInspectResult,
  useInspectDocument,
  useInspectPdfBytes,
  useReadContent,
} from "./useInspect";

const wordprocessing: ContentDocument = {
  kind: "wordprocessing",
  metadata: {},
  sections: [
    {
      pageSize: { widthPt: 595, heightPt: 842 },
      margins: { topPt: 0, rightPt: 0, bottomPt: 0, leftPt: 0 },
      blocks: [{ kind: "paragraph", runs: [{ text: "x" }] }],
    },
  ],
};

describe("contentInspectResult", () => {
  it("builds a content-backed InspectResult with no diagnostics and the variant-aware summary", () => {
    const pkg = { ...assembleTree(wordprocessing), $schema: "test-schema" };
    const result = contentInspectResult({
      content: wordprocessing,
      package: pkg,
    });

    expect(result).toEqual({
      backing: "content",
      diagnostics: [],
      summary: ["1 section", "1 block"],
      package: pkg,
    });
  });
});

describe("useReadContent", () => {
  it("calls content.read with the given input and resolves its result", async () => {
    const client = createMockRpcClient();
    const pkg = { ...assembleTree(wordprocessing), $schema: "test-schema" };
    const output = { content: wordprocessing, package: pkg };
    vi.mocked(client.content.read).mockResolvedValue(output);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useReadContent(),
    );
    const input = { format: "docx" as const, bytes: new Uint8Array([1]) };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.content.read).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(output);
    unmount();
  });
});

const pdfInspectOutput = {
  pageCount: 2,
  itemKindCounts: { text: 3 },
  metadata: { title: "a title" },
  layout: { formatVersion: 1 as const, metadata: {}, pages: [], images: {} },
};

describe("useInspectPdfBytes", () => {
  it("calls pdf.inspect with the given bytes and tags the result as pdf-backed with no diagnostics", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.pdf.inspect).mockResolvedValue(pdfInspectOutput);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useInspectPdfBytes(),
    );
    const bytes = new Uint8Array([1, 2]);
    const resolved = await act(() => result.current.mutateAsync(bytes));

    expect(client.pdf.inspect).toHaveBeenCalledWith({ bytes });
    expect(resolved).toEqual({
      backing: "pdf",
      ...pdfInspectOutput,
      diagnostics: [],
    });
    unmount();
  });
});

describe("useInspectDocument", () => {
  it("inspects PDF bytes directly, without converting first, when the source format is already pdf", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.pdf.inspect).mockResolvedValue(pdfInspectOutput);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useInspectDocument(),
    );
    const bytes = new Uint8Array([1]);
    const resolved = await act(() =>
      result.current.mutateAsync({ format: "pdf", bytes }),
    );

    expect(client.convert).not.toHaveBeenCalled();
    expect(client.pdf.inspect).toHaveBeenCalledWith({ bytes });
    expect(resolved).toEqual({
      backing: "pdf",
      ...pdfInspectOutput,
      diagnostics: [],
    });
    unmount();
  });

  it("converts a non-pdf source to pdf first, then inspects the converted bytes and surfaces the conversion's own diagnostics", async () => {
    const client = createMockRpcClient();
    const convertedBytes = new Uint8Array([9, 9]);
    const diagnostics = [
      {
        severity: "warning" as const,
        code: "font-sub",
        message: "substituted a font",
      },
    ];
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf" as const, bytes: convertedBytes },
      diagnostics,
      content: undefined,
    });
    vi.mocked(client.pdf.inspect).mockResolvedValue(pdfInspectOutput);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useInspectDocument(),
    );
    const sourceBytes = new Uint8Array([1]);
    const resolved = await act(() =>
      result.current.mutateAsync({ format: "docx", bytes: sourceBytes }),
    );

    expect(client.convert).toHaveBeenCalledWith({
      source: "docx",
      targetFormat: "pdf",
      bytes: sourceBytes,
    });
    expect(client.pdf.inspect).toHaveBeenCalledWith({ bytes: convertedBytes });
    expect(resolved).toEqual({
      backing: "pdf",
      ...pdfInspectOutput,
      diagnostics,
    });
    unmount();
  });
});
