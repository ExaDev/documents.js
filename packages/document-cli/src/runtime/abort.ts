// Hand-written rather than AbortSignal.any -- that API needs Node 20.3+, and this package's own engines.node is only ">=20", so relying on it would silently break on the oldest Node this package still declares support for.
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const forward = (signal: AbortSignal): void => {
    controller.abort(signal.reason);
  };
  if (a.aborted) {
    forward(a);
  } else {
    a.addEventListener('abort', () => { forward(a); }, { once: true });
  }
  if (b.aborted) {
    forward(b);
  } else {
    b.addEventListener('abort', () => { forward(b); }, { once: true });
  }
  return controller.signal;
}

// Called exactly once per CLI invocation (from src/cli.ts), so exactly one SIGINT listener is ever registered per process -- a second call in the same process would register a second listener and is not a supported usage of this function.
export function createRuntimeSignal(options: { readonly timeoutMs?: number }): {
  readonly signal: AbortSignal;
  // Property syntax, not method-shorthand -- a method-shorthand signature here makes @typescript-eslint/unbound-method flag every downstream `const { getAbortReason } = createRuntimeSignal(...)` destructure, even though this is a plain closure that never reads `this`.
  readonly getAbortReason: () => 'interrupt' | 'timeout' | undefined;
} {
  let abortReason: 'interrupt' | 'timeout' | undefined;
  const interruptController = new AbortController();

  process.on('SIGINT', () => {
    // First reason wins: if a timeout already fired and this SIGINT arrives afterwards (or vice versa below), the exit code should reflect whichever actually stopped the run first, not whichever listener happens to run last.
    abortReason ??= 'interrupt';
    interruptController.abort(new Error('Interrupted by SIGINT'));
  });

  const getAbortReason = (): 'interrupt' | 'timeout' | undefined => abortReason;

  if (options.timeoutMs === undefined) {
    return { signal: interruptController.signal, getAbortReason };
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    abortReason ??= 'timeout';
    timeoutController.abort(new Error(`Timed out after ${options.timeoutMs}ms`));
  }, options.timeoutMs);
  // Unref so a pending timeout never keeps the process alive on its own once the conversion this signal guards has already finished.
  timer.unref();

  return { signal: combineSignals(interruptController.signal, timeoutController.signal), getAbortReason };
}
