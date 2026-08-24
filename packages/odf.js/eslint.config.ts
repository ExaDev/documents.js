import { packageLintConfig } from '../../eslint.shared.ts';

export default packageLintConfig({
  tsconfigRootDir: import.meta.dirname,
  isomorphic: true,
});
