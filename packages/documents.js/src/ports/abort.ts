// There is no `await` point inside the local writer/reader/layout pipeline for cancellation to hook into implicitly (it is synchronous end to end -- see the implementation plan's Step 11), so every page/slide loop boundary in write.ts, read.ts, layout/engine.ts, and layout/slides.ts calls this explicitly instead.
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException("Aborted", "AbortError");
  }
}
