import type { Rule } from 'eslint';

// Forward guard over the package's single public convenience barrel: src/index.ts is the only module whose basename matches index.* that this package permits. Any other module named index.ts/index.cts/index.mts/index.js/index.cjs/index.mjs would be silently selected by a consumer's bare './directory' import resolution, surfacing whatever it happens to export under a name a caller expects to mean the real barrel. An audit at the time this rule was added confirmed src/index.ts is the only index.* file under src/, so this breaks nothing today -- it exists to keep that invariant from drifting.
//
// `context.filename` is the ESLint 9+ flat-config API and is always present in this repo (eslint ^10). The legacy `context.getFilename()` fallback applied only to ESLint < 9 eslintrc, which this package does not run, and accessing it type-safely requires a cast (this codebase bans type assertions) or triggers `no-unsafe-call` under the type-checked ruleset -- so it is deliberately omitted rather than carried as dead defensive code.

const INDEX_BASENAME = /^index\.[cm]?[tj]s$/;

const noNonBarrelIndex: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      barrel: "Only src/index.ts may be named index.* (the public convenience barrel); give any other module a descriptive filename.",
    },
  },
  create(context) {
    const filename = context.filename;
    const slash = filename.lastIndexOf('/');
    const basename = slash === -1 ? filename : filename.slice(slash + 1);
    if (!INDEX_BASENAME.test(basename)) return {};
    if (filename.endsWith('/src/index.ts')) return {};
    return {
      Program(node) {
        context.report({ node, messageId: 'barrel' });
      },
    };
  },
};

export default noNonBarrelIndex;
