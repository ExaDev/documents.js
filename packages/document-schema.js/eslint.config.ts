import { packageLintConfig } from '../../eslint.shared.ts';

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  isomorphic: true,
  // scripts/ holds a standalone build step importing from ../dist, the same reason test/ is ignored.
  additionalIgnores: ['scripts'],
});
