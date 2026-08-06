import type { Rule } from 'eslint';

// Forward guard: only src/index.ts may be named index.*. Any other module with an index.* basename is banned -- it silently becomes an implicit entry point under Node's directory-resolution rules and a hidden public surface a consumer can reach by importing the directory rather than its descriptive filename. The audit at the time this rule was added found only src/index.ts, so this breaks nothing today; it exists to keep that invariant from drifting.

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
    const lastSlash = filename.lastIndexOf('/');
    const basename = lastSlash >= 0 ? filename.slice(lastSlash + 1) : filename;
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
