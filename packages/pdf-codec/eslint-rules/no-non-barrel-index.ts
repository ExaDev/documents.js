import type { Rule } from 'eslint';

// Forward guard: src/index.ts is the single public convenience barrel for this package, and a second index.* file anywhere in the tree would shadow it under some resolution rules (Node's directory-import fallback, bundler glob entry points, test runners that auto-discover index files). This rule bans any file whose basename matches index.(ts|cts|mts|js|cjs|mjs) except the one allowed barrel at src/index.ts -- an audit confirmed the tree currently has only that one, so this breaks nothing today and exists purely to keep it that way.
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
    const filename = context.filename;
    const slashIndex = filename.lastIndexOf('/');
    const basename = slashIndex >= 0 ? filename.slice(slashIndex + 1) : filename;
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
