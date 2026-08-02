// The package's "." library export: a pure re-export barrel over the command-layer/format/exit-code logic that also backs the bin script, so an external consumer (or a test) can call this CLI's conversion logic directly without spawning the bin as a subprocess or touching commander/argv at all. Deliberately excludes the TUI (src/tui/index.tsx) -- it is lazy-loaded only from src/cli.ts's own dispatch, and re-exporting it here would pull React/Ink into every consumer of this eagerly-loaded barrel.
export { formatToExtension, inferFormatFromExtension, isDocumentFormat } from './format';

export { buildConversionAction, formatError } from './commands/shared';
export type { ConversionCommandOptions } from './commands/shared';

export { createProgram } from './program';

export {
  EXIT_INPUT_ERROR,
  EXIT_INTERRUPTED,
  EXIT_NEEDS_INFO,
  EXIT_SUCCESS,
  EXIT_TIMEOUT,
  EXIT_USAGE_ERROR,
  mapErrorToExit,
} from './runtime/exit-codes';
