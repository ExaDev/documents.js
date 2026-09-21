import { describe, expect, it } from "vitest";
import {
  ISSUE_TITLE,
  ISSUE_TYPE_NAME,
  TRACKING_REF,
  failingBody,
  mergedFailingPackages,
  nextAction,
  parseFailingPackages,
  readCoveredPackages,
  readGateFailures,
  readIssueTypes,
  resolveIssueTitle,
  reportOutcome,
  runFailureLines,
  type GhClient,
  type RunOutcome,
  type TrackedIssue,
} from "./report-mutation-outcome";

const RUN = "https://github.com/o/r/actions/runs/1";

function outcome(fields: Partial<RunOutcome> = {}): RunOutcome {
  return {
    planResult: "success",
    sliceResult: "success",
    gateFailures: [],
    coveredPackages: [],
    runUrl: RUN,
    ...fields,
  };
}

interface Call {
  readonly kind: string;
  readonly detail: string;
}

function fakeClient(
  open: TrackedIssue | undefined,
  typeFailure?: string,
): {
  readonly client: GhClient;
  readonly calls: Call[];
} {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      findOpenIssue: (title) => {
        calls.push({ kind: "find", detail: title });
        return open;
      },
      createIssue: (title, body) => {
        calls.push({ kind: "create", detail: `${title}\n${body}` });
        return { number: 42, body };
      },
      setIssueType: (issue, typeName) => {
        calls.push({
          kind: "type",
          detail: `${String(issue.number)} ${typeName}`,
        });
        return typeFailure;
      },
      updateIssue: (issue, body) => {
        calls.push({
          kind: "update",
          detail: `${String(issue.number)}\n${body}`,
        });
      },
      comment: (issue, body) => {
        calls.push({
          kind: "comment",
          detail: `${String(issue.number)}\n${body}`,
        });
      },
      closeIssue: (issue) => {
        calls.push({ kind: "close", detail: String(issue.number) });
      },
    },
  };
}

describe("runFailureLines", () => {
  it("is empty for a run whose plan and slices both passed", () => {
    expect(runFailureLines(outcome())).toEqual([]);
  });

  it("does not count skipped slice jobs, which a run with nothing to mutate produces", () => {
    expect(runFailureLines(outcome({ sliceResult: "skipped" }))).toEqual([]);
  });

  it("names a plan that did not succeed", () => {
    expect(runFailureLines(outcome({ planResult: "failure" }))).toEqual([
      "The plan job ended as failure.",
    ]);
  });

  it("names failed or cancelled slice jobs", () => {
    expect(runFailureLines(outcome({ sliceResult: "failure" }))).toHaveLength(
      1,
    );
    expect(runFailureLines(outcome({ sliceResult: "cancelled" }))).toHaveLength(
      1,
    );
  });

  it("says nothing about packages, only the run itself", () => {
    expect(
      runFailureLines(
        outcome({ gateFailures: [{ package: "a", reason: "broken" }] }),
      ),
    ).toEqual([]);
  });
});

describe("parseFailingPackages", () => {
  it("is empty for a body with no package bullets", () => {
    expect(parseFailingPackages(failingBody([], [], RUN)).size).toBe(0);
  });

  it("recovers a package's name and its full rendered reason", () => {
    const body = failingBody(
      [],
      ["a: score 80.00 is under the recorded threshold of 90"],
      RUN,
    );
    expect(parseFailingPackages(body)).toEqual(
      new Map([["a", "score 80.00 is under the recorded threshold of 90"]]),
    );
  });

  it("recovers several packages from the same body", () => {
    const body = failingBody([], ["a: broken a", "b: broken b"], RUN);
    expect(parseFailingPackages(body)).toEqual(
      new Map([
        ["a", "broken a"],
        ["b", "broken b"],
      ]),
    );
  });

  it("does not read a run-level failure sentence as a package", () => {
    const body = failingBody(
      ["The plan job ended as failure."],
      ["a: broken"],
      RUN,
    );
    expect(parseFailingPackages(body)).toEqual(new Map([["a", "broken"]]));
  });

  it("round-trips through failingBody for every run-level sentence runFailureLines can emit", () => {
    const body = failingBody(
      ["The plan job ended as failure.", "The slice jobs ended as cancelled."],
      ["a: broken"],
      RUN,
    );
    expect(parseFailingPackages(body)).toEqual(new Map([["a", "broken"]]));
  });
});

describe("mergedFailingPackages", () => {
  it("keeps a previously failing package this run did not cover", () => {
    const merged = mergedFailingPackages(
      new Map([["a", "was broken"]]),
      outcome({ coveredPackages: [] }),
    );
    expect(merged).toEqual([{ package: "a", reason: "was broken" }]);
  });

  it("drops a previously failing package this run covered and passed", () => {
    const merged = mergedFailingPackages(
      new Map([["a", "was broken"]]),
      outcome({ coveredPackages: ["a"], gateFailures: [] }),
    );
    expect(merged).toEqual([]);
  });

  it("keeps a previously failing package this run covered and still fails, with a fresh reason", () => {
    const merged = mergedFailingPackages(
      new Map([["a", "was broken"]]),
      outcome({
        coveredPackages: ["a"],
        gateFailures: [{ package: "a", reason: "still broken" }],
      }),
    );
    expect(merged).toEqual([{ package: "a", reason: "still broken" }]);
  });

  it("adds a package this run newly fails that was not previously listed", () => {
    const merged = mergedFailingPackages(
      new Map(),
      outcome({
        coveredPackages: ["a"],
        gateFailures: [{ package: "a", reason: undefined }],
      }),
    );
    expect(merged).toEqual([
      { package: "a", reason: "failed the merged gate" },
    ]);
  });

  it("does not let one covered, now-passing package hide an unrelated uncovered one", () => {
    const merged = mergedFailingPackages(
      new Map([["web", "score 92.43 is under the recorded threshold of 100"]]),
      outcome({ coveredPackages: ["excel-number-format"], gateFailures: [] }),
    );
    expect(merged).toEqual([
      {
        package: "web",
        reason: "score 92.43 is under the recorded threshold of 100",
      },
    ]);
  });
});

describe("nextAction", () => {
  const open: TrackedIssue = { number: 7, body: "" };

  it.each([
    [undefined, true, "open"],
    [open, true, "update"],
    [open, false, "close"],
    [undefined, false, "none"],
  ] as const)(
    "with issue %j and failing %s does %s",
    (issue, failing, action) => {
      expect(nextAction(issue, failing)).toBe(action);
    },
  );
});

describe("failingBody", () => {
  it("lists the run and package lines and links the run", () => {
    const body = failingBody(["run broke"], ["a: broken"], RUN);
    expect(body).toContain(RUN);
    expect(body).toContain("- run broke");
    expect(body).toContain("- a: broken");
  });

  it("stays bounded by the number of failing packages, not by anything per file", () => {
    const body = failingBody(
      [],
      Array.from({ length: 30 }, (_, index) => `p${String(index)}: broken`),
      RUN,
    );
    expect(body.split("\n").length).toBeLessThan(40);
  });
});

describe("reportOutcome", () => {
  it("opens the issue for a failing run when none is open", () => {
    const { client, calls } = fakeClient(undefined);
    const action = reportOutcome(
      client,
      outcome({ planResult: "failure" }),
      ISSUE_TITLE,
    );
    expect(action).toBe("open");
    expect(calls.map((call) => call.kind)).toEqual(["find", "create", "type"]);
    expect(calls[2]?.detail).toBe(`42 ${ISSUE_TYPE_NAME}`);
    expect(calls[1]?.detail.startsWith(ISSUE_TITLE)).toBe(true);
  });

  it("updates the one open issue instead of opening a second", () => {
    const { client, calls } = fakeClient({ number: 9, body: "" });
    const action = reportOutcome(
      client,
      outcome({ sliceResult: "failure" }),
      ISSUE_TITLE,
    );
    expect(action).toBe("update");
    expect(calls.map((call) => call.kind)).toEqual([
      "find",
      "update",
      "comment",
    ]);
    expect(calls.some((call) => call.kind === "create")).toBe(false);
  });

  it("closes the open issue with a comment when the run passes and covered everything it listed", () => {
    const priorBody = failingBody([], ["a: broken"], RUN);
    const { client, calls } = fakeClient({ number: 9, body: priorBody });
    const action = reportOutcome(
      client,
      outcome({ coveredPackages: ["a"], gateFailures: [] }),
      ISSUE_TITLE,
    );
    expect(action).toBe("close");
    expect(calls.map((call) => call.kind)).toEqual([
      "find",
      "comment",
      "close",
    ]);
  });

  it("does nothing for a passing run with no open issue", () => {
    const { client, calls } = fakeClient(undefined);
    expect(reportOutcome(client, outcome(), ISSUE_TITLE)).toBe("none");
    expect(calls.map((call) => call.kind)).toEqual(["find"]);
  });

  it("does not close an open issue when a run covering an unrelated package passes", () => {
    // The regression this whole merge exists to fix: a dispatched run scoped to one package must never be read as clearing a different package's own real failure.
    const priorBody = failingBody(
      [],
      ["web: score 92.43 is under the recorded threshold of 100"],
      RUN,
    );
    const { client, calls } = fakeClient({ number: 9, body: priorBody });
    const action = reportOutcome(
      client,
      outcome({ coveredPackages: ["excel-number-format"], gateFailures: [] }),
      ISSUE_TITLE,
    );
    expect(action).toBe("update");
    expect(calls.map((call) => call.kind)).toEqual([
      "find",
      "update",
      "comment",
    ]);
    expect(calls[1]?.detail).toContain("web: score 92.43");
  });

  it("narrows the issue to what is still failing when a run clears some but not all of it", () => {
    const priorBody = failingBody([], ["a: broken a", "b: broken b"], RUN);
    const { client, calls } = fakeClient({ number: 9, body: priorBody });
    const action = reportOutcome(
      client,
      outcome({
        coveredPackages: ["a", "b"],
        gateFailures: [{ package: "b", reason: "broken b" }],
      }),
      ISSUE_TITLE,
    );
    expect(action).toBe("update");
    const updateBody = calls.find((call) => call.kind === "update")?.detail;
    expect(updateBody).toContain("b: broken b");
    expect(updateBody).not.toContain("a: broken a");
  });
});

describe("readGateFailures", () => {
  it("is empty when the gate wrote no result", () => {
    expect(readGateFailures(undefined)).toEqual([]);
  });

  it("reads each failing package and reason", () => {
    expect(
      readGateFailures(
        JSON.stringify({
          failing: [{ package: "a", reason: "why" }, { package: "b" }],
        }),
      ),
    ).toEqual([
      { package: "a", reason: "why" },
      { package: "b", reason: undefined },
    ]);
  });

  it("rejects a result with no failing list", () => {
    expect(() => readGateFailures("{}")).toThrow(/failing/);
  });

  it("rejects a malformed entry", () => {
    expect(() => readGateFailures(JSON.stringify({ failing: [1] }))).toThrow(
      /malformed/,
    );
  });
});

describe("readCoveredPackages", () => {
  it("is empty when the gate wrote no result", () => {
    expect(readCoveredPackages(undefined)).toEqual([]);
  });

  it("reads the covered package list", () => {
    expect(
      readCoveredPackages(JSON.stringify({ covered: ["a", "b"], failing: [] })),
    ).toEqual(["a", "b"]);
  });

  it("rejects a result with no covered list", () => {
    expect(() => readCoveredPackages(JSON.stringify({ failing: [] }))).toThrow(
      /covered/,
    );
  });

  it("rejects a covered list with a non-string entry", () => {
    expect(() =>
      readCoveredPackages(JSON.stringify({ covered: [1], failing: [] })),
    ).toThrow(/non-string/);
  });
});

describe("reportOutcome issue types", () => {
  it("still opens the issue when the type cannot be set, leaving it untyped", () => {
    const { client, calls } = fakeClient(
      undefined,
      "the token may not set types",
    );
    expect(
      reportOutcome(client, outcome({ planResult: "failure" }), ISSUE_TITLE),
    ).toBe("open");
    expect(calls.map((call) => call.kind)).toEqual(["find", "create", "type"]);
  });

  it("manages the title it is given, not a fixed one", () => {
    const { client, calls } = fakeClient(undefined);
    reportOutcome(client, outcome({ planResult: "failure" }), "test title");
    expect(calls[0]?.detail).toBe("test title");
    expect(calls[1]?.detail.startsWith("test title")).toBe(true);
  });
});

describe("resolveIssueTitle", () => {
  it("manages the real issue for a run on main", () => {
    expect(resolveIssueTitle(TRACKING_REF, "")).toBe(ISSUE_TITLE);
  });

  it("manages nothing for a run on another ref with no test title", () => {
    expect(resolveIssueTitle("refs/heads/proof", "")).toBeUndefined();
    expect(resolveIssueTitle("refs/pull/9/merge", "")).toBeUndefined();
  });

  it("manages the test title a run outside main supplies", () => {
    expect(resolveIssueTitle("refs/heads/proof", "test [proof]")).toBe(
      "test [proof]",
    );
  });

  it("never lets a run outside main target the real title", () => {
    expect(() => resolveIssueTitle("refs/heads/proof", ISSUE_TITLE)).toThrow(
      /real tracking issue title/,
    );
    expect(() =>
      resolveIssueTitle("refs/heads/main-copy", ISSUE_TITLE),
    ).toThrow();
  });
});

describe("readIssueTypes", () => {
  it("maps each type's name to its id", () => {
    const response = {
      data: {
        organization: {
          issueTypes: {
            nodes: [
              { id: "T_1", name: "Bug" },
              { id: "T_2", name: "Task" },
            ],
          },
        },
      },
    };
    expect(readIssueTypes(response).get("Bug")).toBe("T_1");
    expect(readIssueTypes(response).get("Task")).toBe("T_2");
  });

  it("throws when the response has no nodes", () => {
    expect(() => readIssueTypes({ data: {} })).toThrow(/nodes/);
  });
});
