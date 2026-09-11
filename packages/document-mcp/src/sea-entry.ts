import { main } from "./cli";

// Node's single-executable application feature runs only a CommonJS entry with no top-level await (see https://nodejs.org/api/single-executable-applications.html) -- this is that entry, built separately from src/bin.ts (see tsdown.config.ts's own sea build target) as a fully bundled .cjs file with zero external requires, since a SEA embeds no node_modules of its own. `main` stays genuinely async; only the top level here is synchronous, which is all the CommonJS module system needs.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
