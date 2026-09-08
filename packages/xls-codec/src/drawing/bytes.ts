/** Concatenates several byte chunks into one contiguous array -- shared by every reader that joins BIFF8's own MsoDrawing/MsoDrawingGroup record chunks into one Escher stream (content.ts's own workbook-wide MsoDrawingGroup concatenation, workbook/drawing.ts's per-sheet MsoDrawing concatenation). */
export function concatBytes(
  chunks: readonly Uint8Array<ArrayBuffer>[],
): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
