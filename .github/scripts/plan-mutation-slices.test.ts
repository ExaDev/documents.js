import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COLD_FIXED_SECONDS,
  COLD_SECONDS_PER_LINE,
  COLD_SECONDS_PER_LINE_BY_PACKAGE,
  ACCOUNT_RUNNER_LIMIT,
  EXPECTED_CONCURRENT_PULL_REQUEST_RUNS,
  GITHUB_JOB_LIMIT_MINUTES,
  MUTATION_SHARE_OF_RUNNER_LIMIT,
  affectedMutationPackages,
  coldSecondsPerLineFor,
  estimateColdSeconds,
  matchesMutateGlobs,
  maxParallelFor,
  packageMatrixEntries,
  partitionForEvent,
  resolveMutateGlobs,
  selectRequested,
  planSlices,
  sliceBudgetSeconds,
  strykerConfigHash,
  timeoutMinutesFor,
  type SourceFile,
} from "./plan-mutation-slices";

// Cold (no incremental report) whole-package runs from the main-branch mutation run that predates the sliced workflow, as [source lines at that time, wall-clock seconds of the package's Stryker run]. These are the calibration samples the cost estimate must stay above: a sample above the estimate means a slice planned at the budget could overrun it. Add samples from later cold runs rather than editing these.
const COLD_SAMPLES: readonly (readonly [
  name: string,
  lines: number,
  seconds: number,
])[] = [
  ["byte-codec", 1129, 573],
  ["epub-codec", 4776, 800],
  ["document-schema.js", 7091, 2183],
  ["excel-number-format", 414, 83],
  ["xls-codec", 14946, 1916],
  ["document-operations", 2194, 227],
  ["document-rest", 255, 211],
  ["markdown-codec", 11617, 2423],
  ["rtf-codec", 8914, 1656],
  ["document-outline.js", 3772, 2147],
  ["document-mcp", 847, 374],
  ["doc-codec", 9501, 1085],
  ["wpd-codec", 9194, 1000],
  ["web", 6098, 3453],
];

// Slice runs from the first full run of the sliced workflow, as [package and slice, source lines in the slice, wall-clock seconds of the slice's Stryker run]. Some restored results saved by an earlier layout, so they run faster than a cold slice would; the estimate only has to stay above them, and the slowest ones (a package whose tests are heavy per line) are what set its per-line cost. Add samples from later runs rather than editing these.
const SLICE_SAMPLES: readonly (readonly [
  name: string,
  lines: number,
  seconds: number,
])[] = [
  ["archive-codec 1", 3324, 265],
  ["byte-codec 1", 1129, 360],
  ["doc-codec 1", 4720, 537],
  ["doc-codec 2", 4696, 519],
  ["document-cli 1", 4799, 4935],
  ["document-cli 2", 4795, 4638],
  ["document-cli 3", 4798, 4526],
  ["document-cli 4", 4800, 3796],
  ["document-compute.js 1", 1491, 204],
  ["document-mcp 1", 847, 403],
  ["document-operations 1", 2194, 218],
  ["document-outline.js 1", 3772, 2259],
  ["document-rest 1", 255, 215],
  ["document-schema.js 1", 3545, 1300],
  ["document-schema.js 2", 3546, 1008],
  ["documents.js 1", 5728, 3839],
  ["documents.js 2", 5738, 1961],
  ["documents.js 3", 5738, 1878],
  ["documents.js 4", 5737, 2743],
  ["documents.js 5", 5737, 2383],
  ["documents.js 6", 5735, 2824],
  ["documents.js 7", 5729, 3285],
  ["documents.js 8", 5737, 2492],
  ["documents.js 9", 5722, 3547],
  ["epub-codec 1", 4723, 851],
  ["excel-number-format 1", 414, 81],
  ["markdown-codec 1", 5737, 615],
  ["markdown-codec 2", 5744, 1381],
  ["odf.js 1", 5233, 1742],
  ["odf.js 2", 5235, 1531],
  ["odf.js 3", 5234, 1566],
  ["odf.js 4", 5233, 953],
  ["ooxml.js 1", 5386, 1344],
  ["ooxml.js 2", 5385, 1597],
  ["ooxml.js 3", 5394, 1160],
  ["pdf-codec 1", 6100, 1187],
  ["pdf-codec 2", 6099, 1378],
  ["pdf-codec 3", 6099, 1694],
  ["pdf-codec 4", 6099, 2920],
  ["pdf-codec 5", 6099, 2435],
  ["pdf-codec 6", 6098, 2671],
  ["pdf-raster-cpu 1", 821, 262],
  ["ppt-codec 1", 3497, 276],
  ["ppt-codec 2", 3473, 403],
  ["rtf-codec 1", 4453, 1243],
  ["rtf-codec 2", 4442, 789],
  ["web 1", 6098, 3480],
  ["wpd-codec 1", 4582, 97],
  ["wpd-codec 2", 4585, 924],
  ["xls-codec 1", 4983, 849],
  ["xls-codec 2", 4978, 379],
  ["xls-codec 3", 4985, 629],
];

// Slice runs from scheduled run 45604657786 (2026-11-25), in which a configuration change had emptied every slice's incremental cache, so each listed slice ran cold, as [package and slice, source lines in the slice, wall-clock seconds of the slice's Stryker run]. "document-cli 2" did not finish: its job timeout cancelled it, so its figure is the time it had run by then, a lower bound on its real cost. Add samples from later runs rather than editing these.
const COLD_SLICE_SAMPLES: readonly (readonly [
  name: string,
  lines: number,
  seconds: number,
])[] = [
  ["doc-codec 1", 4277, 553],
  ["doc-codec 2", 4301, 419],
  ["document-cli 1", 4739, 8924],
  ["document-cli 2", 4742, 10610],
  ["document-cli 3", 4744, 6646],
  ["document-cli 4", 4742, 7055],
  ["document-schema.js 1", 4430, 2528],
  ["document-schema.js 2", 4420, 1267],
  ["documents.js 1", 4827, 1495],
  ["documents.js 2", 4829, 1487],
  ["documents.js 3", 4829, 2164],
  ["documents.js 4", 4820, 1919],
  ["documents.js 5", 4826, 3142],
  ["documents.js 6", 4826, 2219],
  ["documents.js 7", 4823, 1518],
  ["documents.js 8", 4827, 4168],
  ["documents.js 9", 4826, 1745],
  ["documents.js 10", 4826, 1404],
  ["documents.js 11", 4824, 2436],
  ["documents.js 12", 4825, 1270],
  ["markdown-codec 1", 3890, 310],
  ["markdown-codec 2", 3898, 567],
  ["markdown-codec 3", 3897, 681],
  ["odf.js 1", 4301, 1437],
  ["odf.js 2", 4291, 1319],
  ["odf.js 3", 4289, 897],
  ["odf.js 4", 4289, 1078],
  ["odf.js 5", 4299, 743],
  ["ooxml.js 1", 4278, 1042],
  ["ooxml.js 2", 4279, 799],
  ["ooxml.js 3", 4280, 767],
  ["ooxml.js 4", 4268, 1023],
  ["pdf-codec 1", 4907, 1263],
  ["pdf-codec 2", 4909, 1347],
  ["pdf-codec 3", 4908, 1313],
  ["pdf-codec 4", 4909, 4785],
  ["pdf-codec 5", 4909, 2081],
  ["pdf-codec 6", 4909, 3283],
  ["pdf-codec 8", 4907, 2125],
  ["ppt-codec 1", 3139, 282],
  ["ppt-codec 2", 3161, 399],
  ["rtf-codec 1", 4029, 901],
  ["rtf-codec 2", 4032, 521],
  ["web 1", 3189, 1562],
  ["web 2", 3185, 1742],
  ["wpd-codec 1", 4799, 377],
  ["wpd-codec 2", 4802, 267],
  ["xls-codec 1", 4972, 552],
  ["xls-codec 2", 4962, 461],
  ["xls-codec 3", 4964, 615],
];

const PACKAGES_DIRECTORY = join(import.meta.dirname, "../../packages");

/** The package a slice sample's name is for: the name without its trailing slice number. */
function packageOf(sliceName: string): string {
  return sliceName.slice(0, sliceName.lastIndexOf(" "));
}

const BYTE_CODEC = { name: "byte-codec", directory: "packages/byte-codec" };
const BIG_PACKAGE = { name: "big-package", directory: "packages/big-package" };

function files(...lineCounts: readonly number[]): readonly SourceFile[] {
  return lineCounts.map((lines, index) => ({
    path: `src/file-${String(index)}.ts`,
    lines,
  }));
}

function linesOf(slice: readonly SourceFile[]): number {
  return slice.reduce((total, file) => total + file.lines, 0);
}

describe("affectedMutationPackages", () => {
  it("extracts only the _test:mutation task's own packages from a turbo dry-run plan", () => {
    const plan = JSON.stringify({
      tasks: [
        {
          task: "_build",
          package: "byte-codec",
          directory: "packages/byte-codec",
        },
        {
          task: "_test:mutation",
          package: "byte-codec",
          directory: "packages/byte-codec",
        },
        {
          task: "_test:mutation",
          package: "doc-codec",
          directory: "packages/doc-codec",
        },
      ],
    });
    expect(affectedMutationPackages(plan)).toEqual([
      { name: "byte-codec", directory: "packages/byte-codec" },
      { name: "doc-codec", directory: "packages/doc-codec" },
    ]);
  });

  it("returns an empty list when nothing is affected", () => {
    expect(affectedMutationPackages(JSON.stringify({ tasks: [] }))).toEqual([]);
  });
});

describe("estimateColdSeconds", () => {
  it.each(COLD_SAMPLES)(
    "stays at or above the measured cold run of %s",
    (name, lines, seconds) => {
      expect(
        estimateColdSeconds(lines, coldSecondsPerLineFor(name)),
      ).toBeGreaterThanOrEqual(seconds);
    },
  );

  it.each([...SLICE_SAMPLES, ...COLD_SLICE_SAMPLES])(
    "stays at or above the measured slice run of %s",
    (name, lines, seconds) => {
      expect(
        estimateColdSeconds(lines, coldSecondsPerLineFor(packageOf(name))),
      ).toBeGreaterThanOrEqual(seconds);
    },
  );

  it("starts at the fixed cost for an empty package and grows with size", () => {
    expect(estimateColdSeconds(0, COLD_SECONDS_PER_LINE)).toBe(
      COLD_FIXED_SECONDS,
    );
    expect(estimateColdSeconds(1000, COLD_SECONDS_PER_LINE)).toBeGreaterThan(
      estimateColdSeconds(10, COLD_SECONDS_PER_LINE),
    );
  });
});

describe("coldSecondsPerLineFor", () => {
  it("gives a package without its own rate the shared one", () => {
    expect(coldSecondsPerLineFor("byte-codec")).toBe(COLD_SECONDS_PER_LINE);
  });

  it.each([...COLD_SECONDS_PER_LINE_BY_PACKAGE])(
    "gives %s its own rate, above the shared one",
    (name, secondsPerLine) => {
      expect(coldSecondsPerLineFor(name)).toBe(secondsPerLine);
      expect(secondsPerLine).toBeGreaterThan(COLD_SECONDS_PER_LINE);
    },
  );

  it.each([...COLD_SECONDS_PER_LINE_BY_PACKAGE.keys()])(
    "names %s, a workspace package",
    (name) => {
      const packageNames = readdirSync(PACKAGES_DIRECTORY).flatMap((entry) => {
        const manifest = join(PACKAGES_DIRECTORY, entry, "package.json");
        if (!existsSync(manifest)) return [];
        const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
        return typeof parsed === "object" &&
          parsed !== null &&
          "name" in parsed &&
          typeof parsed.name === "string"
          ? [parsed.name]
          : [];
      });
      expect(packageNames).toContain(name);
    },
  );
});

describe("timeoutMinutesFor", () => {
  it("grows with the slice's size", () => {
    expect(timeoutMinutesFor(5000, COLD_SECONDS_PER_LINE)).toBeGreaterThan(
      timeoutMinutesFor(500, COLD_SECONDS_PER_LINE),
    );
  });

  it("covers the whole cold estimate with room to spare", () => {
    const lines = 4000;
    expect(
      timeoutMinutesFor(lines, COLD_SECONDS_PER_LINE) * 60,
    ).toBeGreaterThan(estimateColdSeconds(lines, COLD_SECONDS_PER_LINE) * 2);
  });

  it("never exceeds what GitHub allows a job to run", () => {
    expect(timeoutMinutesFor(10_000_000, COLD_SECONDS_PER_LINE)).toBe(
      GITHUB_JOB_LIMIT_MINUTES,
    );
  });
});

describe("planSlices", () => {
  it("keeps a package that fits the budget as one slice", () => {
    expect(planSlices(files(300, 200), COLD_SECONDS_PER_LINE)).toHaveLength(1);
  });

  it("splits a package whose estimate is over the budget", () => {
    const perFile = Math.floor(
      (sliceBudgetSeconds() - COLD_FIXED_SECONDS) / COLD_SECONDS_PER_LINE / 2,
    );
    expect(
      planSlices(
        files(perFile, perFile, perFile, perFile),
        COLD_SECONDS_PER_LINE,
      ).length,
    ).toBeGreaterThan(1);
  });

  it("assigns every file to exactly one slice", () => {
    const input = files(900, 800, 700, 600, 500, 400, 300, 200, 100);
    const plan = planSlices(input, COLD_SECONDS_PER_LINE);
    expect(
      plan
        .flat()
        .map((file) => file.path)
        .sort(),
    ).toEqual(input.map((file) => file.path).sort());
  });

  it("keeps every slice within the budget", () => {
    const input = files(...Array.from({ length: 40 }, () => 1200));
    for (const slice of planSlices(input, COLD_SECONDS_PER_LINE)) {
      expect(
        estimateColdSeconds(linesOf(slice), COLD_SECONDS_PER_LINE),
      ).toBeLessThanOrEqual(sliceBudgetSeconds());
    }
  });

  it("uses the fewest slices that fit, not one file per slice", () => {
    const perFile = 1000;
    const input = files(...Array.from({ length: 30 }, () => perFile));
    const plan = planSlices(input, COLD_SECONDS_PER_LINE);
    const minimum = Math.ceil(
      (input.length * perFile) /
        ((sliceBudgetSeconds() - COLD_FIXED_SECONDS) / COLD_SECONDS_PER_LINE),
    );
    expect(plan).toHaveLength(minimum);
  });

  it("balances equal files evenly across the slices", () => {
    const plan = planSlices(
      files(...Array.from({ length: 40 }, () => 1200)),
      COLD_SECONDS_PER_LINE,
    );
    const sizes = plan.map(linesOf);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1200);
  });

  it("throws when a single file is over the budget by itself", () => {
    expect(() => planSlices(files(10_000_000), COLD_SECONDS_PER_LINE)).toThrow(
      /src\/file-0\.ts/,
    );
  });

  it("plans a package with no source files as one empty slice", () => {
    expect(planSlices([], COLD_SECONDS_PER_LINE)).toEqual([[]]);
  });
});

const CONFIG_HASH = "0123456789ab";

describe("strykerConfigHash", () => {
  it("is stable for the same package config and shared config text", () => {
    expect(strykerConfigHash("breakThreshold: 100", "shared")).toBe(
      strykerConfigHash("breakThreshold: 100", "shared"),
    );
  });

  it("changes when the package's own config text changes", () => {
    expect(strykerConfigHash("breakThreshold: 100", "shared")).not.toBe(
      strykerConfigHash("breakThreshold: 90", "shared"),
    );
  });

  it("changes when the shared config text changes, even if the package config did not", () => {
    expect(strykerConfigHash("breakThreshold: 100", "shared v1")).not.toBe(
      strykerConfigHash("breakThreshold: 100", "shared v2"),
    );
  });

  it("does not collide across the boundary between the two texts", () => {
    // Without a separator, ("ab", "c") and ("a", "bc") would hash identically.
    expect(strykerConfigHash("ab", "c")).not.toBe(strykerConfigHash("a", "bc"));
  });
});

describe("matchesMutateGlobs", () => {
  it("matches a file against a single positive glob", () => {
    expect(matchesMutateGlobs("src/a.ts", ["src/**/*.ts"])).toBe(true);
    expect(matchesMutateGlobs("src/a.test.ts", ["src/**/*.ts"])).toBe(true);
    expect(matchesMutateGlobs("README.md", ["src/**/*.ts"])).toBe(false);
  });

  it("excludes a file a later negated pattern matches", () => {
    const globs = ["src/**/*.ts", "!src/**/*.test.ts"];
    expect(matchesMutateGlobs("src/a.ts", globs)).toBe(true);
    expect(matchesMutateGlobs("src/a.test.ts", globs)).toBe(false);
  });

  it("re-includes a file a later positive pattern matches again", () => {
    const globs = ["src/**/*.ts", "!src/**/*.css.ts", "src/ui/keep.css.ts"];
    expect(matchesMutateGlobs("src/ui/other.css.ts", globs)).toBe(false);
    expect(matchesMutateGlobs("src/ui/keep.css.ts", globs)).toBe(true);
  });

  it("never includes a path no positive pattern ever matched", () => {
    expect(matchesMutateGlobs("src/a.ts", ["!src/**/*.ts"])).toBe(false);
  });

  it("reproduces the confirmed packages/web bug: an explicit css.ts exclusion applies", () => {
    const webGlobs = [
      "src/**/*.ts",
      "src/**/*.tsx",
      "!src/**/*.test.ts",
      "!src/**/*.test.tsx",
      "!src/**/*.css.ts",
    ];
    expect(matchesMutateGlobs("src/ui/contentBlocks.css.ts", webGlobs)).toBe(
      false,
    );
    expect(matchesMutateGlobs("src/app.tsx", webGlobs)).toBe(true);
  });
});

describe("resolveMutateGlobs", () => {
  it("returns the package's own resolved mutate array", () => {
    expect(resolveMutateGlobs({ mutate: ["src/**/*.ts"] })).toEqual([
      "src/**/*.ts",
    ]);
  });

  it("falls back to the shared default when the config has no mutate field", () => {
    expect(resolveMutateGlobs({})).toEqual([
      "src/**/*.ts",
      "!src/**/*.test.ts",
      "!src/**/*.test.tsx",
      "!src/**/test-support/**",
    ]);
  });

  it("leaves test-support out of the default scope at any depth under src", () => {
    const globs = resolveMutateGlobs({});
    expect(matchesMutateGlobs("src/text/decode.ts", globs)).toBe(true);
    expect(matchesMutateGlobs("src/test-support/fixtures.ts", globs)).toBe(
      false,
    );
    expect(matchesMutateGlobs("src/text/test-support/fixtures.ts", globs)).toBe(
      false,
    );
  });

  it("falls back to the shared default for a malformed mutate value", () => {
    expect(resolveMutateGlobs({ mutate: "src/**/*.ts" })).toEqual([
      "src/**/*.ts",
      "!src/**/*.test.ts",
      "!src/**/*.test.tsx",
      "!src/**/test-support/**",
    ]);
    expect(resolveMutateGlobs({ mutate: [1, 2] })).toEqual([
      "src/**/*.ts",
      "!src/**/*.test.ts",
      "!src/**/*.test.tsx",
      "!src/**/test-support/**",
    ]);
    expect(resolveMutateGlobs(undefined)).toEqual([
      "src/**/*.ts",
      "!src/**/*.test.ts",
      "!src/**/*.test.tsx",
      "!src/**/test-support/**",
    ]);
  });
});

describe("packageMatrixEntries", () => {
  it("emits one entry with an empty mutate list for a package that runs whole", () => {
    expect(packageMatrixEntries(BYTE_CODEC, files(300), CONFIG_HASH)).toEqual([
      {
        package: "byte-codec",
        directory: "packages/byte-codec",
        slice: 1,
        sliceCount: 1,
        mutate: "",
        timeoutMinutes: timeoutMinutesFor(300, COLD_SECONDS_PER_LINE),
        cacheKey: "byte-codec-1of1",
        configHash: CONFIG_HASH,
      },
    ]);
  });

  it("slices and times a package with its own rate by that rate, not the shared one", () => {
    const name = "document-cli";
    const secondsPerLine = coldSecondsPerLineFor(name);
    const input = files(...Array.from({ length: 40 }, () => 500));
    const entries = packageMatrixEntries(
      { name, directory: `packages/${name}` },
      input,
      CONFIG_HASH,
    );
    expect(entries).toHaveLength(planSlices(input, secondsPerLine).length);
    expect(entries.length).toBeGreaterThan(
      planSlices(input, COLD_SECONDS_PER_LINE).length,
    );
    for (const entry of entries) {
      const lines = entry.mutate.split(",").length * 500;
      expect(entry.timeoutMinutes).toBe(
        timeoutMinutesFor(lines, secondsPerLine),
      );
    }
  });

  it("numbers slices from one and lists each slice's own files", () => {
    const input = files(...Array.from({ length: 40 }, () => 1200));
    const entries = packageMatrixEntries(BIG_PACKAGE, input, CONFIG_HASH);
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.map((entry) => entry.slice)).toEqual(
      entries.map((_, index) => index + 1),
    );
    for (const entry of entries) {
      expect(entry.sliceCount).toBe(entries.length);
      expect(entry.cacheKey).toBe(
        `big-package-${String(entry.slice)}of${String(entries.length)}`,
      );
      expect(entry.configHash).toBe(CONFIG_HASH);
      expect(entry.mutate.split(",").length).toBeGreaterThan(0);
    }
    expect(entries.flatMap((entry) => entry.mutate.split(",")).sort()).toEqual(
      input.map((file) => file.path).sort(),
    );
  });

  it.each(["src/a,b.ts", "src/[id].ts", "src/a*.ts", "src/(x).ts"])(
    "refuses %s, which --mutate would read as syntax",
    (path) => {
      expect(() =>
        packageMatrixEntries(BYTE_CODEC, [{ path, lines: 10 }], CONFIG_HASH),
      ).toThrow(/--mutate/);
    },
  );

  it("gives each slice a timeout derived from its own size", () => {
    const entries = packageMatrixEntries(
      BIG_PACKAGE,
      files(...Array.from({ length: 40 }, () => 1200)),
      CONFIG_HASH,
    );
    for (const entry of entries) {
      expect(entry.timeoutMinutes).toBeGreaterThan(0);
      expect(entry.timeoutMinutes).toBeLessThanOrEqual(
        GITHUB_JOB_LIMIT_MINUTES,
      );
    }
  });
});

describe("maxParallelFor", () => {
  const budget = Math.floor(
    ACCOUNT_RUNNER_LIMIT * MUTATION_SHARE_OF_RUNNER_LIMIT,
  );

  it("keeps the mutation budget well under half of the account's runner limit", () => {
    expect(MUTATION_SHARE_OF_RUNNER_LIMIT).toBeLessThan(0.5);
    expect(budget).toBeLessThan(ACCOUNT_RUNNER_LIMIT / 2);
  });

  it("holds every run together inside the budget when the expected pull request runs overlap", () => {
    const total =
      maxParallelFor("schedule") +
      EXPECTED_CONCURRENT_PULL_REQUEST_RUNS * maxParallelFor("pull_request");
    expect(total).toBeLessThanOrEqual(budget);
  });

  it("holds a dispatched run and the expected pull request runs inside the budget", () => {
    const total =
      maxParallelFor("workflow_dispatch") +
      EXPECTED_CONCURRENT_PULL_REQUEST_RUNS * maxParallelFor("pull_request");
    expect(total).toBeLessThanOrEqual(budget);
  });

  it("gives every kind of run at least one job at a time", () => {
    for (const event of [
      "schedule",
      "workflow_dispatch",
      "pull_request",
    ] as const) {
      expect(maxParallelFor(event)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("partitionForEvent", () => {
  const small = {
    package: "small",
    entries: packageMatrixEntries(BYTE_CODEC, files(300), CONFIG_HASH),
  };
  const large = {
    package: "large",
    entries: packageMatrixEntries(
      BIG_PACKAGE,
      files(...Array.from({ length: 40 }, () => 1200)),
      CONFIG_HASH,
    ),
  };

  it("runs a single-slice package on a pull request and defers a multi-slice one", () => {
    expect(partitionForEvent([small, large], "pull_request")).toEqual({
      run: [small],
      deferred: ["large"],
    });
  });

  it.each(["schedule", "workflow_dispatch"] as const)(
    "runs every package on a %s run",
    (event) => {
      expect(partitionForEvent([small, large], event)).toEqual({
        run: [small, large],
        deferred: [],
      });
    },
  );
});

describe("selectRequested", () => {
  const packages = [{ name: "a" }, { name: "b" }, { name: "c" }];

  it("keeps every package when none is named", () => {
    expect(selectRequested(packages, [])).toEqual(packages);
  });

  it("keeps only the named packages", () => {
    expect(selectRequested(packages, ["c", "a"])).toEqual([
      { name: "a" },
      { name: "c" },
    ]);
  });

  it("throws on a name that is not a package, rather than planning nothing", () => {
    expect(() => selectRequested(packages, ["a", "nope"])).toThrow(/nope/);
  });
});
