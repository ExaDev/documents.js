// Decides which packages a pull request's changes can change a mutation result for, so a change that cannot alter any mutant's outcome starts no mutation job at all. turbo's own `--affected` answers a different question (which packages have any changed file, plus their dependents), so a README edit inside a package, or a manifest bump that leaves the package's own dependencies alone, still marks the package affected and a full set of slices starts for a change that cannot move a score.
//
// A package's mutation result depends on the files the `_test:mutation` task declares as inputs in turbo.json (its sources and tests, the Stryker and Vitest configs, tsconfig and package.json) and on the same inputs of every workspace package it depends on, since those are built and tested against. The workspace-level inputs below apply to every package. A change to the lockfile counts for a package only when that package's own importer block changed: a bump that only moves a transitive entry can in principle change a test's outcome, and is left to the scheduled full run rather than charged to every pull request.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { matchesGlob } from "node:path";
import { parseAllDocuments } from "yaml";
import ts from "typescript";

/** Files at the repository root that configure how every package is mutated, so a change to one of them is a change to every package's result. */
export const WORKSPACE_MUTATION_INPUTS: readonly string[] = [
  "stryker.shared.ts",
  "stryker.runner-preload.ts",
  "turbo.json",
  "pnpm-workspace.yaml",
];

/** The lockfile whose per-package importer blocks show which packages' own dependencies a change touched. */
export const LOCKFILE_PATH = "pnpm-lock.yaml";

export interface ScopedPackage {
  readonly name: string;
  readonly directory: string;
  /** The names of the workspace packages this one depends on directly. */
  readonly dependencies: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringKeys(value: unknown): readonly string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

/** The `_test:mutation` task's `inputs` from turbo.json's text, which is JSONC (it carries comments), so it is read with TypeScript's own tolerant JSON reader. Throws when the task or its inputs are missing, since without them no change could be judged relevant. */
export function mutationInputs(turboJsonText: string): readonly string[] {
  const parsed: unknown = ts.parseConfigFileTextToJson(
    "turbo.json",
    turboJsonText,
  ).config;
  const tasks = isRecord(parsed) ? parsed.tasks : undefined;
  const task = isRecord(tasks) ? tasks["_test:mutation"] : undefined;
  const inputs = isRecord(task) ? task.inputs : undefined;
  if (!Array.isArray(inputs)) {
    throw new Error("turbo.json declares no inputs for _test:mutation");
  }
  return inputs.filter((input): input is string => typeof input === "string");
}

/** The importer blocks of two lockfile texts that differ, as the workspace-relative directories pnpm keys them by. A block is a package's own resolved direct dependencies, so a difference means that package's dependencies changed. */
export function changedImporters(
  baseLockfile: string,
  headLockfile: string,
): ReadonlySet<string> {
  // pnpm writes the lockfile as more than one YAML document, and the importers are in whichever one carries them.
  const importersOf = (text: string): Record<string, unknown> => {
    for (const document of parseAllDocuments(text)) {
      const parsed: unknown = document.toJS();
      const importers = isRecord(parsed) ? parsed.importers : undefined;
      if (isRecord(importers)) return importers;
    }
    return {};
  };
  const base = importersOf(baseLockfile);
  const head = importersOf(headLockfile);
  const changed = new Set<string>();
  for (const key of new Set([...Object.keys(base), ...Object.keys(head)])) {
    if (JSON.stringify(base[key]) !== JSON.stringify(head[key])) {
      changed.add(key);
    }
  }
  return changed;
}

/** Whether a changed file is one of the package's own mutation inputs. */
function touchesPackageInputs(
  directory: string,
  inputs: readonly string[],
  file: string,
): boolean {
  const prefix = `${directory}/`;
  if (!file.startsWith(prefix)) return false;
  const relative = file.slice(prefix.length);
  return inputs.some((input) => matchesGlob(relative, input));
}

function transitiveDependencies(
  start: ScopedPackage,
  byName: ReadonlyMap<string, ScopedPackage>,
): readonly ScopedPackage[] {
  const seen = new Set<string>();
  const collected: ScopedPackage[] = [];
  const pending = [...start.dependencies];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (seen.has(name)) continue;
    seen.add(name);
    const dependency = byName.get(name);
    if (dependency === undefined) continue;
    collected.push(dependency);
    pending.push(...dependency.dependencies);
  }
  return collected;
}

export interface ScopeInput {
  readonly packages: readonly ScopedPackage[];
  readonly changedFiles: readonly string[];
  readonly inputs: readonly string[];
  /** Directories of the packages whose lockfile importer block changed. */
  readonly changedImporters: ReadonlySet<string>;
}

/** The packages whose mutation result the change can move: every package when a workspace-level input changed, otherwise each package that changed one of its own inputs or lockfile importer, or that depends (transitively) on a workspace package that did. */
export function packagesAffectedByChanges(
  scope: ScopeInput,
): readonly ScopedPackage[] {
  if (
    scope.changedFiles.some((file) => WORKSPACE_MUTATION_INPUTS.includes(file))
  ) {
    return scope.packages;
  }
  const byName = new Map(scope.packages.map((pkg) => [pkg.name, pkg]));
  const changedItself = (pkg: ScopedPackage): boolean =>
    scope.changedImporters.has(pkg.directory) ||
    scope.changedFiles.some((file) =>
      touchesPackageInputs(pkg.directory, scope.inputs, file),
    );
  return scope.packages.filter(
    (pkg) =>
      changedItself(pkg) ||
      transitiveDependencies(pkg, byName).some(changedItself),
  );
}

/** A workspace package's direct workspace dependencies, read from its package.json. */
export function readScopedPackage(
  name: string,
  directory: string,
  workspaceNames: ReadonlySet<string>,
): ScopedPackage {
  const manifest: unknown = JSON.parse(
    readFileSync(`${directory}/package.json`, "utf8"),
  );
  const declared = isRecord(manifest)
    ? [
        ...stringKeys(manifest.dependencies),
        ...stringKeys(manifest.devDependencies),
        ...stringKeys(manifest.peerDependencies),
      ]
    : [];
  return {
    name,
    directory,
    dependencies: declared.filter((dependency) =>
      workspaceNames.has(dependency),
    ),
  };
}

/** The files a change touched relative to its base, as git reports them. */
export function changedFilesSince(baseRef: string): readonly string[] {
  return execFileSync("git", ["diff", "--name-only", `${baseRef}...HEAD`], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line !== "");
}

/** The text of a file at a git ref, for comparing the lockfile before and after a change. */
export function fileAtRef(ref: string, path: string): string {
  return execFileSync("git", ["show", `${ref}:${path}`], {
    encoding: "utf8",
    maxBuffer: Number.MAX_SAFE_INTEGER,
  });
}
