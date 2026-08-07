import type { Rule } from 'eslint';

// The AST-selector re-export ban in eslint.config.ts (no-restricted-syntax on ExportAllDeclaration / ExportNamedDeclaration[source]) only catches a re-export written as a single statement. It cannot catch the identical coupling split across two: `import { foo } from './bar'; export { foo };` binds foo locally and hands it back out under its own name, exactly what `export { foo } from './bar'` does directly -- but neither statement matches either selector, since the import isn't an export at all and the bare export has no `source`. The same split applies to `export default`: `import { foo } from './bar'; export default foo;` is the split form of `export { foo as default } from './bar';`. This rule closes both gaps: it tracks every name an ImportDeclaration binds locally, then at Program:exit checks every bare (sourceless) ExportNamedDeclaration specifier, and every ExportDefaultDeclaration whose declaration is a bare identifier, against that set. Program:exit rather than inline on the export, deliberately -- ESLint visits a file in source order, so an inline check on the export node would miss an import written below it, and this codebase (like most) has no fixed convention for which of the two comes first.
//
// The fixer only ever does two things, both single-file and behaviour-preserving: delete the offending export (specifier or whole statement), and -- only when that export was the import's ONLY use anywhere in the file, proven via the real scope-manager Variable rather than guessed from the AST shape -- delete the now-pointless import alongside it. It never touches another file, so it never redirects a consumer (e.g. src/index.ts) to import from the real source module; that decision is a human's, since the fixer has no way to know from this file alone whether anything imports the removed name from this file's own path. If something does, deleting the export surfaces as an immediate, loud TypeScript "has no exported member" error at that consumer -- never a silent behaviour change -- which is exactly the fail-loud outcome this codebase's own conventions call for, and the fix from there is the same one this rule's git history already applied by hand repeatedly: point the consumer at the real source module directly.
//
// No hand-written node types anywhere here: create()'s return type is Rule.RuleListener, so returning an object literal with an `ImportDeclaration`/`ExportNamedDeclaration`/`ExportDefaultDeclaration`/`Identifier` key already gives each callback's `node` parameter its real, precise ESTree type -- pulled via Parameters<> rather than imported from @types/estree directly (this package doesn't otherwise depend on it), and context.report's own `node` field accepts any Rule.Node, which every visited node already is.
type ExportNamedDeclarationNode = Parameters<NonNullable<Rule.RuleListener['ExportNamedDeclaration']>>[0];
type ExportSpecifierNode = ExportNamedDeclarationNode['specifiers'][number];
type ExportDefaultDeclarationNode = Parameters<NonNullable<Rule.RuleListener['ExportDefaultDeclaration']>>[0];
type ImportDeclarationNode = Parameters<NonNullable<Rule.RuleListener['ImportDeclaration']>>[0];
type ImportSpecifierNode = ImportDeclarationNode['specifiers'][number];

interface TrackedImport {
  declaration: ImportDeclarationNode;
  specifier: ImportSpecifierNode;
}

// The bare ESTree node types extracted above (via Rule.RuleListener) carry no `.parent` field, so they don't satisfy Rule.Node (which requires one) -- but fixer.remove/sourceCode.getRange don't need Rule.Node at all, only whatever their own parameter types actually are. Deriving that directly from the real methods, the same "don't hand-type it" rule this codebase applies everywhere else, sidesteps the mismatch entirely rather than papering over it with a cast.
type SyntaxElement = Parameters<Rule.RuleFixer['remove']>[0];
// Likewise, a Reference's own `identifier` field (what importIsOnlyUsedByThisExport below compares against) is typed as a bare ESTree.Identifier, not the parent-extended one Rule.RuleListener['Identifier'] would give -- derived from the real getDeclaredVariables return shape rather than guessed.
type ReferenceIdentifier = ReturnType<Rule.RuleContext['sourceCode']['getDeclaredVariables']>[number]['references'][number]['identifier'];

// Removes one member from a comma-separated specifier list, collapsing the whole surrounding declaration instead when that member is the only one left -- `import {} from 'x'` and a bare `export {};` are both legal but pointless, so a fully-drained list takes its declaration with it rather than leaving debris behind.
function removeListMember(fixer: Rule.RuleFixer, sourceCode: Rule.RuleContext['sourceCode'], declaration: SyntaxElement, members: readonly SyntaxElement[], target: SyntaxElement): Rule.Fix {
  if (members.length === 1) {
    return fixer.remove(declaration);
  }
  const targetIndex = members.indexOf(target);
  const isLast = targetIndex === members.length - 1;
  const neighbor = members[isLast ? targetIndex - 1 : targetIndex + 1];
  if (neighbor === undefined) {
    throw new Error('Unreachable: a list with more than one member always has a neighbor either side of any member within it.');
  }
  // Not the last specifier: remove from this specifier's own start to the next one's start -- eats the trailing ", ". The last specifier: remove from the previous one's end to this one's end -- eats the leading ", ".
  return isLast
    ? fixer.removeRange([sourceCode.getRange(neighbor)[1], sourceCode.getRange(target)[1]])
    : fixer.removeRange([sourceCode.getRange(target)[0], sourceCode.getRange(neighbor)[0]]);
}

// True only when the imported binding's sole use anywhere in the file is the one bare re-export being fixed -- the narrow, single-file-provable case where deleting the import alongside the export is unquestionably safe. Resolved via the real scope-manager Variable (getDeclaredVariables), not by re-deriving usage from the AST by hand, so this is exactly as accurate as the identical check no-unused-vars already relies on. When the import is also used for real work elsewhere, this returns false and the fixer leaves the import alone, removing only the re-export itself.
function importIsOnlyUsedByThisExport(sourceCode: Rule.RuleContext['sourceCode'], trackedImport: TrackedImport, usageIdentifier: ReferenceIdentifier): boolean {
  const variable = sourceCode.getDeclaredVariables(trackedImport.declaration).find((candidate) => candidate.defs.some((def) => def.node === trackedImport.specifier));
  if (variable === undefined) {
    return false; // Not expected to happen -- every import specifier declares exactly one variable -- but false is the safe default: skip removing the import rather than risk deleting a binding still in use.
  }
  if (variable.references.length !== 1) {
    return false;
  }
  const [onlyReference] = variable.references;
  if (onlyReference === undefined) {
    throw new Error('Unreachable: the length check above guarantees exactly one element.');
  }
  return onlyReference.identifier === usageIdentifier;
}

const noNonBarrelReexport: Rule.RuleModule = {
  meta: {
    type: 'problem',
    fixable: 'code',
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
    const importsByName = new Map<string, TrackedImport>();
    const bareExportSpecifiers: { declaration: ExportNamedDeclarationNode; specifier: ExportSpecifierNode }[] = [];
    const defaultExportDeclarations: ExportDefaultDeclarationNode[] = [];

    return {
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          importsByName.set(specifier.local.name, { declaration: node, specifier });
        }
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null && node.source !== undefined) {
          return; // the single-statement form -- already caught by the no-restricted-syntax selector in eslint.config.ts.
        }
        for (const specifier of node.specifiers) {
          bareExportSpecifiers.push({ declaration: node, specifier });
        }
      },
      ExportDefaultDeclaration(node) {
        defaultExportDeclarations.push(node);
      },
      'Program:exit'() {
        const { sourceCode } = context;

        for (const { declaration, specifier } of bareExportSpecifiers) {
          const name = specifier.local.type === 'Identifier' ? specifier.local.name : undefined;
          if (name === undefined) {
            continue;
          }
          const trackedImport = importsByName.get(name);
          if (trackedImport === undefined) {
            continue;
          }
          context.report({
            node: specifier,
            messageId: 'splitStatementReexport',
            data: { name },
            fix(fixer) {
              const fixes = [removeListMember(fixer, sourceCode, declaration, declaration.specifiers, specifier)];
              if (specifier.local.type === 'Identifier' && importIsOnlyUsedByThisExport(sourceCode, trackedImport, specifier.local)) {
                fixes.push(removeListMember(fixer, sourceCode, trackedImport.declaration, trackedImport.declaration.specifiers, trackedImport.specifier));
              }
              return fixes;
            },
          });
        }

        for (const declarationNode of defaultExportDeclarations) {
          const name = declarationNode.declaration.type === 'Identifier' ? declarationNode.declaration.name : undefined;
          if (name === undefined) {
            continue;
          }
          const trackedImport = importsByName.get(name);
          if (trackedImport === undefined) {
            continue;
          }
          context.report({
            node: declarationNode,
            messageId: 'splitStatementDefaultReexport',
            data: { name },
            fix(fixer) {
              const fixes: Rule.Fix[] = [fixer.remove(declarationNode)];
              if (declarationNode.declaration.type === 'Identifier' && importIsOnlyUsedByThisExport(sourceCode, trackedImport, declarationNode.declaration)) {
                fixes.push(removeListMember(fixer, sourceCode, trackedImport.declaration, trackedImport.declaration.specifiers, trackedImport.specifier));
              }
              return fixes;
            },
          });
        }
      },
    };
  },
};

export default noNonBarrelReexport;
