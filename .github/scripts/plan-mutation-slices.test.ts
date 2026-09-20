import { describe, expect, it } from "vitest";
import {
  COLD_FIXED_SECONDS,
  COLD_SECONDS_PER_LINE,
  ACCOUNT_RUNNER_LIMIT,
  EXPECTED_CONCURRENT_PULL_REQUEST_RUNS,
  GITHUB_JOB_LIMIT_MINUTES,
  MUTATION_SHARE_OF_RUNNER_LIMIT,
  affectedMutationPackages,
  estimateColdSeconds,
  maxParallelFor,
  packageMatrixEntries,
  partitionForEvent,
  selectRequested,
  planSlices,
  sliceBudgetSeconds,
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
    (_name, lines, seconds) => {
      expect(estimateColdSeconds(lines)).toBeGreaterThanOrEqual(seconds);
    },
  );

  it("starts at the fixed cost for an empty package and grows with size", () => {
    expect(estimateColdSeconds(0)).toBe(COLD_FIXED_SECONDS);
    expect(estimateColdSeconds(1000)).toBeGreaterThan(estimateColdSeconds(10));
  });
});

describe("timeoutMinutesFor", () => {
  it("grows with the slice's size", () => {
    expect(timeoutMinutesFor(5000)).toBeGreaterThan(timeoutMinutesFor(500));
  });

  it("covers the whole cold estimate with room to spare", () => {
    const lines = 4000;
    expect(timeoutMinutesFor(lines) * 60).toBeGreaterThan(
      estimateColdSeconds(lines) * 2,
    );
  });

  it("never exceeds what GitHub allows a job to run", () => {
    expect(timeoutMinutesFor(10_000_000)).toBe(GITHUB_JOB_LIMIT_MINUTES);
  });
});

describe("planSlices", () => {
  it("keeps a package that fits the budget as one slice", () => {
    expect(planSlices(files(300, 200))).toHaveLength(1);
  });

  it("splits a package whose estimate is over the budget", () => {
    const perFile = Math.floor(
      (sliceBudgetSeconds() - COLD_FIXED_SECONDS) / COLD_SECONDS_PER_LINE / 2,
    );
    expect(
      planSlices(files(perFile, perFile, perFile, perFile)).length,
    ).toBeGreaterThan(1);
  });

  it("assigns every file to exactly one slice", () => {
    const input = files(900, 800, 700, 600, 500, 400, 300, 200, 100);
    const plan = planSlices(input);
    expect(
      plan
        .flat()
        .map((file) => file.path)
        .sort(),
    ).toEqual(input.map((file) => file.path).sort());
  });

  it("keeps every slice within the budget", () => {
    const input = files(...Array.from({ length: 40 }, () => 1200));
    for (const slice of planSlices(input)) {
      expect(estimateColdSeconds(linesOf(slice))).toBeLessThanOrEqual(
        sliceBudgetSeconds(),
      );
    }
  });

  it("uses the fewest slices that fit, not one file per slice", () => {
    const perFile = 1000;
    const input = files(...Array.from({ length: 30 }, () => perFile));
    const plan = planSlices(input);
    const minimum = Math.ceil(
      (input.length * perFile) /
        ((sliceBudgetSeconds() - COLD_FIXED_SECONDS) / COLD_SECONDS_PER_LINE),
    );
    expect(plan).toHaveLength(minimum);
  });

  it("balances equal files evenly across the slices", () => {
    const plan = planSlices(files(...Array.from({ length: 40 }, () => 1200)));
    const sizes = plan.map(linesOf);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1200);
  });

  it("throws when a single file is over the budget by itself", () => {
    expect(() => planSlices(files(10_000_000))).toThrow(/src\/file-0\.ts/);
  });

  it("plans a package with no source files as one empty slice", () => {
    expect(planSlices([])).toEqual([[]]);
  });
});

describe("packageMatrixEntries", () => {
  it("emits one entry with an empty mutate list for a package that runs whole", () => {
    expect(packageMatrixEntries(BYTE_CODEC, files(300))).toEqual([
      {
        package: "byte-codec",
        directory: "packages/byte-codec",
        slice: 1,
        sliceCount: 1,
        mutate: "",
        timeoutMinutes: timeoutMinutesFor(300),
        cacheKey: "byte-codec-1of1",
      },
    ]);
  });

  it("numbers slices from one and lists each slice's own files", () => {
    const input = files(...Array.from({ length: 40 }, () => 1200));
    const entries = packageMatrixEntries(BIG_PACKAGE, input);
    expect(entries.length).toBeGreaterThan(1);
    expect(entries.map((entry) => entry.slice)).toEqual(
      entries.map((_, index) => index + 1),
    );
    for (const entry of entries) {
      expect(entry.sliceCount).toBe(entries.length);
      expect(entry.cacheKey).toBe(
        `big-package-${String(entry.slice)}of${String(entries.length)}`,
      );
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
        packageMatrixEntries(BYTE_CODEC, [{ path, lines: 10 }]),
      ).toThrow(/--mutate/);
    },
  );

  it("gives each slice a timeout derived from its own size", () => {
    const entries = packageMatrixEntries(
      BIG_PACKAGE,
      files(...Array.from({ length: 40 }, () => 1200)),
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
    entries: packageMatrixEntries(BYTE_CODEC, files(300)),
  };
  const large = {
    package: "large",
    entries: packageMatrixEntries(
      BIG_PACKAGE,
      files(...Array.from({ length: 40 }, () => 1200)),
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
