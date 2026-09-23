// A small polling helper for Ink component tests: a test harness's own `useEffect`-driven state setup (dispatching actions after mount, since `AppStateProvider` exposes no way to seed initial state) and Ink's own passive-effect scheduling both settle asynchronously relative to `render()`'s synchronous return, so a test cannot assert against `lastFrame()` immediately after calling `render()` — it must wait for the harness's effect to run and for the resulting re-render to reach `lastFrame()`. Polling rather than a single fixed delay because the exact number of scheduler ticks needed is an implementation detail of React's effect flushing this test suite has no business depending on.

const POLL_INTERVAL_MS = 10;
const DEFAULT_TIMEOUT_MS = 2000;

export async function waitForFrame(
  getFrame: () => string | undefined,
  predicate: (frame: string) => boolean,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const start = Date.now();
  for (;;) {
    const frame = getFrame();
    if (frame !== undefined && predicate(frame)) {
      return frame;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for a frame matching the predicate. Last frame:\n${frame ?? "(no frame rendered yet)"}`,
      );
    }
    await new Promise((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });
  }
}

// A component that mounts as the result of an effect-driven conditional swap (a harness's own "loading" placeholder replaced by the real screen once its setup effect dispatches) genuinely renders and reaches `lastFrame()` before Ink's OWN `useInput` effect — the one that calls `setRawMode(true)` and attaches the raw-mode `readable` listener onto the injected stdin stream — has actually flushed. Empirically confirmed by direct reproduction against this repo's installed ink@7.1.1 + ink-testing-library@4.0.0: `waitForFrame` resolving as soon as the swapped-in component's own text appears is not proof its `useInput` listener is attached yet, so a `stdin.write()` sent immediately afterwards can be silently dropped even though the component visibly mounted. A component mounted directly (no earlier placeholder to swap away from) does not show this race. Call this once after the `waitForFrame` that confirms a screen mounted via such a swap, before the first `stdin.write()` aimed at it — and again between rapid successive keypresses sent without an intervening `waitForFrame`, since each keypress's own state update is only guaranteed visible to the next one once its render has actually committed.
// 300ms rather than a bare "should be enough": empirically, 100ms reliably let the effect/listener flush on an otherwise-idle machine but was repeatedly observed to lose the race (4/4 reproductions) once the host was running this monorepo's full multi-package test suite under heavy concurrent load, while the identical test passed reliably (3/3) run in isolation — proving the flake was starvation-induced, not a genuine race in the component under test. A real-timer wait cannot be made unconditionally safe against arbitrary host contention, but a materially wider margin costs nothing on the fast path (this only ever runs once per settle() call) and meaningfully reduces exposure to the slow one.
const EFFECT_SETTLE_MS = 300;

export async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, EFFECT_SETTLE_MS);
  });
}

// Ink genuinely soft-wraps a single `<Text>` line's own content once it exceeds the injected stdout's column width (100 in ink-testing-library's own `Stdout` stub), inserting a real "\n" into the captured frame mid-string — not a display artefact of however this frame later gets printed. A probe line built from a long value (an absolute path under a system temp directory routinely runs past 80 characters on its own) can wrap this way, splitting a literal substring an assertion expects to find intact (e.g. "status:info:Saved " and the path landing on separate lines). Word-wrap also drops the single space at its own break point (the word boundary the wrap chose), so simply deleting every "\n" would glue the two halves back together with no space at all where the source text had exactly one; replacing each "\n" with a space instead reconstructs that boundary correctly, and collapsing any run of spaces this produces (a wrap that happened to land on an already-blank column, or two adjacent `<Text>` rows joining with none of their own) keeps a genuine multi-word match like "Could not open <path>" intact regardless of where Ink chose to wrap it.
export function flattenFrame(frame: string | undefined): string {
  return (frame ?? "").replace(/\n/g, " ").replace(/ {2,}/g, " ");
}
