import { packageLintConfig } from '../../eslint.shared.ts';

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // Off: with noUncheckedIndexedAccess on, every indexed read is typed as possibly-undefined, so this rule fires on array and byte-buffer indexing whose bound the surrounding code has already established -- a loop condition, a prior length check, or a fixture the test itself just built. None of the sites here is a value that can actually be absent. Tracked for a per-package decision on whether any of them is genuine; see the burn-down epic.
  nonNullAssertion: 'off',
  isomorphic: true,
  // src/bin.ts is the launcher entry point: it spawns npx/pnpm/yarn/bunx, so it is Node-only by definition. It is executed, never imported into the isomorphic runtime, so exempting it leaves the importable surface pure -- and tsconfig.node.json already routes it to the Node program, so lint and typecheck agree.
  isomorphicExemptions: ['src/bin.ts'],
});
