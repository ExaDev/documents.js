import { packageLintConfig } from '../../eslint.shared.ts';

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  isomorphic: true,
  // src/bin.ts is the launcher entry point: it spawns npx/pnpm/yarn/bunx, so it is Node-only by definition. It is executed, never imported into the isomorphic runtime, so exempting it leaves the importable surface pure -- and tsconfig.node.json already routes it to the Node program, so lint and typecheck agree.
  isomorphicExemptions: ['src/bin.ts'],
});
