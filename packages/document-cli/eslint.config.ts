import tseslint from 'typescript-eslint';
import { packageLintConfig } from '../../eslint.shared.ts';

export default tseslint.config(
  ...packageLintConfig({
    tsconfigRootDir: import.meta.dirname,
    // One program covering src and the config files alike, so there is no second tsconfig to route anything to.
    projects: ['./tsconfig.json'],
    // Runs under Node as a published binary, so Worker isomorphism does not apply.
    isomorphic: false,
  }),
  {
    // barrel-policy describes a library: one barrel at src/index.ts, named in the exports map, and re-exports nowhere else. That is right for this package's published surface and stays enforced there. src/tui/ is not that -- it is an Ink application with a screen router, whose deliberate convention is one `<format>/index.tsx` module per document format re-exporting every screen kind for that format, including the format-agnostic screens that physically live under docx/. The router imports one consistent module per format instead of reaching into each screen file, which is the point.
    //
    // No mode fits: 'single' reports 28, 'siblings' 42 (it additionally rejects every cross-format re-export, which is exactly the hub's purpose), 'banned' 34. The conflict is with the rule's subject matter rather than with a fixable authoring choice, so the subtree is exempt rather than the rule weakened for the package -- mirroring how the web UI exempts its TanStack Router routes.
    files: ['src/tui/**'],
    rules: { 'exadev/barrel-policy': 'off' },
  },
);
