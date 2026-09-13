import { CommanderError } from "commander";
import { createProgram } from "./program";
import { EXIT_SUCCESS, EXIT_USAGE_ERROR } from "./runtime/exit-codes";

/**
 * The SEA build's own entry logic (`src/sea-entry.ts` awaits this) -- every real command `createProgram()` registers, with no `tui` subcommand and no bare-invocation TUI dispatch at all. This is a genuinely separate module from `src/cli-main.ts`, not a shared function behind a runtime flag, specifically so nothing here ever imports (statically or dynamically) `./tui/index.js` or anything reachable from it: Ink's own dependency chain (yoga-layout, ink's own reconciler and devtools integration) has top-level await baked into its module graph and an unresolved optional peer dependency (`react-devtools-core`) that isn't installed, neither of which a single-file SEA bundle can paper over -- see `src/cli-main.ts`'s own top comment for the full reasoning, and `tsdown.config.ts`'s own comment on the ESM SEA build mode this package needs regardless, for the top-level-await half of it.
 *
 * This is not merely a build workaround adopted to dodge a bundler error: the TUI is inherently interactive (it checks `process.stdout.isTTY` in `cli-main.ts`) and a SEA binary's whole reason to exist is being spawned as a subprocess by another program -- a context with no TTY to offer in the first place, and so no genuine use for the TUI regardless of whether it could theoretically be bundled. Excluding Ink's module graph from this specific entry is the correct scope for what a SEA build is actually for, not a smaller version of the real CLI docked a feature it needs.
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [dispatchToken] = args;

  if (dispatchToken === undefined) {
    createProgram().outputHelp();
    process.exitCode = EXIT_SUCCESS;
    return;
  }

  if (dispatchToken === "tui") {
    process.stderr.write(
      "the TUI is not available in this build; use the npm-installed document-cli for interactive use\n",
    );
    process.exitCode = EXIT_USAGE_ERROR;
    return;
  }

  const program = createProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    // Mirrors src/cli-main.ts's own identical catch -- see that file's own comment.
    if (!(error instanceof CommanderError)) {
      throw error;
    }
  }
}
