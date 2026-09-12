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

    const { result, unmount } = renderHookWithQueryClient(() =>
      useConversions(),
    );
    await vi.waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(pairs);
    expect(client.formats.listConversions).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("useDocumentFormats", () => {
  it("fetches the document format list via formats.list", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.formats.list).mockResolvedValue(["docx", "pdf"]);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useDocumentFormats(),
    );
    await vi.waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(["docx", "pdf"]);
    unmount();
  });
});
