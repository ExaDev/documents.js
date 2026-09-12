import type { ContentDocument } from "documents.js";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../test/mockRpcClient";
import { renderHookWithQueryClient } from "../test/renderHook";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../rpc/client";
import { useReadOdb } from "./useOdbInventory";

describe("useReadOdb", () => {
  it("calls odb.read with the given input and resolves its result", async () => {
    const client = createMockRpcClient();
    const content: ContentDocument = {
      kind: "spreadsheet",
      metadata: {},
      sheets: [],
    };
    const output = {
      inventory: {
        tables: [] as string[],
        queries: [] as {
          name: string;
          command: string;
          escapeProcessing?: boolean;
        }[],
        forms: [] as { name: string; href: string; asTemplate?: boolean }[],
        reports: [] as { name: string; href: string; asTemplate?: boolean }[],
      },
      content,
    };
    vi.mocked(client.odb.read).mockResolvedValue(output);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() => useReadOdb());
    const input = { bytes: new Uint8Array([1]) };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.odb.read).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(output);
    unmount();
  });
});
