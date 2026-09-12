import { assembleTree } from "document-schema.js";
import type { ContentDocument } from "documents.js";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../test/mockRpcClient";
import { renderHookWithQueryClient } from "../test/renderHook";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../rpc/client";
import { useReadContent, useRestoreContent } from "./useContentDump";

describe("useReadContent", () => {
  it("calls content.read with the given input and resolves its result", async () => {
    const client = createMockRpcClient();
    const content: ContentDocument = {
      kind: "wordprocessing",
      metadata: {},
      sections: [],
    };
    const output = {
      content,
      // Stamped by hand rather than via documents.js's own documentTreeWithSchema helper: UI code (this file lives under src/hooks/) may not import documents.js's runtime functions directly (see eslint.config.ts's import-boundary rule), and the schema's own $schema field is a plain string, not a pinned literal, so a hand-applied stamp is exactly as valid a fixture as the real helper's output.
      package: { ...assembleTree(content), $schema: "test-schema" },
    };
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

describe("useRestoreContent", () => {
  it("calls content.restore with the given input and resolves its bytes", async () => {
    const client = createMockRpcClient();
    const output = { bytes: new Uint8Array([1, 2]) };
    vi.mocked(client.content.restore).mockResolvedValue(output);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useRestoreContent(),
    );
    const input = { format: "docx" as const, package: {} };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.content.restore).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(output);
    unmount();
  });
});
