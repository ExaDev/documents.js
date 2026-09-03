import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";
import {
  classifyAdvisories,
  currentOverrides,
  inertOverrideKeys,
  isAuditAdvisory,
  isAuditReport,
  isAuditServiceError,
  minimumReleaseAgeMinutes,
  resolvedVersionsFromLockfileText,
  withOverrides,
  type AuditAdvisory,
} from "./audit-autofix";

function advisory(overrides: Partial<AuditAdvisory> = {}): AuditAdvisory {
  return {
    module_name: "undici",
    vulnerable_versions: ">=7.0.0 <7.29.0",
    patched_versions: ">=7.29.0",
    severity: "high",
    github_advisory_id: "GHSA-test-test-test",
    title: "test advisory",
    url: "https://github.com/advisories/GHSA-test-test-test",
    ...overrides,
  };
}

// Shaped like this workspace's real pnpm-workspace.yaml: an explanatory comment attached to the `overrides` key itself, and a second comment attached to one entry inside the map. Those two comments live in different places and do not survive the same operations, which is the whole reason the fix path patches child keys.
const WORKSPACE = `packages:
  - "packages/*"

minimumReleaseAge: 60

# fast-uri < 3.1.5 is vulnerable to host confusion via a backslash authority introducer (GHSA-hht2-r2mx-9j9m). A transitive devDependency, so only an override can force a patched version.
overrides:
  # The rationale for this one entry, as opposed to the map as a whole.
  fast-uri: ^3.1.5
  js-yaml: ^4.3.1
`;

const KEY_COMMENT = /GHSA-hht2-r2mx-9j9m/;
const ENTRY_COMMENT = /rationale for this one entry/;

const WORKSPACE_YAML = readFileSync(
  new URL("../../pnpm-workspace.yaml", import.meta.url),
  "utf8",
);

describe("audit report guards", () => {
  it("accepts a well-formed advisory", () => {
    expect(isAuditAdvisory(advisory())).toBe(true);
  });

  it("rejects an advisory missing a field", () => {
    const withoutUrl: Record<string, unknown> = { ...advisory() };
    delete withoutUrl.url;
    expect(isAuditAdvisory(withoutUrl)).toBe(false);
  });

  it("rejects a report whose advisories are not all well-formed", () => {
    expect(isAuditReport({ advisories: { a: advisory(), b: 42 } })).toBe(false);
    expect(isAuditReport({ advisories: { a: advisory() } })).toBe(true);
  });
});

describe("isAuditServiceError", () => {
  it("accepts npm's own real error envelope, reproduced against a live timeout", () => {
    // registry.npmjs.org/-/npm/v1/security/advisories/bulk's own shape when it times out -- captured verbatim from a real `pnpm audit --json` run against this workspace during an outage, not invented.
    expect(
      isAuditServiceError({
        error: {
          code: 23,
          message: "The operation was aborted due to timeout",
        },
      }),
    ).toBe(true);
  });

  it("rejects a well-formed report", () => {
    expect(isAuditServiceError({ advisories: { a: advisory() } })).toBe(false);
  });

  it("rejects an error envelope missing a numeric code or string message", () => {
    expect(isAuditServiceError({ error: { message: "no code" } })).toBe(false);
    expect(isAuditServiceError({ error: { code: 23 } })).toBe(false);
  });
});

describe("minimumReleaseAgeMinutes", () => {
  it("reads the configured window as minutes, not days", () => {
    expect(minimumReleaseAgeMinutes(WORKSPACE)).toBe(60);
  });

  it("throws rather than defaulting when the key is absent", () => {
    expect(() => minimumReleaseAgeMinutes('packages:\n  - "."\n')).toThrow(
      /minimumReleaseAge/,
    );
  });

  it("reads a number out of this workspace's own file", () => {
    expect(typeof minimumReleaseAgeMinutes(WORKSPACE_YAML)).toBe("number");
  });
});

describe("override bookkeeping", () => {
  it("adds a child key, leaving every other line of the document byte-identical", () => {
    const workspace = parseDocument(WORKSPACE);
    const next = withOverrides(workspace, {
      ...currentOverrides(workspace),
      "undici@>=7.0.0 <7.29.0": ">=7.29.0",
    });
    const before = WORKSPACE.split("\n");
    const after = next.toString().split("\n");
    expect(after.filter((line) => !before.includes(line))).toEqual([
      '  undici@>=7.0.0 <7.29.0: ">=7.29.0"',
    ]);
    expect(before.filter((line) => !after.includes(line))).toEqual([]);
  });

  it("preserves both the key's comment and an individual entry's comment through a fix", () => {
    const next = withOverrides(parseDocument(WORKSPACE), {
      "fast-uri": "^3.1.5",
      "js-yaml": "^4.3.1",
      undici: ">=7.29.0",
    });
    expect(next.toString()).toMatch(KEY_COMMENT);
    expect(next.toString()).toMatch(ENTRY_COMMENT);
  });

  // Pins the yaml behaviour the design above depends on, so an upgrade that changed it would fail here rather than quietly start deleting per-entry rationale. Replacing the whole node -- which is what the implementation this was ported from did -- keeps the comment attached to the `overrides` key (it belongs to the key, not the value) and destroys every comment attached to an entry inside the map, because those entries' nodes are rebuilt from plain JS.
  it("would lose the entry comment, but not the key comment, if the whole node were replaced", () => {
    const replaced = parseDocument(WORKSPACE);
    replaced.set("overrides", {
      "fast-uri": "^3.1.5",
      "js-yaml": "^4.3.1",
      undici: ">=7.29.0",
    });
    expect(replaced.toString()).toMatch(KEY_COMMENT);
    expect(replaced.toString()).not.toMatch(ENTRY_COMMENT);
  });

  it("prunes only the omitted key, keeping the survivor's own comment", () => {
    const next = withOverrides(parseDocument(WORKSPACE), {
      "fast-uri": "^3.1.5",
    });
    expect(currentOverrides(next)).toEqual({ "fast-uri": "^3.1.5" });
    expect(next.toString()).toMatch(ENTRY_COMMENT);
    expect(next.toString()).toMatch(KEY_COMMENT);
    expect(next.toString()).not.toMatch(/js-yaml/);
  });

  it("deletes the key entirely for an empty map, rather than writing an empty one", () => {
    const next = withOverrides(parseDocument(WORKSPACE), {});
    expect(currentOverrides(next)).toEqual({});
    expect(next.toString()).not.toMatch(/overrides/);
    expect(next.toString()).toMatch(/minimumReleaseAge: 60/);
  });

  it("creates the overrides node when the document has none", () => {
    const next = withOverrides(parseDocument('packages:\n  - "."\n'), {
      undici: ">=7.29.0",
    });
    expect(next.toJS()).toEqual({
      packages: ["."],
      overrides: { undici: ">=7.29.0" },
    });
  });

  it("does not mutate the document it is given", () => {
    const workspace = parseDocument(WORKSPACE);
    withOverrides(workspace, { undici: ">=7.29.0" });
    expect(currentOverrides(workspace)).toEqual({
      "fast-uri": "^3.1.5",
      "js-yaml": "^4.3.1",
    });
  });

  it("removes nothing from this workspace's own file when applying a fix", () => {
    const workspace = parseDocument(WORKSPACE_YAML);
    const next = withOverrides(workspace, {
      ...currentOverrides(workspace),
      undici: ">=7.29.0",
    }).toString();
    const after = next.split("\n");
    expect(
      WORKSPACE_YAML.split("\n").filter((l) => !after.includes(l)),
    ).toEqual([]);
    expect(currentOverrides(parseDocument(next))).toMatchObject({
      undici: ">=7.29.0",
    });
  });

  it("currentOverrides reads back only string-valued entries", () => {
    const workspace = parseDocument(
      "overrides:\n  keep: ^1.0.0\n  drop: 42\n  also: null\n",
    );
    expect(currentOverrides(workspace)).toEqual({ keep: "^1.0.0" });
    expect(currentOverrides(parseDocument(""))).toEqual({});
  });
});

describe("classifyAdvisories", () => {
  it("defers pnpm self-audit findings rather than offering them as override candidates", () => {
    const { deferred, candidates } = classifyAdvisories([
      advisory({ module_name: "pnpm", patched_versions: ">=11.5.3" }),
    ]);
    expect(candidates).toEqual([]);
    expect(deferred.map((d) => d.reason)).toEqual([
      expect.stringMatching(/packageManager/),
    ]);
  });

  it("defers advisories with no patched version", () => {
    const { deferred, candidates } = classifyAdvisories([
      advisory({ patched_versions: "<0.0.0" }),
      advisory({
        github_advisory_id: "GHSA-two-two-two",
        patched_versions: "",
      }),
    ]);
    expect(candidates).toEqual([]);
    expect(deferred.map((d) => d.reason)).toEqual([
      "no patched version exists upstream yet",
      "no patched version exists upstream yet",
    ]);
  });

  it("groups advisories sharing a module and vulnerable range under one candidate", () => {
    const first = advisory({ github_advisory_id: "GHSA-a" });
    const second = advisory({
      github_advisory_id: "GHSA-b",
      patched_versions: ">=7.30.0",
    });
    const { candidates, deferred } = classifyAdvisories([first, second]);
    expect(deferred).toEqual([]);
    expect(candidates.map((c) => c.overrideKey)).toEqual([
      "undici@>=7.0.0 <7.29.0",
    ]);
    expect(candidates.map((c) => c.advisories.length)).toEqual([2]);
    // The later advisory's patched range wins, matching the existing append-and-overwrite behaviour.
    expect(candidates.map((c) => c.range)).toEqual([">=7.30.0"]);
  });

  it("keeps distinct modules and distinct ranges as separate candidates", () => {
    const { candidates } = classifyAdvisories([
      advisory(),
      advisory({
        module_name: "fast-uri",
        github_advisory_id: "GHSA-c",
      }),
      advisory({
        github_advisory_id: "GHSA-d",
        vulnerable_versions: ">=7.30.0 <7.31.0",
        patched_versions: ">=7.31.0",
      }),
    ]);
    expect(candidates.map((c) => c.overrideKey)).toEqual([
      "undici@>=7.0.0 <7.29.0",
      "fast-uri@>=7.0.0 <7.29.0",
      "undici@>=7.30.0 <7.31.0",
    ]);
  });
});

describe("override pruning", () => {
  // Single-document, as this workspace's lockfile is, and with the multi-importer shape a thirteen-package workspace produces: `packages` is the union of every importer's resolutions, which is what an inertness check has to read.
  const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      zod: 4.4.3

  packages/byte-codec:
    dependencies:
      undici: 6.28.0

packages:

  undici@6.28.0:
    resolution: {integrity: sha512-x}

  undici@7.29.0:
    resolution: {integrity: sha512-y}

  '@scope/pkg@1.0.0(peer@2.0.0)':
    resolution: {integrity: sha512-z}
`;

  it("resolves the package versions, peer suffixes stripped", () => {
    const resolved = resolvedVersionsFromLockfileText(LOCKFILE);
    expect(resolved.get("undici")).toEqual(new Set(["6.28.0", "7.29.0"]));
    expect(resolved.get("@scope/pkg")).toEqual(new Set(["1.0.0"]));
  });

  it("throws on a multi-document lockfile rather than reading only the first document", () => {
    expect(() =>
      resolvedVersionsFromLockfileText(
        `---\npackages:\n  pnpm@11.6.0: {}\n---\n${LOCKFILE}`,
      ),
    ).toThrow(/multiple documents/);
  });

  it("throws when the lockfile has no packages map", () => {
    expect(() =>
      resolvedVersionsFromLockfileText(
        "importers:\n  .:\n    dependencies: {}\n",
      ),
    ).toThrow(/packages/);
  });

  it("flags overrides whose selector matches no resolved version, ignoring out-of-selector resolutions", () => {
    const resolved = resolvedVersionsFromLockfileText(LOCKFILE);
    const inert = inertOverrideKeys(
      {
        // no resolved undici is <6.27.0, so the selector can never rewrite anything -- inert
        "undici@<6.27.0": ">=6.27.0",
        // 6.28.0 sits below this selector and 7.29.0 above it (the range excludes 7.29.0), so nothing matches -- inert
        "undici@>=7.0.0 <7.29.0": ">=7.29.0",
        // a selector that DOES match 7.29.0 would be load-bearing; this one does not
        "undici@>=8.0.0": ">=8.1.0",
        // package absent from the lockfile -- kept (nothing proves it will not return)
        "ghost@<2.0.0": ">=2.0.0",
        // bare selector-less key -- never provably inert, kept
        "fast-uri": "^3.1.5",
      },
      resolved,
    );
    expect(inert).toEqual([
      "undici@<6.27.0",
      "undici@>=7.0.0 <7.29.0",
      "undici@>=8.0.0",
    ]);
  });
});
