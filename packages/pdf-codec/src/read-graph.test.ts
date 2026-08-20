import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the read path's module graph (#720's regression test): everything statically reachable from the read entry must exclude the write path and the vendored font assets, so a read-only consumer bundling pdf-codec never pays for font binaries it cannot execute. The check is a static walk over src/'s own import statements rather than an esbuild/rolldown metafile because the package deliberately carries no bundler dependency: tsdown compiles src/ module-for-module (entry glob, root src/), so the source import graph IS the shipped dist import graph. A bundler-based check would add a dev dependency whose only job is to re-derive what the source already states.
//
// The walk follows only relative specifiers ('./x'): bare specifiers (zod, fflate, document-schema.js, byte-codec) are other packages' graphs, with no font assets of their own to guard. Type-only statements ('import type' / 'export type') are skipped because tsdown erases them -- a type import adds zero runtime graph weight, which is exactly the property that lets read-adjacent modules keep typing against the full barrel without re-importing it.

const SRC_DIR = fileURLToPath(new URL('./', import.meta.url));

// Resolves an extensionless relative specifier ('./write', '../bytes/crc32') to its ts source file, failing loudly on anything the walk cannot resolve -- a silently skipped edge would silently skip whatever it reaches.
function resolveRelativeSpecifier(fromFile: string, specifier: string): string {
  const base = join(dirname(fromFile), specifier);
  const asFile = `${base}.ts`;
  if (existsSync(asFile)) {
    return asFile;
  }
  const asIndex = join(base, 'index.ts');
  if (existsSync(asIndex)) {
    return asIndex;
  }
  throw new Error(`read-graph walk: cannot resolve '${specifier}' imported by ${fromFile}`);
}

// Extracts a module's runtime import edges: comment-stripped source minus type-only statements, then every remaining `from '<relative>'`. Comment stripping comes first because this codebase's module comments quote specifiers in prose ('src/write.ts', './read') and a prose mention must never count as an edge.
function relativeRuntimeImports(file: string): readonly string[] {
  const withoutComments = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const withoutTypeStatements = withoutComments
    .replace(/\bimport\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g, '')
    .replace(/\bexport\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g, '')
    .replace(/^\s*(?:import|export)\s+type\s[^;\n]*\bfrom\s*['"][^'"]+['"];?/gm, '');
  const specifiers: string[] = [];
  for (const match of withoutTypeStatements.matchAll(/\bfrom\s+['"](\.[^'"]+)['"]/g)) {
    if (match[1] !== undefined) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

// Walks every module statically reachable from one root, tracking each edge so a violation can be reported as the actual import chain that caused it, not just the offending file.
function reachableModules(root: string): ReadonlyMap<string, string | undefined> {
  const predecessors = new Map<string, string | undefined>([[root, undefined]]);
  const queue: string[] = [root];
  while (queue.length > 0) {
    const file = queue.shift();
    if (file === undefined) {
      break;
    }
    for (const specifier of relativeRuntimeImports(file)) {
      const resolved = resolveRelativeSpecifier(file, specifier);
      if (!predecessors.has(resolved)) {
        predecessors.set(resolved, file);
        queue.push(resolved);
      }
    }
  }
  return predecessors;
}

function chainTo(root: string, module: string, predecessors: ReadonlyMap<string, string | undefined>): string {
  const chain: string[] = [module];
  let cursor = module;
  while (true) {
    const predecessor = predecessors.get(cursor);
    if (predecessor === undefined) {
      break;
    }
    chain.unshift(predecessor);
    cursor = predecessor;
  }
  return chain.map((file) => file.startsWith(SRC_DIR) ? `src/${file.slice(SRC_DIR.length)}` : file).join(' -> ');
}

// The modules whose reachability from a read entry is the defect #720 describes: the write entry itself (write.ts, whose own graph is the whole write path), the two modules that eagerly import the vendored font assets at module scope (math-font.ts: STIX Two Math; font-registry.ts: the Carlito/Caladea faces), and the asset modules those imports pull in. Everything else on the write side is caught transitively -- it reaches one of these.
// Narrowing guard for the package.json JSON.parse boundary (no assertions, per family discipline).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isForbidden(module: string): boolean {
  const relative = module.startsWith(SRC_DIR) ? module.slice(SRC_DIR.length) : undefined;
  if (relative === undefined) {
    return false;
  }
  return relative === 'write.ts' || relative === 'math-font.ts' || relative === 'font-registry.ts' || relative.startsWith('assets/');
}

describe('the read path module graph excludes the write path and font assets', () => {
  it('src/read.ts (the read pipeline implementation) reaches no write or font-asset module', () => {
    const root = join(SRC_DIR, 'read.ts');
    const reachable = reachableModules(root);
    const forbidden = [...reachable.keys()].filter(isForbidden);
    expect(
      forbidden.map((module) => chainTo(root, module, reachable)),
      `the read pipeline's module graph must not reach the write path or the vendored font assets; offending chain(s):\n  ${forbidden.map((module) => chainTo(root, module, reachable)).join('\n  ')}`,
    ).toEqual([]);
  });

  it('the package.json ./read export maps onto the read module, pinning the read-only entry', () => {
    const parsed: unknown = JSON.parse(readFileSync(join(SRC_DIR, '..', 'package.json'), 'utf8'));
    if (!isRecord(parsed) || !isRecord(parsed.exports) || !isRecord(parsed.exports['./read'])) {
      throw new Error('read-graph guard: package.json exports has no ./read entry -- the read-only entry point must stay declared, not just wildcard-reachable');
    }
    expect(parsed.exports['./read'].import).toBe('./dist/read.js');
  });
});
