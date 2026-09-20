import type { Metrics } from "mutation-testing-metrics";
import type { FileResult } from "mutation-testing-report-schema";
import { describe, expect, it } from "vitest";
import {
  derivedBreakThreshold,
  mergeSliceFiles,
  packageFails,
  recordedBreak,
  renderSummary,
  reportFiles,
  sliceReportFile,
  thresholdBehind,
  type PackageOutcome,
  type PackageVerdict,
} from "./gate-mutation-scores";

const EMPTY_METRICS: Metrics = {
  pending: 0,
  killed: 0,
  timeout: 0,
  survived: 0,
  noCoverage: 0,
  runtimeErrors: 0,
  compileErrors: 0,
  ignored: 0,
  totalDetected: 0,
  totalUndetected: 0,
  totalInvalid: 0,
  totalValid: 0,
  totalCovered: 0,
  totalMutants: 0,
  mutationScore: 0,
  mutationScoreBasedOnCoveredCode: 0,
};

function metrics(
  fields: Readonly<Pick<Metrics, "mutationScore" | "timeout" | "totalValid">>,
): Metrics {
  return { ...EMPTY_METRICS, ...fields };
}

function file(): FileResult {
  return { language: "typescript", source: "", mutants: [] };
}

function scored(
  score: number,
  recorded: number | undefined,
  derived: number,
): PackageVerdict {
  return { kind: "scored", score, recorded, derived, totalValid: 1000 };
}

describe("derivedBreakThreshold", () => {
  it("floors the score and subtracts one point when nothing timed out", () => {
    expect(
      derivedBreakThreshold(
        metrics({ mutationScore: 91.4, timeout: 0, totalValid: 1000 }),
      ),
    ).toBe(90);
  });

  it("subtracts the timeout share of valid mutants rounded up to whole points", () => {
    expect(
      derivedBreakThreshold(
        metrics({ mutationScore: 91.4, timeout: 30, totalValid: 1000 }),
      ),
    ).toBe(88);
  });

  it("never subtracts less than one point, however few mutants timed out", () => {
    expect(
      derivedBreakThreshold(
        metrics({ mutationScore: 91.4, timeout: 1, totalValid: 1000 }),
      ),
    ).toBe(90);
  });

  it("is exactly 100 for a package that has reached it", () => {
    expect(
      derivedBreakThreshold(
        metrics({ mutationScore: 100, timeout: 50, totalValid: 1000 }),
      ),
    ).toBe(100);
  });

  it("does not round a score just under 100 up to it", () => {
    expect(
      derivedBreakThreshold(
        metrics({ mutationScore: 99.92, timeout: 0, totalValid: 1000 }),
      ),
    ).toBe(98);
  });

  it("copes with a package that has no valid mutants", () => {
    expect(
      derivedBreakThreshold(
        metrics({ mutationScore: 0, timeout: 0, totalValid: 0 }),
      ),
    ).toBe(0);
  });
});

describe("mergeSliceFiles", () => {
  it("unions the files of every slice", () => {
    const merged = mergeSliceFiles([
      { "src/a.ts": file() },
      { "src/b.ts": file(), "src/c.ts": file() },
    ]);
    expect(Object.keys(merged).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("refuses a file present in two slices rather than counting it twice", () => {
    expect(() =>
      mergeSliceFiles([{ "src/a.ts": file() }, { "src/a.ts": file() }]),
    ).toThrow(/src\/a\.ts/);
  });
});

describe("reportFiles", () => {
  it("returns the files of a well-formed report", () => {
    expect(
      Object.keys(reportFiles({ files: { "src/a.ts": file() } }, "r.json")),
    ).toEqual(["src/a.ts"]);
  });

  it("rejects a report with no files object, naming its origin", () => {
    expect(() => reportFiles({}, "slice-1/mutation.json")).toThrow(
      /slice-1\/mutation\.json/,
    );
  });

  it("rejects a file entry with no mutants list", () => {
    expect(() =>
      reportFiles({ files: { "src/a.ts": { language: "typescript" } } }, "r"),
    ).toThrow(/src\/a\.ts/);
  });
});

describe("recordedBreak", () => {
  it("reads thresholds.break from a Stryker config", () => {
    expect(
      recordedBreak({ thresholds: { high: 80, low: 60, break: 42 } }),
    ).toBe(42);
  });

  it("is undefined when the config records no break", () => {
    expect(
      recordedBreak({ thresholds: { high: 80, low: 60 } }),
    ).toBeUndefined();
    expect(recordedBreak({})).toBeUndefined();
    expect(recordedBreak(undefined)).toBeUndefined();
  });
});

describe("packageFails", () => {
  it("fails a package whose score is under its recorded threshold", () => {
    expect(packageFails({ package: "p", verdict: scored(88.9, 89, 88) })).toBe(
      true,
    );
  });

  it("passes a package exactly on its threshold", () => {
    expect(packageFails({ package: "p", verdict: scored(89, 89, 88) })).toBe(
      false,
    );
  });

  it("does not gate a package that records no threshold", () => {
    expect(
      packageFails({ package: "p", verdict: scored(10, undefined, 9) }),
    ).toBe(false);
  });

  it("fails a package with a planned slice that produced no report", () => {
    expect(
      packageFails({
        package: "p",
        verdict: { kind: "missing-reports", slices: [2] },
      }),
    ).toBe(true);
  });
});

describe("thresholdBehind", () => {
  it("is true when the rule derives more than the recorded threshold", () => {
    expect(thresholdBehind(scored(91.4, 69, 90))).toBe(true);
  });

  it("is false when the recorded threshold equals the derived one", () => {
    expect(thresholdBehind(scored(100, 100, 100))).toBe(false);
  });

  it("is true for a package that records none yet", () => {
    expect(thresholdBehind(scored(50, undefined, 49))).toBe(true);
  });

  it("is false for a package with missing reports", () => {
    expect(thresholdBehind({ kind: "missing-reports", slices: [1] })).toBe(
      false,
    );
  });
});

describe("renderSummary", () => {
  it("writes one row per package with its result and any threshold drift", () => {
    const outcomes: PackageOutcome[] = [
      { package: "steady", verdict: scored(100, 100, 100) },
      { package: "behind", verdict: scored(91.4, 69, 90) },
      { package: "broken", verdict: scored(60, 70, 59) },
      {
        package: "absent",
        verdict: { kind: "missing-reports", slices: [1, 3] },
      },
    ];
    const summary = renderSummary(outcomes).split("\n");
    expect(summary[0]).toContain("Package");
    expect(
      summary.some((line) => line.includes("steady") && line.includes("pass")),
    ).toBe(true);
    expect(
      summary.some(
        (line) => line.includes("behind") && line.includes("rule derives 90"),
      ),
    ).toBe(true);
    expect(
      summary.some((line) => line.includes("broken") && line.includes("FAIL")),
    ).toBe(true);
    expect(
      summary.some(
        (line) => line.includes("absent") && line.includes("slice 1, 3"),
      ),
    ).toBe(true);
  });
});

describe("sliceReportFile", () => {
  it("names the report after the slice's cache key", () => {
    expect(
      sliceReportFile({
        package: "p",
        directory: "packages/p",
        slice: 1,
        sliceCount: 1,
        mutate: "",
        timeoutMinutes: 30,
        cacheKey: "p-1of1",
      }),
    ).toBe("p-1of1.json");
  });
});
