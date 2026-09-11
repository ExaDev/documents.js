import { main } from "./cli-main-sea";

// Built as ESM, not CommonJS (see tsdown.config.ts's own seaEntryBuildConfig call): even with the TUI excluded (see cli-main-sea.ts's own top comment for why), the ESM SEA mode Node 25.7+ added is still used for consistency with the CJS-vs-ESM choice being a property of what a package's own dependency graph needs, not something to special-case per file within one package.
await main();
