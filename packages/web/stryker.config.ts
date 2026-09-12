import { packageStrykerConfig } from "../../stryker.shared.ts";

export default packageStrykerConfig({
  mutate: [
    "src/**/*.ts",
    "src/**/*.tsx",
    "!src/**/*.test.ts",
    "!src/**/*.test.tsx",
  ],
  vitestConfigFile: "vitest.mutation.config.ts",
  // tsconfig.json (the main app program) deliberately excludes src/rpc/router.ts and every src/workers/**/*.ts file -- they belong to tsconfig.worker.json's own separate program instead (a real DOM-vs-WebWorker lib split, not an oversight). Stryker's typescript-checker plugin requires every mutated file to be part of the ONE program its tsconfigFile resolves, so pointing it at tsconfig.json crashes outright ("no watcher is registered for it") the moment it reaches a mutant inside router.ts or the worker entry point. Neither app-only nor worker-only tsconfig alone covers every file this package's mutate glob touches, and DOM+WebWorker together in one lib array cannot simply replace tsconfig.json's own lib (skipLibCheck happens to make the pair compile together here, but that's this checker config's own accommodation, not a reason to widen the real build's lib list). tsconfig.stryker.json is a checker-only program: same include as tsconfig.json but without the router.ts/workers exclusions, and DOM+WebWorker unioned so both halves of the app typecheck under the one program the checker actually needs.
  tsconfigFile: "tsconfig.stryker.json",
});
