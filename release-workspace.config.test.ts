import { describe, expect, it } from "vitest";

import config from "./release-workspace.config";

/**
 * release-workspace.config.ts holds two independent lists of conventional-commit types, and nothing in the file itself forces them to agree.
 *
 * analyzeCommits.releaseRules decides which types earn a release, and is also the list commitlint.config.ts derives its type-enum from. generateNotes.presetConfig.types decides which types get a section in the release notes and CHANGELOG. A type present in the first but absent from the second still triggers a release, but falls back to the conventionalcommits preset's own default entry -- where docs, style, chore, refactor, test, build and ci all carry `effect: 'hidden'` -- so it publishes a version whose notes and changelog entry are empty. That is silent by nature: the release succeeds, the tag lands, npm gets the version, and only a human reading the GitHub release notices there is nothing in them.
 *
 * These tests make that agreement mechanical rather than a convention someone has to remember, which is the same invariant commitlint.config.ts already relies on from the other direction: a type cannot trigger a release without also being accepted by commit-msg validation, or the reverse.
 *
 * analyzeCommits/generateNotes are typed as Record<string, unknown> in @exadev/semantic-release-workspace's own ReleaseWorkspaceOptions -- they are passed straight through to @semantic-release/commit-analyzer and @semantic-release/release-notes-generator, whose own option shapes this SDK does not model -- so TypeScript cannot enforce the releaseRules/presetConfig.types agreement on its own, and the runtime narrowing below is still load-bearing.
 */

const CONFIG_FILE = "release-workspace.config.ts";

interface CommitTypeEntry {
  readonly type: string;
  readonly section?: unknown;
  readonly effect?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An entry keyed by commit type. releaseRules' `{ breaking: true }` entry has no type and is deliberately not matched: "breaking" is a commit footer, never a type anyone writes in a subject line. */
function isCommitTypeEntry(value: unknown): value is CommitTypeEntry {
  return isRecord(value) && typeof value.type === "string";
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${CONFIG_FILE} must define ${path} as an object`);
  }
  return value;
}

function requireEntries(
  value: unknown,
  path: string,
): readonly CommitTypeEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(`${CONFIG_FILE} must define ${path} as an array`);
  }
  return value.filter(isCommitTypeEntry);
}

const analyzeCommits = requireRecord(config.analyzeCommits, "analyzeCommits");
const generateNotes = requireRecord(config.generateNotes, "generateNotes");
const presetConfig = requireRecord(
  generateNotes.presetConfig,
  "generateNotes.presetConfig",
);

const releasableTypes = requireEntries(
  analyzeCommits.releaseRules,
  "analyzeCommits.releaseRules",
).map((rule) => rule.type);
const noteEntries = requireEntries(
  presetConfig.types,
  "generateNotes.presetConfig.types",
);

describe("release-workspace.config.ts", () => {
  it("analyses and renders commits under the same preset", () => {
    // The writer a preset ships is only guaranteed to render the commit shapes that preset's own parser produces. Analysing with conventionalcommits while rendering with angular is what dropped every docs/style/refactor/test/build/ci/chore release's notes: angular's transform returns undefined for those types unless the commit carries a breaking-change note, so a release triggered by one of them published an empty body.
    expect(generateNotes.preset).toBe(analyzeCommits.preset);
  });

  it("gives exactly the releasable commit types a release-notes section", () => {
    // Equality in both directions: a releasable type with no entry falls back to the preset's hidden default, and an entry for a type that earns no release is dead config.
    expect([...noteEntries.map((entry) => entry.type)].sort()).toStrictEqual(
      [...releasableTypes].sort(),
    );
  });

  it("names a non-empty section for every type", () => {
    for (const { type, section } of noteEntries) {
      expect(section, `type "${type}" needs a section name`).toBeTypeOf(
        "string",
      );
      expect(section, `type "${type}" needs a section name`).not.toBe("");
    }
  });

  it("hides no type that earns a release", () => {
    // The preset's own defaults mark docs, style, chore, refactor, test, build and ci hidden. Every one of them earns a patch release here, so a hidden entry would reintroduce the empty-notes release this list exists to prevent.
    for (const { type, effect } of noteEntries) {
      const message = `type "${type}" earns a release, so it must not be hidden`;
      expect(effect, message).not.toBe("hidden");
      expect(effect, message).not.toBe(true);
    }
  });
});
