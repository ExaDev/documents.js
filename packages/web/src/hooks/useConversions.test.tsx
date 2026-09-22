import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../test/mockRpcClient";
import { renderHookWithQueryClient } from "../test/renderHook";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../rpc/client";
import { useConversions, useDocumentFormats } from "./useConversions";

describe("useConversions", () => {
  it("fetches the conversion pair list via formats.listConversions", async () => {
    const client = createMockRpcClient();
    const pairs: { source: "docx"; target: "pdf" }[] = [
      { source: "docx", target: "pdf" },
    ];
    vi.mocked(client.formats.listConversions).mockResolvedValue(pairs);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, queryClient, unmount } = renderHookWithQueryClient(() =>
      useConversions(),
    );
    await vi.waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(pairs);
    expect(client.formats.listConversions).toHaveBeenCalledTimes(1);
    // Pins the exact queryKey the hook registers under, not just that it eventually resolves data — a mutated key would still let the query above succeed, but would cache the result under a different key from the one this asserts against.
    expect(queryClient.getQueryData(["formats", "listConversions"])).toEqual(
      pairs,
    );
    unmount();
  });
});

describe("useDocumentFormats", () => {
  it("fetches the document format list via formats.list", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockResolvedValue(["docx", "pdf"]);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, queryClient, unmount } = renderHookWithQueryClient(() =>
      useDocumentFormats(),
    );
    await vi.waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(["docx", "pdf"]);
    // Pins the exact queryKey the hook registers under — see the identical comment in the useConversions test above.
    expect(queryClient.getQueryData(["formats", "list"])).toEqual([
      "docx",
      "pdf",
    ]);
    unmount();
  });
});
