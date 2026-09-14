import { describe, expect, it } from "vitest";
import { throwIfAborted } from "./abort";

describe("throwIfAborted", () => {
  it("does nothing when signal is undefined", () => {
    expect(() => {
      throwIfAborted(undefined);
    }).not.toThrow();
  });

  it("does nothing when the signal has not been aborted", () => {
    const controller = new AbortController();
    expect(() => {
      throwIfAborted(controller.signal);
    }).not.toThrow();
  });

  it("throws an AbortError DOMException once the signal is aborted", () => {
    const controller = new AbortController();
    controller.abort();
    try {
      throwIfAborted(controller.signal);
      expect.unreachable("throwIfAborted did not throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe("AbortError");
      expect((error as DOMException).message).toBe("Aborted");
    }
  });
});
