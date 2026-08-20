import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guards the read-only entry's module graph (#582's regression test): everything statically reachable from src/convert/from-pdf.ts (the documents.js/read entry) must exclude every X-to-PDF renderer and therefore every vendored font asset, so a consumer that only converts FROM pdf never bundles the write path it cannot execute -- on Cloudflare Workers' free plan (3 MB gzipped for an entire Worker) that is most of the budget. Like pdf-codec's own src/read-graph.test.ts, the check is a static walk over source import statements rather than an esbuild/rolldown metafile, because the package carries no bundler dependency and tsdown compiles src/ module-for-module -- the source import graph is the shipped dist import graph.
//
// The walk crosses the workspace boundary into pdf-codec's own src/: 'pdf-codec/read' resolves through that package's real exports map (read from its package.json at test time, so the test follows exactly what a bundler follows) onto src/read.ts, and relative imports inside pdf-codec keep walking from there. This is what makes the check end-to-end honest: a documents.js module that value-imports the pdf-codec ROOT barrel pulls pdf-codec's src/index.ts into the walk, whose own font-registry/math-font imports then fail the test -- the write path cannot sneak back in through any edge. Other bare specifiers (document-schema.js, ooxml.js, odf.js, markdown-codec, byte-codec, zod, fflate) terminate the walk: none of those packages vendors font assets, so the invariant under test has nothing to say about their graphs.
//
// Type-only statements ('import type' / 'export type') are skipped because tsdown erases them -- a type import adds zero runtime graph weight, which is what lets read-side modules keep typing against pdf-codec's root barrel while their runtime graph stays narrow.

const SRC_DIR = fileURLToPath(new URL('./', import.meta.url));
const PDF_CODEC_ROOT = join(SRC_DIR, '..', '..', 'pdf-codec');

// Narrowing guard for the two JSON.parse boundaries below (no assertions, per family discipline).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPackageJsonExports(packageRoot: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (!isRecord(parsed) || !isRecord(parsed.exports)) {
    throw new Error(`read-graph walk: ${join(packageRoot, 'package.json')} has no exports map`);
  }
  return parsed.exports;
}

const PDF_CODEC_EXPORTS = readPackageJsonExports(PDF_CODEC_ROOT);

// Resolves a 'pdf-codec...' specifier to its ts source file by following the package's own exports map (explicit entries first, then the ./* wildcard), then mapping the dist target back onto src/. This mirrors bundler resolution closely enough that renaming or removing an entry fails loudly here rather than silently divorving the walk from reality.
function resolvePdfCodecSpecifier(specifier: string): string {
  const subpath = specifier === 'pdf-codec' ? '.' : `.${specifier.slice('pdf-codec'.length)}`;
  const entry = PDF_CODEC_EXPORTS[subpath];
  const pattern: unknown = entry !== undefined ? entry : PDF_CODEC_EXPORTS['./*'];
  if (!isRecord(pattern) || typeof pattern.import !== 'string') {
    throw new Error(`read-graph walk: pdf-codec's exports map does not resolve '${specifier}' to an ESM target`);
  }
  // The wildcard entry's target literally contains its '*' (e.g. './dist/*.js'): substitute the subpath remainder the way a resolver would before mapping dist onto src.
  const distTarget = pattern.import.includes('*') ? pattern.import.replace('*', subpath.slice(2)) : pattern.import;
  const sourceTarget = join(PDF_CODEC_ROOT, distTarget.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'));
  if (!existsSync(sourceTarget)) {
    throw new Error(`read-graph walk: pdf-codec's '${specifier}' resolves to ${distTarget} but ${sourceTarget} does not exist`);
  }
  return sourceTarget;
}

// Resolves an extensionless relative specifier to its ts source file, failing loudly on anything the walk cannot resolve -- a silently skipped edge would silently skip whatever it reaches.
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

function resolveSpecifier(fromFile: string, specifier: string): string {
  if (specifier.startsWith('.')) {
    return resolveRelativeSpecifier(fromFile, specifier);
  }
  if (specifier === 'pdf-codec' || specifier.startsWith('pdf-codec/')) {
    return resolvePdfCodecSpecifier(specifier);
  }
  return '';
}

// Extracts a module's runtime import edges: comment-stripped source minus type-only statements, then every remaining `from '...'`. Comment stripping comes first because this codebase's module comments quote specifiers in prose and a prose mention must never count as an edge.
function runtimeImports(file: string): readonly string[] {
  const withoutComments = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const withoutTypeStatements = withoutComments
    .replace(/\bimport\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g, '')
    .replace(/\bexport\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"];?/g, '')
    .replace(/^\s*(?:import|export)\s+type\s[^;\n]*\bfrom\s*['"][^'"]+['"];?/gm, '');
  const specifiers: string[] = [];
  for (const match of withoutTypeStatements.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
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
    for (const specifier of runtimeImports(file)) {
      const resolved = resolveSpecifier(file, specifier);
      if (resolved === '' || predecessors.has(resolved)) {
        continue;
      }
      predecessors.set(resolved, file);
      queue.push(resolved);
    }
  }
  return predecessors;
}

function displayPath(file: string): string {
  if (file.startsWith(SRC_DIR)) {
    return `src/${file.slice(SRC_DIR.length)}`;
  }
  if (file.startsWith(PDF_CODEC_ROOT)) {
    return `pdf-codec/src/${file.slice(PDF_CODEC_ROOT.length + 1)}`;
  }
  return file;
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
  return chain.map(displayPath).join(' -> ');
}

// The modules whose reachability from the read entry is the defect #582 describes, all inside pdf-codec (the only package in the graph that vendors font assets): the write entry itself, the two modules that eagerly import the vendored fonts at module scope, and the asset modules those pull in. Everything else on the write side is caught transitively -- it reaches one of these, most often through pdf-codec's root barrel.
function isForbidden(module: string): boolean {
  const relative = module.startsWith(PDF_CODEC_ROOT) ? module.slice(PDF_CODEC_ROOT.length + 1) : undefined;
  if (relative === undefined) {
    return false;
  }
  return relative === 'src/write.ts' || relative === 'src/math-font.ts' || relative === 'src/font-registry.ts' || relative.startsWith('src/assets/');
}

describe('the documents.js/read entry module graph excludes every X-to-PDF renderer and font asset', () => {
  it('src/convert/from-pdf.ts (the documents.js/read entry) exists and reaches no write or font-asset module', () => {
    const root = join(SRC_DIR, 'convert', 'from-pdf.ts');
    expect(existsSync(root), 'the read entry src/convert/from-pdf.ts must exist and stay clean, since the package.json ./read export maps onto it').toBe(true);
    const reachable = reachableModules(root);
    const forbidden = [...reachable.keys()].filter(isForbidden);
    expect(
      forbidden.map((module) => chainTo(root, module, reachable)),
      `the documents.js/read entry's module graph must not reach the pdf-codec write path or the vendored font assets; offending chain(s):\n  ${forbidden.map((module) => chainTo(root, module, reachable)).join('\n  ')}`,
    ).toEqual([]);
  });

  it('the package.json ./read export maps onto the read entry, pinning documents.js/read', () => {
    const parsed: unknown = JSON.parse(readFileSync(join(SRC_DIR, '..', 'package.json'), 'utf8'));
    if (!isRecord(parsed) || !isRecord(parsed.exports) || !isRecord(parsed.exports['./read'])) {
      throw new Error('read-graph guard: package.json exports has no ./read entry -- the read-only entry point must stay declared, not just wildcard-reachable');
    }
    expect(parsed.exports['./read'].import).toBe('./dist/convert/from-pdf.js');
  });
});
