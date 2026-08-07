import type { Rule } from 'eslint';

// The AST-selector re-export ban in eslint.config.ts (no-restricted-syntax on ExportAllDeclaration / ExportNamedDeclaration[source]) only catches a re-export written as a single statement. It cannot catch the identical coupling split across two: `import { foo } from './bar'; export { foo };` binds foo locally and hands it back out under its own name, exactly what `export { foo } from './bar'` does directly -- but neither statement matches either selector, since the import isn't an export at all and the bare export has no `source`. The same split applies to `export default`: `import { foo } from './bar'; export default foo;` is the split form of `export { foo as default } from './bar';`. This rule closes both gaps: it tracks every name an ImportDeclaration binds locally, then at Program:exit checks every bare (sourceless) ExportNamedDeclaration specifier, and every ExportDefaultDeclaration whose declaration is a bare identifier, against that set. Program:exit rather than inline on the export, deliberately -- ESLint visits a file in source order, so an inline check on the export node would miss an import written below it, and this codebase (like most) has no fixed convention for which of the two comes first.
//
// No hand-written node types anywhere here: create()'s return type is Rule.RuleListener, so returning an object literal with an `ImportDeclaration`/`ExportNamedDeclaration`/`ExportDefaultDeclaration` key already gives each callback's `node` parameter its real, precise ESTree type -- ExportSpecifier is pulled from that same declaration via Parameters<> rather than imported from @types/estree directly (this package doesn't otherwise depend on it), and context.report's own `node` field accepts any Rule.Node, which every visited node already is.
type ExportNamedDeclarationNode = Parameters<NonNullable<Rule.RuleListener['ExportNamedDeclaration']>>[0];
type ExportSpecifierNode = ExportNamedDeclarationNode['specifiers'][number];
type ExportDefaultDeclarationNode = Parameters<NonNullable<Rule.RuleListener['ExportDefaultDeclaration']>>[0];

const noNonBarrelReexport: Rule.RuleModule = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      // Plain literal braces, not an escaped placeholder -- ESLint's message interpolation only treats a `{{ name }}` pair specially when `name` is a real key in `data`; a lone `{`/`}` (or one wrapped in a bogus `{{ '{' }}` placeholder that resolves to nothing) passes through untouched, so writing it directly is both correct and simpler.
      splitStatementReexport:
        "'{{ name }}' is imported here and handed straight back out via a bare export -- the identical re-export 'export { {{ name }} } from ...' would be, just split across two statements. Re-exports belong only in src/index.ts (the public barrel).",
      splitStatementDefaultReexport:
        "'{{ name }}' is imported here and handed straight back out via `export default` -- the identical re-export 'export { {{ name }} as default } from ...' would be, just split across two statements. Re-exports belong only in src/index.ts (the public barrel).",
    },
  },
  create(context) {
    const importedLocalNames = new Set<string>();
    const bareExportSpecifiers: ExportSpecifierNode[] = [];
    const defaultExportDeclarations: ExportDefaultDeclarationNode[] = [];

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          importedLocalNames.add(specifier.local.name);
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null && node.source !== undefined) {
          return; // the single-statement form -- already caught by the no-restricted-syntax selector in eslint.config.ts.
        }
        for (const specifier of node.specifiers) {
          bareExportSpecifiers.push(specifier);
        }
      },
      ExportDefaultDeclaration(node) {
        defaultExportDeclarations.push(node);
      },
      'Program:exit'() {
        for (const specifier of bareExportSpecifiers) {
          const name = specifier.local.type === 'Identifier' ? specifier.local.name : undefined;
          if (name !== undefined && importedLocalNames.has(name)) {
            context.report({ node: specifier, messageId: 'splitStatementReexport', data: { name } });
          }
        }
        for (const declarationNode of defaultExportDeclarations) {
          const name = declarationNode.declaration.type === 'Identifier' ? declarationNode.declaration.name : undefined;
          if (name !== undefined && importedLocalNames.has(name)) {
            context.report({ node: declarationNode, messageId: 'splitStatementDefaultReexport', data: { name } });
          }
        }
      },
    };
  },
};

export default noNonBarrelReexport;
