import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../test/mockRpcClient";
import { renderHookWithQueryClient } from "../test/renderHook";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../rpc/client";
import { useExtractSourceFonts } from "./useFonts";

describe("useExtractSourceFonts", () => {
  it("calls fonts.extractSourceFonts with the given input and resolves its result", async () => {
    const client = createMockRpcClient();
    const fonts = [{ family: "Times New Roman", bold: false, italic: false }];
    vi.mocked(client.fonts.extractSourceFonts).mockResolvedValue(fonts);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useExtractSourceFonts(),
    );
    const input = { format: "docx" as const, bytes: new Uint8Array([1]) };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.fonts.extractSourceFonts).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(fonts);
    unmount();
  });
});
