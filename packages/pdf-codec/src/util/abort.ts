// There is no `await` point inside this package's own reader/writer pipeline for cancellation to hook into implicitly (it is synchronous end to end), so every page loop boundary in write.ts and read.ts calls this explicitly instead. A tiny, independently-duplicated copy of documents.js's own src/ports/abort.ts -- that file stays in documents.js (other, non-PDF consumers still depend on it there), and this package is too small a surface to warrant a shared "ports" package of its own for one four-line function.

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException('Aborted', 'AbortError');
  }
}
