// Shared across both cell-fill writers (docx's shading.ts and xlsx's styles.ts) that switch exhaustively over ContentCellFill's 'solid'/'pattern' kinds and need to name whatever a malformed value's kind actually is once the exhaustive switch has typed it away.

/** Reads `.kind` off a ContentCellFill that has already been switched over both of its real members ('solid'/'pattern') -- TypeScript types such a value 'never' at that point, so this takes it through a deliberately widened parameter type rather than an `as` cast. A value that reaches this call anyway (a malformed object bypassing schema validation, or a stale caller shape) still carries a real, inspectable kind at runtime even though the type system says none is left to name. */
export function unrecognizedFillKind(fill: { kind?: unknown }): string {
  return String(fill.kind);
}
