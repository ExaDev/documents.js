// Hand-written rather than AbortSignal.any -- that API needs Node 20.3+, and this package's own engines.node is only ">=20", so relying on it would silently break on the oldest Node this package still declares support for. Never guards against an already-aborted input with an `if (signal.aborted)` pre-check: this function's only call site (createRuntimeSignal below) passes the signals of two AbortControllers it constructed itself, with no await between either construction and this call, so neither can have aborted yet -- a pre-check here would be dead defensive code for a case this module never produces, not a general-purpose combinator with callers this codebase does not control.
// `{ once: true }` is deliberately not passed to either addEventListener call below: an AbortSignal's own "abort" event is defined to fire at most once per signal (its whole lifecycle is unaborted -> aborted, with no way back), so the listener already runs at most once regardless -- `once: true` here would be a redundant, behaviourally unobservable option, not a real safeguard.
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const forward = (signal: AbortSignal): void => {
    controller.abort(signal.reason);
  };
  a.addEventListener("abort", () => {
    forward(a);
  });
  b.addEventListener("abort", () => {
    forward(b);
  });
  return controller.signal;
}

// Called exactly once per CLI invocation (from src/cli.ts), so exactly one SIGINT listener is ever registered per process -- a second call in the same process would register a second listener and is not a supported usage of this function.
export function createRuntimeSignal(options: { readonly timeoutMs?: number }): {
  readonly signal: AbortSignal;
  // Property syntax, not method-shorthand -- a method-shorthand signature here makes @typescript-eslint/unbound-method flag every downstream `const { getAbortReason } = createRuntimeSignal(...)` destructure, even though this is a plain closure that never reads `this`.
  readonly getAbortReason: () => "interrupt" | "timeout" | undefined;
} {
  let abortReason: "interrupt" | "timeout" | undefined;
  const interruptController = new AbortController();

  process.on("SIGINT", () => {
    // First reason wins: if a timeout already fired and this SIGINT arrives afterwards (or vice versa below), the exit code should reflect whichever actually stopped the run first, not whichever listener happens to run last.
    abortReason ??= "interrupt";
    interruptController.abort(new Error("Interrupted by SIGINT"));
  });

  const getAbortReason = (): "interrupt" | "timeout" | undefined => abortReason;

  if (options.timeoutMs === undefined) {
    return { signal: interruptController.signal, getAbortReason };
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    abortReason ??= "timeout";
    timeoutController.abort(
      new Error(`Timed out after ${options.timeoutMs}ms`),
    );
  }, options.timeoutMs);
  // Unref so a pending timeout never keeps the process alive on its own once the conversion this signal guards has already finished.
  timer.unref();

  return {
    signal: combineSignals(
      interruptController.signal,
      timeoutController.signal,
    ),
    getAbortReason,
  };
}
