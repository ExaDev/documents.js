import type { Rule, Scope } from 'eslint';

// Detects and auto-fixes redundant alias declarations -- `const foo = bar` where both sides are plain identifiers and the alias adds no transformation. The fixer replaces all reads of the alias with the original name and removes the declaration. Variables prefixed with `_` are exempt (discard convention). Aliases that are written to after declaration are not auto-fixed (scope mutation), nor is an alias read as a shorthand object property (`{ x }` from `const x = y` would need its key rewritten to `{ x: y }`, which a plain text-replacement fixer cannot do safely).
//
// A scope reference's own `identifier` field is typed `ESTree.Identifier | JSXIdentifier` (eslint's own Scope.Reference), but `JSXIdentifier` isn't itself an exported type from `eslint` -- there is nothing to import or name directly. `IdentifierReference` narrows to the `Identifier` branch structurally via `Extract`, and `isIdentifierReference` is the real (non-`as`) type-guard predicate that performs the narrowing at the one place a reference's identifier is actually read (this codebase bans type assertions entirely -- see `@typescript-eslint/consistent-type-assertions` in eslint.config.ts).
type IdentifierReference = Scope.Reference & { identifier: Extract<Scope.Reference['identifier'], { type: 'Identifier' }> };

function isIdentifierReference(reference: Scope.Reference): reference is IdentifierReference {
  return reference.identifier.type === 'Identifier';
}

const noPointlessReassignment: Rule.RuleModule = {
  meta: {
    type: 'problem',
    fixable: 'code',
    schema: [],
    messages: {
      pointlessReassignment: "Pointless reassignment: '{{ name }}' is just an alias for '{{ value }}'. Use the original directly.",
    },
  },
  create(context) {
    return {
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || node.init?.type !== 'Identifier' || node.id.name.startsWith('_')) return;
        // Only flag const -- let/var aliases are often intentional mutable copies.
        if (node.parent.type !== 'VariableDeclaration' || node.parent.kind !== 'const') return;

        const aliasName = node.id.name;
        const originalName = node.init.name;

        context.report({
          node,
          messageId: 'pointlessReassignment',
          data: { name: aliasName, value: originalName },
          fix(fixer) {
            const scope = context.sourceCode.getScope(node);
            const variable = scope.set.get(aliasName);
            if (!variable) return null;

            // Abort if the alias is mutated after the initial write.
            const mutationRefs = variable.references.filter((reference) => reference.isWrite() && reference.identifier !== node.id);
            if (mutationRefs.length > 0) return null;

            const readRefs = variable.references.filter((reference): reference is IdentifierReference => reference.isRead() && isIdentifierReference(reference));

            // Abort when any read is a shorthand property ({ x } from const x = y) -- rewriting { x } -> { x: original } needs a key change replaceText can't do safely.
            const hasShorthand = readRefs.some((reference) => {
              const afterToken = context.sourceCode.getTokenAfter(reference.identifier);
              if (afterToken?.value === ':') return false;
              if (afterToken?.value !== '}' && afterToken?.value !== ',') return false;
              let token = context.sourceCode.getTokenBefore(reference.identifier);
              while (token) {
                if (token.value === '{') return true;
                if (token.value === '[' || token.value === '(') return false;
                if (token.value === ':') return false;
                token = context.sourceCode.getTokenBefore(token);
              }
              return false;
            });
            if (hasShorthand) return null;

            const fixes = readRefs.map((reference) => fixer.replaceText(reference.identifier, originalName));

            // Remove the VariableDeclaration only when this is the sole declarator.
            const declaration = node.parent;
            if (declaration.type !== 'VariableDeclaration' || declaration.declarations.length !== 1) return null;
            fixes.push(fixer.remove(declaration));
            return fixes;
          },
        });
      },
    };
  },
};

export default noPointlessReassignment;
