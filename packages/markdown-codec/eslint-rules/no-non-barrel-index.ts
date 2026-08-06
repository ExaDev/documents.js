import type { Rule } from 'eslint';

// Forward guard: bans any file whose basename is index.[cm]?[tj]s except the single allowed public barrel at src/index.ts. An audit confirmed every file in this package currently has only src/index.ts and no other index.* file, so this rule flags nothing today -- it exists to keep a second barrel from accreting unnoticed, since two files sharing the index.* name would shadow one another under several bundlers and Node's own resolution and silently surface the wrong module under a name a consumer expects to mean something else. String operations only, no node:path import needed.
//
// `context.filename` is the ESLint 9+ API; the legacy `getFilename()` fallback covers an older parser this package no longer ships but keeps the rule portable across the family. Narrowed through a real type guard rather than a type assertion because this codebase bans assertions entirely (see `@typescript-eslint/consistent-type-assertions` in eslint.config.ts) -- the optional-chain call `context.getFilename?.()` itself trips `@typescript-eslint/no-unsafe-call` because ESLint 10's types don't resolve a callable signature for the deprecated method.
interface ContextWithGetFilename { getFilename: () => string }

function hasGetFilename(context: unknown): context is ContextWithGetFilename {
  if (typeof context !== 'object' || context === null) return false;
  if (!('getFilename' in context)) return false;
  return typeof context.getFilename === 'function';
}

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
    let filename = context.filename;
    if (filename === undefined && hasGetFilename(context)) {
      filename = context.getFilename();
    }
    const path = filename ?? '';
    const slashIndex = path.lastIndexOf('/');
    const basename = slashIndex === -1 ? path : path.slice(slashIndex + 1);
    if (!/^index\.[cm]?[tj]s$/.test(basename)) return {};
    // The one allowed barrel. Match on the path suffix so the rule stays robust to the repo being checked out at any root.
    if (path.endsWith('/src/index.ts')) return {};
    return {
      Program(node) {
        context.report({ node, messageId: 'barrel' });
      },
    };
  },
};

export default noNonBarrelIndex;
