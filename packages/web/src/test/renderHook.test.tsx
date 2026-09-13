import { useEffect } from "react";
import { describe, expect, it } from "vitest";

import { renderHookWithQueryClient } from "./renderHook";

describe("renderHookWithQueryClient", () => {
  it("appends its container to document.body and reflects the hook's return value in result.current", () => {
    const { result, unmount } = renderHookWithQueryClient(() => "value");
    expect(result.current).toBe("value");
    unmount();
  });

  it("runs the React root's own unmount, not just a DOM removal, so effect cleanups fire", () => {
    let cleanedUp = false;
    const { unmount } = renderHookWithQueryClient(() => {
      useEffect(() => {
        return () => {
          cleanedUp = true;
        };
      }, []);
      return null;
    });
    expect(cleanedUp).toBe(false);
    unmount();
    expect(cleanedUp).toBe(true);
  });

  it("removes the container from document.body on unmount", () => {
    const bodyChildCountBefore = document.body.childElementCount;
    const { unmount } = renderHookWithQueryClient(() => null);
    expect(document.body.childElementCount).toBe(bodyChildCountBefore + 1);
    unmount();
    expect(document.body.childElementCount).toBe(bodyChildCountBefore);
  });
});
