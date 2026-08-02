// A small polling helper for Ink component tests: a test harness's own `useEffect`-driven state setup (dispatching actions after mount, since `AppStateProvider` exposes no way to seed initial state) and Ink's own passive-effect scheduling both settle asynchronously relative to `render()`'s synchronous return, so a test cannot assert against `lastFrame()` immediately after calling `render()` -- it must wait for the harness's effect to run and for the resulting re-render to reach `lastFrame()`. Polling rather than a single fixed delay because the exact number of scheduler ticks needed is an implementation detail of React's effect flushing this test suite has no business depending on.

const POLL_INTERVAL_MS = 10;
const DEFAULT_TIMEOUT_MS = 2000;

export async function waitForFrame(getFrame: () => string | undefined, predicate: (frame: string) => boolean, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
  const start = Date.now();
  for (;;) {
    const frame = getFrame();
    if (frame !== undefined && predicate(frame)) {
      return frame;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for a frame matching the predicate. Last frame:\n${frame ?? '(no frame rendered yet)'}`);
    }
    await new Promise((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
}

// A component that mounts as the result of an effect-driven conditional swap (a harness's own "loading" placeholder replaced by the real screen once its setup effect dispatches) genuinely renders and reaches `lastFrame()` before Ink's OWN `useInput` effect -- the one that calls `setRawMode(true)` and attaches the raw-mode `readable` listener onto the injected stdin stream -- has actually flushed. Empirically confirmed by direct reproduction against this repo's installed ink@7.1.1 + ink-testing-library@4.0.0: `waitForFrame` resolving as soon as the swapped-in component's own text appears is not proof its `useInput` listener is attached yet, so a `stdin.write()` sent immediately afterwards can be silently dropped even though the component visibly mounted. A component mounted directly (no earlier placeholder to swap away from) does not show this race. Call this once after the `waitForFrame` that confirms a screen mounted via such a swap, before the first `stdin.write()` aimed at it -- and again between rapid successive keypresses sent without an intervening `waitForFrame`, since each keypress's own state update is only guaranteed visible to the next one once its render has actually committed.
const EFFECT_SETTLE_MS = 100;

export async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, EFFECT_SETTLE_MS);
  });
}
