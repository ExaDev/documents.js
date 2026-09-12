import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../test/mockRpcClient";
import { renderHookWithQueryClient } from "../test/renderHook";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../rpc/client";
import { useOdmRender } from "./useOdmRender";

describe("useOdmRender", () => {
  it("calls odm.render with the given input and resolves its result", async () => {
    const client = createMockRpcClient();
    const output = { ok: true as const, pdf: new Uint8Array([1, 2]) };
    vi.mocked(client.odm.render).mockResolvedValue(output);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() => useOdmRender());
    const input = {
      master: new Uint8Array([1]),
      chapters: [{ href: "ch1.odt", bytes: new Uint8Array([2]) }],
    };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.odm.render).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(output);
    unmount();
  });
});
