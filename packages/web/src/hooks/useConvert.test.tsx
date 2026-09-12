import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../test/mockRpcClient";
import { renderHookWithQueryClient } from "../test/renderHook";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../rpc/client";
import { useConvert } from "./useConvert";

describe("useConvert", () => {
  it("drives convertViaWorker's convert call and resolves its result", async () => {
    const client = createMockRpcClient();
    const output = {
      document: { format: "pdf" as const, bytes: new Uint8Array([1]) },
      diagnostics: [],
      content: undefined,
    };
    vi.mocked(client.convert).mockResolvedValue(output);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() => useConvert());
    const input = {
      source: "docx" as const,
      targetFormat: "pdf" as const,
      bytes: new Uint8Array([1]),
    };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.convert).toHaveBeenCalledWith(
      { source: "docx", targetFormat: "pdf", bytes: input.bytes },
      { signal: undefined },
    );
    expect(resolved).toEqual(output);
    unmount();
  });
});
