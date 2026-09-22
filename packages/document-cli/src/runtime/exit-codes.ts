import {
  CsvSheetNotFoundError,
  CsvSheetNotSpecifiedError,
  OdbNoEmbeddedDataSourceError,
  OdbReportNotSpecifiedError,
  OdbTableNotFoundError,
  OdbTableNotSpecifiedError,
  OdbUnsupportedFormatError,
  OdmUnresolvedSectionError,
  SvgMultiPageNotSpecifiedError,
  SvgPageNotFoundError,
  UnsupportedFontSourceFormatError,
} from "documents.js";

// Mirrors sysexits.h-style convention loosely: 0 is success, 1 is a generic failure, 2 is a usage error (matching coreutils' own convention for bad invocation), and the two signal-derived codes (124, 130) match `timeout(1)` and 128+SIGINT respectively, so a caller scripting against this CLI sees the same exit codes it would from any other well-behaved Unix tool.
export const EXIT_SUCCESS = 0;
export const EXIT_INPUT_ERROR = 1;
export const EXIT_USAGE_ERROR = 2;
export const EXIT_NEEDS_INFO = 3;
export const EXIT_TIMEOUT = 124;
export const EXIT_INTERRUPTED = 130;

// Checked ahead of every instanceof branch below because an aborted run's thrown error is often just a generic "The operation was aborted" DOMException/Error from whichever async primitive was mid-flight when the signal fired — the abort reason recorded by createRuntimeSignal is the only reliable signal of *why* the run stopped, not the shape of whatever error the aborted call happened to throw.
export function mapErrorToExit(
  error: unknown,
  abortReason: "interrupt" | "timeout" | undefined,
): number {
  if (abortReason === "interrupt") {
    return EXIT_INTERRUPTED;
  }
  if (abortReason === "timeout") {
    return EXIT_TIMEOUT;
  }
  // These ten all mean "documents.js already told the caller exactly what extra input it needs" (which .odm chapter hrefs are unresolved, which .odb table or report to pick, which format isn't embedded, which sheet a csv target should write or which page an svg target should draw) — distinct from an ordinary unusable-input failure because the fix is supplying more information, not a different file.
  if (
    error instanceof OdmUnresolvedSectionError ||
    error instanceof OdbTableNotSpecifiedError ||
    error instanceof OdbTableNotFoundError ||
    error instanceof OdbNoEmbeddedDataSourceError ||
    error instanceof OdbUnsupportedFormatError ||
    error instanceof OdbReportNotSpecifiedError ||
    error instanceof CsvSheetNotSpecifiedError ||
    error instanceof CsvSheetNotFoundError ||
    error instanceof SvgMultiPageNotSpecifiedError ||
    error instanceof SvgPageNotFoundError
  ) {
    return EXIT_NEEDS_INFO;
  }
  // fonts' own extractSourceFontsForFormat: the given DocumentFormat is a real, recognised format, but not one with a source-embedded-font concept at all (xlsx, pdf, markdown, odf) — a bad invocation choice, not an unusable file, so this maps like every other usage error rather than EXIT_INPUT_ERROR's "the file itself is the problem".
  if (error instanceof UnsupportedFontSourceFormatError) {
    return EXIT_USAGE_ERROR;
  }
  // Every other case is EXIT_INPUT_ERROR's ordinary catch-all: odb-query's bounded SQL engine's own three error classes (a real SQL construct it deliberately doesn't implement, input that isn't well-formed SQL under its grammar, or a statement that parsed but can't be executed against the data — none names a specific piece of missing input the way the EXIT_NEEDS_INFO group above does), and PdfEncryptedError/PdfParseError (PdfEncryptedError extends PdfParseError). None of these five classes gets its own instanceof branch: this default already covers every one of them, and a dedicated branch for a class this fallback already reaches is a mutation-proof no-op (every mutation of its condition returns the identical exit code), not real documentation of intent.
  return EXIT_INPUT_ERROR;
}
