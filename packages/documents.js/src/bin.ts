#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolveBinDispatch } from "./bin-dispatch";

// documents.js ships no CLI or MCP server of its own -- those live in the sibling `document-cli` and `document-mcp` packages, which depend on documents.js (the dependency direction is consumer -> library, never the reverse). This bin is a convenience launcher: it dispatches to whichever companion owns the requested surface, resolving it on demand via the user's own package manager's download-and-run command (npx/pnpm dlx/yarn dlx/bunx) so it works whether or not the companion is installed -- local node_modules/.bin wins, the registry is the fallback. documents.js's own `dependencies` stays the eight pure, worker-isomorphic packages it already has; no companion is ever declared as a dep.
//
// The launcher is Node-only (it spawns a child process), so it is deliberately carved out of the worker-isomorphism gate -- excluded from the web-only tsconfig.json and the eslint node:* ban (eslint.config.ts), typechecked under tsconfig.node.json instead. It is an executed entry point, never imported, so the library's importable runtime surface (dist/index.js) stays fully worker-isomorphic.

const { command, runnerArgs } = resolveBinDispatch(
  process.argv.slice(2),
  process.env.npm_config_user_agent,
);

const { status } = spawnSync(command, [...runnerArgs], { stdio: "inherit" });
process.exit(status ?? 1);
