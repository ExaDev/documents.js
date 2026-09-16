import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeSignal } from "./abort";

afterEach(() => {
  process.removeAllListeners("SIGINT");
  vi.useRealTimers();
});

describe("createRuntimeSignal", () => {
  it("returns a signal that is not aborted and an undefined reason with no timeout and no interrupt", () => {
    const { signal, getAbortReason } = createRuntimeSignal({});
    expect(signal.aborted).toBe(false);
    expect(getAbortReason()).toBeUndefined();
  });

  it("aborts the signal and reports 'interrupt' when SIGINT fires", () => {
    const { signal, getAbortReason } = createRuntimeSignal({});
    expect(signal.aborted).toBe(false);
    process.emit("SIGINT");
    expect(signal.aborted).toBe(true);
    expect(getAbortReason()).toBe("interrupt");
  });

  it("aborts the signal and reports 'timeout' once the timeout elapses", () => {
    vi.useFakeTimers();
    const { signal, getAbortReason } = createRuntimeSignal({ timeoutMs: 10 });
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(10);
    expect(signal.aborted).toBe(true);
    expect(getAbortReason()).toBe("timeout");
  });

  it("does not abort before the configured timeout elapses", () => {
    vi.useFakeTimers();
    const { signal } = createRuntimeSignal({ timeoutMs: 1000 });
    vi.advanceTimersByTime(999);
    expect(signal.aborted).toBe(false);
  });

  it("keeps the first abort reason when SIGINT arrives after a timeout already fired", () => {
    vi.useFakeTimers();
    const { getAbortReason } = createRuntimeSignal({ timeoutMs: 5 });
    vi.advanceTimersByTime(5);
    expect(getAbortReason()).toBe("timeout");
    process.emit("SIGINT");
    expect(getAbortReason()).toBe("timeout");
  });

  it("keeps 'interrupt' as the reason when a timeout would fire after SIGINT already did", () => {
    vi.useFakeTimers();
    const { getAbortReason } = createRuntimeSignal({ timeoutMs: 5 });
    process.emit("SIGINT");
    expect(getAbortReason()).toBe("interrupt");
    vi.advanceTimersByTime(5);
    expect(getAbortReason()).toBe("interrupt");
  });

  it("includes the configured timeout value in the timeout error's message", () => {
    vi.useFakeTimers();
    const { signal } = createRuntimeSignal({ timeoutMs: 42 });
    vi.advanceTimersByTime(42);
    expect((signal.reason as Error).message).toBe("Timed out after 42ms");
  });

  it("names SIGINT in the interrupt error's message", () => {
    const { signal } = createRuntimeSignal({});
    process.emit("SIGINT");
    expect((signal.reason as Error).message).toBe("Interrupted by SIGINT");
  });

  it("aborts the combined signal via SIGINT even though a timeout was also configured", () => {
    vi.useFakeTimers();
    const { signal } = createRuntimeSignal({ timeoutMs: 1000 });
    expect(signal.aborted).toBe(false);
    process.emit("SIGINT");
    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).message).toBe("Interrupted by SIGINT");
  });

  it("unrefs the timeout so a pending timeout never keeps the process alive on its own", () => {
    const realSetTimeout = globalThis.setTimeout;
    let capturedTimer: NodeJS.Timeout | undefined;
    let unrefCallCount = 0;
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(((
        handler: () => void,
        timeout?: number,
      ): NodeJS.Timeout => {
        const timer = realSetTimeout(handler, timeout);
        const realUnref = timer.unref.bind(timer);
        timer.unref = () => {
          unrefCallCount += 1;
          return realUnref();
        };
        capturedTimer = timer;
        return timer;
      }) as typeof globalThis.setTimeout);

    createRuntimeSignal({ timeoutMs: 60_000 });

    expect(unrefCallCount).toBe(1);
    setTimeoutSpy.mockRestore();
    clearTimeout(capturedTimer);
  });
});
