#!/usr/bin/env node
import { CommanderError } from 'commander';
import { formatError } from './commands/shared';
import { createProgram } from './program';
import { createRuntimeSignal } from './runtime/abort';
import { EXIT_INPUT_ERROR, EXIT_SUCCESS, EXIT_USAGE_ERROR } from './runtime/exit-codes';

// Shared by the bare-invocation dispatch path and the registered 'tui [file]' subcommand below -- the only thing that differs between them is how each computes startPath, so the actual lazy-import-and-run logic lives here once. Importing './tui/index.js' dynamically (not at module top level) is what keeps a plain `document-cli docx-to-pdf a b` invocation from ever paying React/Ink's module-load cost or touching the terminal.
async function launchTui(startPath: string | undefined, signal: AbortSignal): Promise<void> {
  try {
    const { runTui } = await import('./tui/index.js');
    await runTui({ startPath, signal });
    process.exitCode = EXIT_SUCCESS;
  } catch (error) {
    // Per runTui's own contract, this only fires for a genuine framework-level failure (an uncaught render exception, Ink settling via exit(error)) -- every recoverable in-app condition already renders as an in-app error toast and resolves normally.
    process.stderr.write(`${formatError(error, false)}\n`);
    process.exitCode = EXIT_INPUT_ERROR;
  }
}

// Only the leading non-flag token counts as a start path, matching how every other command in this CLI separates flags from positional arguments -- 'tui --foo bar' should treat 'bar' as the start path, not '--foo'.
function findStartPath(args: readonly string[]): string | undefined {
  return args.find((arg) => !arg.startsWith('-'));
}

async function main(): Promise<void> {
  // Exactly one call per process, per createRuntimeSignal's own contract (see runtime/abort.ts's doc comment) -- it registers the process's single SIGINT listener, so it is built unconditionally here, ahead of the dispatch branch below, regardless of which path (bare/tui vs a commander subcommand) ends up running.
  const { signal } = createRuntimeSignal({});

  const args = process.argv.slice(2);
  const [dispatchToken] = args;

  if (dispatchToken === undefined || dispatchToken === 'tui') {
    if (process.stdout.isTTY !== true) {
      if (dispatchToken === 'tui') {
        process.stderr.write('the TUI requires an interactive terminal (TTY); stdout is currently redirected\n');
        process.exitCode = EXIT_USAGE_ERROR;
        return;
      }
      // A bare invocation with non-interactive stdout is far more likely a forgotten argument (CI/script context) than a deliberate TUI request, so help text is the friendlier default -- unlike the explicit 'tui' token above, which is an unambiguous request this can't silently reinterpret.
      createProgram().outputHelp();
      process.exitCode = EXIT_SUCCESS;
      return;
    }

    const remainingArgs = dispatchToken === 'tui' ? args.slice(1) : args;
    await launchTui(findStartPath(remainingArgs), signal);
    return;
  }

  const program = createProgram();
  program
    .command('tui [file]')
    .description('launch the interactive terminal UI, optionally opening a file immediately')
    .action(async (file: string | undefined) => {
      await launchTui(file, signal);
    });

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    // createProgram()'s own exitOverride already set process.exitCode correctly (0 for --help/--version, EXIT_USAGE_ERROR otherwise) before rethrowing this CommanderError -- this catch exists only to stop that expected, by-design throw from surfacing as an unhandled rejection, not to recompute anything. Anything that isn't a CommanderError is a genuine, unexpected bug (every registered action already catches and maps its own errors -- see src/commands/*.ts) and is rethrown rather than silently swallowed.
    if (!(error instanceof CommanderError)) {
      throw error;
    }
  }
}

await main();
