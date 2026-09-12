import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../test/mockRpcClient";
import { renderHookWithQueryClient } from "../test/renderHook";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../rpc/client";
import { useReadMetadata, useWriteMetadata } from "./useMetadata";

describe("useReadMetadata", () => {
  it("calls metadata.read with the given input and resolves its result", async () => {
    const client = createMockRpcClient();
    const metadata = { title: "a title" };
    vi.mocked(client.metadata.read).mockResolvedValue(metadata);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useReadMetadata(),
    );
    const input = { format: "docx" as const, bytes: new Uint8Array([1]) };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.metadata.read).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(metadata);
    unmount();
  });
});

describe("useWriteMetadata", () => {
  it("calls metadata.write with the given input and resolves its bytes", async () => {
    const client = createMockRpcClient();
    const bytes = new Uint8Array([9, 9]);
    vi.mocked(client.metadata.write).mockResolvedValue(bytes);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useWriteMetadata(),
    );
    const input = {
      sourceFormat: "docx" as const,
      targetFormat: "docx" as const,
      bytes: new Uint8Array([1]),
      overrides: {},
    };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.metadata.write).toHaveBeenCalledWith(input);
    expect(resolved).toBe(bytes);
    unmount();
  });
});
