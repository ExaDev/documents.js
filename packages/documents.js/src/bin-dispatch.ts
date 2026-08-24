// Pure dispatch logic for the documents.js launcher bin (src/bin.ts), split out so it is testable in isolation and free of any Node-only API -- the bin itself reads process.argv / process.env and spawns the child process, this module only decides which companion package and arguments to hand the runner. `userAgent` is injected rather than read from `process.env` here because `process` is not in the WebWorker lib this package's runtime src is typechecked against; the bin (typechecked under tsconfig.node.json) owns the one read.

export interface BinDispatch {
  /** The npm package the launcher resolves and invokes. */
  readonly pkg: "document-cli" | "document-mcp";
  /** The executable to spawn -- each JS package manager's own download-and-run command. */
  readonly command: "npx" | "pnpm" | "yarn" | "bunx";
  /** Arguments after the command itself -- begins with the manager's fetch flags, then the package name, then the passthrough args. */
  readonly runnerArgs: readonly string[];
}

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

interface RunnerSpec {
  readonly command: BinDispatch["command"];
  /** Args between the command and the package name (`-y` for npx, `dlx` for pnpm/yarn, none for bunx). */
  readonly prefixArgs: readonly string[];
}

// npm_config_user_agent is `<name>/<version> ...`, set by every npm-based JS package manager when it spawns a process. Each manager has its own download-and-run command, so the launcher uses whichever one the user already has rather than assuming npm/npx is installed.
const RUNNERS: Readonly<Record<PackageManager, RunnerSpec>> = {
  npm: { command: "npx", prefixArgs: ["-y"] },
  pnpm: { command: "pnpm", prefixArgs: ["dlx"] },
  yarn: { command: "yarn", prefixArgs: ["dlx"] },
  bun: { command: "bunx", prefixArgs: [] },
};

function detectPackageManager(userAgent: string | undefined): PackageManager {
  const ua = userAgent ?? "";
  if (ua.startsWith("yarn/")) {
    // Yarn classic (1.x) has no `dlx` subcommand -- it is Yarn Berry (2+) only -- so classic is treated as npm and runs through npx rather than a command that fails.
    return ua.startsWith("yarn/1.") ? "npm" : "yarn";
  }
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("bun/")) return "bun";
  // npm, and any agent that doesn't identify itself (Deno doesn't set this env var at all; running the bin via bare `node` sets nothing), falls back to npx.
  return "npm";
}

/**
 * Resolves a launcher invocation into the companion package to run and the runner argument list to spawn it with. A bare invocation or any args that are not the `mcp` dispatch token run the interactive CLI; `mcp` launches the server. `cli` is the explicit escape hatch for the one collision a dispatcher that reserves a subcommand name necessarily has: a leading bare `mcp` is intercepted as "launch the server", so targeting a CLI command on a file literally named `mcp` needs `documents.js cli mcp`. document-cli's own commands never start with `mcp`, so the collision is narrow in practice -- the same "dispatcher reserves a subcommand name" model `git` uses.
 */
export function resolveBinDispatch(
  argv: readonly string[],
  userAgent: string | undefined,
): BinDispatch {
  const head = argv[0];
  const pkg: "document-cli" | "document-mcp" =
    head === "mcp" ? "document-mcp" : "document-cli";
  // `cli`/`mcp` as a leading token are the dispatcher's own; drop them. Anything else is a real CLI argument and passes through verbatim (including a bare invocation).
  const passThrough = head === "mcp" || head === "cli" ? argv.slice(1) : argv;

  const { command, prefixArgs } = RUNNERS[detectPackageManager(userAgent)];
  // npx -y skips the "ok to install?" prompt for an uninstalled companion; pnpm/yarn `dlx` and `bunx` never prompt. All four resolve a local node_modules/.bin entry first and the registry second, so an installed companion runs with no network fetch.
  return { pkg, command, runnerArgs: [...prefixArgs, pkg, ...passThrough] };
}
