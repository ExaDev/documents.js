import type { Rule } from 'eslint';

// Forward guard: only src/index.ts (the public convenience barrel) may carry an `index.*` basename. A second `index.*` file anywhere in the tree -- a per-directory barrel, a re-export shim, a tool-generated entry point -- silently invites a consumer (or a future contributor) to import from the wrong one under a name that reads as authoritative. This complements no-side-effects-in-index.ts (which constrains what src/index.ts may contain) and the re-export ban in eslint.config.ts (which confines re-exports to src/index.ts): together they pin the barrel to exactly one file, one shape, one purpose. Gated on the basename alone via string operations, so it costs nothing on the overwhelming majority of files.
const noNonBarrelIndex: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      barrel:
        "Only src/index.ts may be named index.* (the public convenience barrel); give any other module a descriptive filename.",
    },
  },
  create(context) {
    // context.filename is the ESLint 9+ API and is typed `string` (always present); the pre-9 getFilename() fallback is deliberately omitted because ESLint 10 removed that method entirely, so calling it would trip @typescript-eslint/no-unsafe-call under this repo's type-checked tier.
    const filename = context.filename;
    const slashIndex = filename.lastIndexOf('/');
    const basename = slashIndex === -1 ? filename : filename.slice(slashIndex + 1);
    if (!/^index\.[cm]?[tj]s$/.test(basename)) return {};
    if (filename.endsWith('/src/index.ts')) return {};
    return {
      Program(node) {
        context.report({ node, messageId: 'barrel' });
      },
    };
  },
};

export default noNonBarrelIndex;
