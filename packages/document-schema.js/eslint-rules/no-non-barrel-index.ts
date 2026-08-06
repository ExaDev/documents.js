import type { Rule } from 'eslint';

// Forward guard: only src/index.ts (the public convenience barrel) may use an `index.*` filename. Any other module named index.ts/index.js/index.cts/... is banned, because an index file is what a directory's bare import resolves to, so a second one anywhere in the tree silently shadows the public barrel or invites a consumer to reach an internal module through a path that looks like the package's front door. String-only -- no node:path import -- because the only two facts needed (the basename and the `/src/index.ts` suffix) are both directly computable from the absolute path ESLint already hands us.
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
    const basename = lastSlash === -1 ? filename : filename.slice(lastSlash + 1);
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
