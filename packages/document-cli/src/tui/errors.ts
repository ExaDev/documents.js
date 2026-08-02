// Everything this TUI catches comes from fs, documents.js, or odf.js, all of which throw real Error instances; the second branch exists only because `catch` binds `unknown` and there is no honest way to render a thrown non-Error other than saying what it was.
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return `A non-Error value of type ${typeof error} was thrown`;
}
