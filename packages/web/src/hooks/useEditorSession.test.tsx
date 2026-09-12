import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../test/mockRpcClient";
import { renderHookWithQueryClient } from "../test/renderHook";

vi.mock("../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../rpc/client";
import {
  useAddParagraph,
  useOpenEditor,
  useRemoveParagraph,
  useSaveEditor,
  useSetParagraphText,
} from "./useEditorSession";

const snapshot = { id: 1, paragraphs: ["a", "b"] };

describe("useOpenEditor", () => {
  it("calls editor.open with the given input and resolves its snapshot", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.open).mockResolvedValue(snapshot);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useOpenEditor(),
    );
    const input = { format: "markdown" as const, bytes: new Uint8Array([1]) };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.editor.open).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(snapshot);
    unmount();
  });
});

describe("useSetParagraphText", () => {
  it("calls editor.setParagraphText with the given input and resolves its snapshot", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.setParagraphText).mockResolvedValue(snapshot);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useSetParagraphText(),
    );
    const input = { id: 1, index: 0, text: "edited" };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.editor.setParagraphText).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(snapshot);
    unmount();
  });
});

describe("useAddParagraph", () => {
  it("calls editor.addParagraph with the given input and resolves its snapshot", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.addParagraph).mockResolvedValue(snapshot);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useAddParagraph(),
    );
    const input = { id: 1, text: "new" };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.editor.addParagraph).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(snapshot);
    unmount();
  });
});

describe("useRemoveParagraph", () => {
  it("calls editor.removeParagraph with the given input and resolves its snapshot", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.editor.removeParagraph).mockResolvedValue(snapshot);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useRemoveParagraph(),
    );
    const input = { id: 1, index: 0 };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.editor.removeParagraph).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(snapshot);
    unmount();
  });
});

describe("useSaveEditor", () => {
  it("calls editor.save with the given input and resolves its bytes", async () => {
    const client = createMockRpcClient();
    const output = { bytes: new Uint8Array([1, 2]) };
    vi.mocked(client.editor.save).mockResolvedValue(output);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const { result, unmount } = renderHookWithQueryClient(() =>
      useSaveEditor(),
    );
    const input = { id: 1 };
    const resolved = await act(() => result.current.mutateAsync(input));

    expect(client.editor.save).toHaveBeenCalledWith(input);
    expect(resolved).toEqual(output);
    unmount();
  });
});
