import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  changedImporters,
  mutationInputs,
  packagesAffectedByChanges,
  type ScopedPackage,
} from "./mutation-scope";

const INPUTS = mutationInputs(readFileSync("turbo.json", "utf8"));

function pkg(name: string, ...dependencies: readonly string[]): ScopedPackage {
  return { name, directory: `packages/${name}`, dependencies };
}

// A small workspace with the dependency shape the real one has: leaf codecs, a package built from several of them, and an application on top.
const WORKSPACE: readonly ScopedPackage[] = [
  pkg("byte-codec"),
  pkg("xls-codec", "byte-codec"),
  pkg("markdown-codec"),
  pkg("pdf-codec", "byte-codec"),
  pkg("documents.js", "xls-codec", "markdown-codec", "pdf-codec"),
  pkg("document-cli", "documents.js"),
  pkg("web"),
];

function affected(
  changedFiles: readonly string[],
  importers: readonly string[] = [],
): readonly string[] {
  return packagesAffectedByChanges({
    packages: WORKSPACE,
    changedFiles,
    inputs: INPUTS,
    changedImporters: new Set(importers),
  }).map((entry) => entry.name);
}

describe("mutationInputs", () => {
  it("reads the _test:mutation inputs from turbo.json despite its comments", () => {
    expect(INPUTS).toEqual(expect.arrayContaining(["src/**", "package.json"]));
  });

  it("throws when the task declares no inputs", () => {
    expect(() =>
      mutationInputs('{ "tasks": { "_test:mutation": {} } }'),
    ).toThrow(/_test:mutation/);
  });
});

describe("changedImporters", () => {
  const lock = (importers: string): string => `importers:\n${importers}`;

  it("names the importers whose block differs and no others", () => {
    const base = lock(
      "  .:\n    devDependencies:\n      tool: 1.0.0\n  packages/a:\n    dependencies:\n      x: 1.0.0\n  packages/b:\n    dependencies:\n      y: 1.0.0\n",
    );
    const head = lock(
      "  .:\n    devDependencies:\n      tool: 1.0.1\n  packages/a:\n    dependencies:\n      x: 2.0.0\n  packages/b:\n    dependencies:\n      y: 1.0.0\n",
    );
    expect([...changedImporters(base, head)].sort()).toEqual([
      ".",
      "packages/a",
    ]);
  });

  it("counts an importer that appears or disappears as changed", () => {
    expect(
      [
        ...changedImporters(
          lock("  packages/a:\n    dependencies:\n      x: 1.0.0\n"),
          lock("  packages/b:\n    dependencies:\n      x: 1.0.0\n"),
        ),
      ].sort(),
    ).toEqual(["packages/a", "packages/b"]);
  });

  it("finds the importers in a lockfile of several YAML documents", () => {
    const withEnvironment = (importers: string): string =>
      `lockfileVersion: env\nsettings:\n  x: 1\n---\n${lock(importers)}`;
    expect([
      ...changedImporters(
        withEnvironment("  packages/a:\n    dependencies:\n      x: 1.0.0\n"),
        withEnvironment("  packages/a:\n    dependencies:\n      x: 2.0.0\n"),
      ),
    ]).toEqual(["packages/a"]);
  });

  it("is empty when only entries outside the importers differ", () => {
    const base = `${lock("  packages/a:\n    dependencies:\n      x: 1.0.0\n")}\npackages:\n  x@1.0.0: {}\n`;
    const head = `${lock("  packages/a:\n    dependencies:\n      x: 1.0.0\n")}\npackages:\n  x@1.0.0: {}\n  y@2.0.0: {}\n`;
    expect(changedImporters(base, head).size).toBe(0);
  });
});

describe("packagesAffectedByChanges", () => {
  it("starts nothing for a change to a package's README", () => {
    expect(affected(["packages/pdf-codec/README.md"])).toEqual([]);
  });

  it("starts nothing for a root manifest and lockfile bump that no package importer shares", () => {
    expect(affected(["package.json", "pnpm-lock.yaml"], ["."])).toEqual([]);
  });

  it("starts nothing for a workflow, documentation or script change", () => {
    expect(
      affected([
        ".github/workflows/ci.yml",
        "README.md",
        ".github/scripts/plan-mutation-slices.ts",
      ]),
    ).toEqual([]);
  });

  it("covers a package whose sources change and every package built on it", () => {
    expect(affected(["packages/markdown-codec/src/block/block.ts"])).toEqual([
      "markdown-codec",
      "documents.js",
      "document-cli",
    ]);
  });

  it("covers a package whose test files change", () => {
    expect(affected(["packages/web/src/app.test.tsx"])).toEqual(["web"]);
  });

  it("follows a dependency through the packages built on top of it", () => {
    expect(affected(["packages/byte-codec/src/base64.ts"])).toEqual([
      "byte-codec",
      "xls-codec",
      "pdf-codec",
      "documents.js",
      "document-cli",
    ]);
  });

  it("counts a package's own manifest and lockfile importer", () => {
    expect(
      affected(
        [
          "packages/xls-codec/package.json",
          "packages/xls-codec/src/a.ts",
          "pnpm-lock.yaml",
        ],
        ["packages/xls-codec"],
      ),
    ).toEqual(["xls-codec", "documents.js", "document-cli"]);
  });

  it("counts a lockfile importer change even when the manifest is untouched", () => {
    expect(affected(["pnpm-lock.yaml"], ["packages/web"])).toEqual(["web"]);
  });

  it("covers every package when a workspace-level mutation input changes", () => {
    for (const file of [
      "stryker.shared.ts",
      "turbo.json",
      "stryker.runner-preload.ts",
    ]) {
      expect(affected([file])).toHaveLength(WORKSPACE.length);
    }
  });

  it("does not treat a similarly named directory as the package's own", () => {
    expect(affected(["packages/web-extra/src/a.ts"])).toEqual([]);
  });
});
