/// <reference lib="dom" />
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePdfObjectUrl } from "./usePdfObjectUrl";

afterEach(() => {
  vi.restoreAllMocks();
});

// A tiny harness scoped to one test: unlike a module-level mutable variable (which the react-hooks/immutability lint rule correctly flags as a cross-render hazard), a `result` object created fresh inside this factory function is owned by the single call site that renders into it, the same pattern src/test/renderHook.tsx already establishes for the react-query hooks.
function mountPdfObjectUrl(initialBytes: Uint8Array<ArrayBuffer> | undefined) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const result: { current: string | undefined } = { current: undefined };

  function Harness({ bytes }: { bytes: Uint8Array<ArrayBuffer> | undefined }) {
    result.current = usePdfObjectUrl(bytes);
    return null;
  }

  function rerender(bytes: Uint8Array<ArrayBuffer> | undefined) {
    act(() => {
      root.render(<Harness bytes={bytes} />);
    });
  }

  rerender(initialBytes);

  return {
    result,
    rerender,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("usePdfObjectUrl", () => {
  it("returns undefined when bytes is undefined", () => {
    const { result, unmount } = mountPdfObjectUrl(undefined);
    expect(result.current).toBeUndefined();
    unmount();
  });

  it("creates a blob: object URL from the given bytes as application/pdf", () => {
    const createObjectURLSpy = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:one");
    const { result, unmount } = mountPdfObjectUrl(new Uint8Array([1, 2, 3]));
    expect(result.current).toBe("blob:one");
    const [blob] = createObjectURLSpy.mock.calls[0] ?? [];
    expect((blob as Blob).type).toBe("application/pdf");
    unmount();
  });

  it("revokes the previous object URL and creates a fresh one when bytes changes", () => {
    const revokeObjectURLSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL")
      .mockReturnValueOnce("blob:one")
      .mockReturnValueOnce("blob:two");

    const { result, rerender, unmount } = mountPdfObjectUrl(
      new Uint8Array([1]),
    );
    expect(result.current).toBe("blob:one");

    rerender(new Uint8Array([2]));
    expect(result.current).toBe("blob:two");
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:one");
    unmount();
  });

  it("revokes the object URL and returns undefined once bytes goes back to undefined", () => {
    const revokeObjectURLSpy = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:one");

    const { result, rerender, unmount } = mountPdfObjectUrl(
      new Uint8Array([1]),
    );
    expect(result.current).toBe("blob:one");

    rerender(undefined);
    expect(result.current).toBeUndefined();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:one");
    unmount();
  });
});
