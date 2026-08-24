import { packageLintConfig } from '../../eslint.shared.ts';

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  // One program covering src and the config files alike, so there is no second tsconfig to route anything to.
  projects: ['./tsconfig.json'],
  // Runs under Node as a published binary, so Worker isomorphism does not apply.
  isomorphic: false,
});
