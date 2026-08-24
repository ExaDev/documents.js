import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isRecord,
  isTooNew,
  minimumReleaseAgeMinutes,
  packageVersionsFromLockfile,
  projectDocument,
  splitNameAndVersion,
} from "./check-dependency-age";

// Single-document, as this workspace's pnpm-lock.yaml is, and with the multi-importer shape a thirteen-package workspace produces. The reference this was ported from parsed a two-document stream (a pnpm self-management lockfile ahead of the project's own, which is what packageManagerDependencies produces) and had to identify the project document by its importers; there is one document here, and `parse` throws rather than silently picking one if that ever stops being true.
const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .:
    devDependencies:
      zod:
        specifier: ^4.4.3
        version: 4.4.3

  packages/byte-codec:
    dependencies:
      undici:
        specifier: ^7.29.0
        version: 7.29.0

packages:

  '@scope/pkg@1.0.0(peer@2.0.0)':
    resolution: {integrity: sha512-y}

  undici@7.29.0:
    resolution: {integrity: sha512-z}
`;

const WORKSPACE_YAML = readFileSync(
  new URL("../../pnpm-workspace.yaml", import.meta.url),
  "utf8",
);

describe("minimumReleaseAgeMinutes", () => {
  it("reads the configured window as minutes", () => {
    expect(minimumReleaseAgeMinutes("minimumReleaseAge: 60\n")).toBe(60);
  });

  it("throws rather than defaulting when the key is absent", () => {
    expect(() => minimumReleaseAgeMinutes('packages:\n  - "."\n')).toThrow(
      /minimumReleaseAge/,
    );
  });

  it("throws when the key is present but not a number", () => {
    expect(() => minimumReleaseAgeMinutes('minimumReleaseAge: "60"\n')).toThrow(
      /minimumReleaseAge/,
    );
  });

  it("reads a number out of this workspace's own file", () => {
    expect(typeof minimumReleaseAgeMinutes(WORKSPACE_YAML)).toBe("number");
  });
});

describe("isTooNew", () => {
  const now = Date.UTC(2026, 0, 15, 12, 0, 0);
  const minutesAgo = (minutes: number): Date =>
    new Date(now - minutes * 60 * 1000);
  const windowMinutes = minimumReleaseAgeMinutes("minimumReleaseAge: 60\n");

  it("treats a package published inside the window as too new", () => {
    expect(isTooNew(minutesAgo(30), now, windowMinutes)).toBe(true);
  });

  it("treats a package published outside the window as old enough", () => {
    expect(isTooNew(minutesAgo(90), now, windowMinutes)).toBe(false);
  });

  // The unit itself: 60 means sixty minutes, so two days clears the window comfortably. Were the configured number read as days -- as the seven-day reference implementation this was ported from read its own -- a two-day-old package would still be sixty days short.
  it("reads the configured number as minutes rather than days", () => {
    const twoDays = 2 * 24 * 60;
    expect(isTooNew(minutesAgo(twoDays), now, windowMinutes)).toBe(false);
  });

  it("is exclusive at the boundary, so a package exactly at the window is old enough", () => {
    expect(isTooNew(minutesAgo(windowMinutes), now, windowMinutes)).toBe(false);
  });
});

describe("projectDocument", () => {
  it("returns the document holding the workspace root's importer", () => {
    const doc = projectDocument(LOCKFILE);
    expect(isRecord(doc.importers)).toBe(true);
    expect(isRecord(doc.packages)).toBe(true);
  });

  it("throws when no document has a project importer", () => {
    expect(() =>
      projectDocument("lockfileVersion: '9.0'\n\npackages:\n  a@1.0.0: {}\n"),
    ).toThrow(/project importers/);
  });

  it("throws on a multi-document stream rather than reading only its first document", () => {
    expect(() =>
      projectDocument(`---\npackages:\n  pnpm@11.6.0: {}\n---\n${LOCKFILE}`),
    ).toThrow(/multiple documents/);
  });
});

describe("packageVersionsFromLockfile", () => {
  it("strips peer-dependency suffixes from lockfile keys", () => {
    const entries = packageVersionsFromLockfile(LOCKFILE);
    expect(entries.has("@scope/pkg@1.0.0")).toBe(true);
    expect(entries.has("@scope/pkg@1.0.0(peer@2.0.0)")).toBe(false);
    expect(entries.has("undici@7.29.0")).toBe(true);
  });

  it("diffs a base and head lockfile down to the versions the head introduces", () => {
    const head = LOCKFILE.replace(
      "  undici@7.29.0:\n    resolution: {integrity: sha512-z}\n",
      "  undici@7.30.0:\n    resolution: {integrity: sha512-w}\n",
    );
    const base = packageVersionsFromLockfile(LOCKFILE);
    const introduced = [...packageVersionsFromLockfile(head)].filter(
      (entry) => !base.has(entry),
    );
    expect(introduced.map(splitNameAndVersion)).toEqual([
      { name: "undici", version: "7.30.0" },
    ]);
  });

  it("throws when the project document has no packages map", () => {
    expect(() =>
      packageVersionsFromLockfile(
        "importers:\n  .:\n    dependencies:\n      zod: 4.4.3\n",
      ),
    ).toThrow(/packages/);
  });
});

describe("splitNameAndVersion", () => {
  it("splits an unscoped name", () => {
    expect(splitNameAndVersion("undici@7.29.0")).toEqual({
      name: "undici",
      version: "7.29.0",
    });
  });

  it("splits a scoped name on the last @, not the scope's", () => {
    expect(splitNameAndVersion("@scope/pkg@1.2.3")).toEqual({
      name: "@scope/pkg",
      version: "1.2.3",
    });
  });
});
