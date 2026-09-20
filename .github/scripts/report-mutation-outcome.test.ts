import { describe, expect, it } from "vitest";
import {
  ISSUE_TITLE,
  failingBody,
  failureLines,
  nextAction,
  readGateFailures,
  reportOutcome,
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
    runUrl: RUN,
    ...fields,
  };
}

interface Call {
  readonly kind: string;
  readonly detail: string;
}

function fakeClient(open: TrackedIssue | undefined): {
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

describe("failureLines", () => {
  it("is empty for a run whose plan, slices and gate all passed", () => {
    expect(failureLines(outcome())).toEqual([]);
  });

  it("does not count skipped slice jobs, which a run with nothing to mutate produces", () => {
    expect(failureLines(outcome({ sliceResult: "skipped" }))).toEqual([]);
  });

  it("names a plan that did not succeed", () => {
    expect(failureLines(outcome({ planResult: "failure" }))).toEqual([
      "The plan job ended as failure.",
    ]);
  });

  it("names failed or cancelled slice jobs", () => {
    expect(failureLines(outcome({ sliceResult: "failure" }))).toHaveLength(1);
    expect(failureLines(outcome({ sliceResult: "cancelled" }))).toHaveLength(1);
  });

  it("names each package the gate failed, with its reason", () => {
    expect(
      failureLines(
        outcome({
          gateFailures: [
            {
              package: "a",
              reason: "score 80.00 is under the recorded threshold of 90",
            },
            { package: "b", reason: undefined },
          ],
        }),
      ),
    ).toEqual([
      "a: score 80.00 is under the recorded threshold of 90",
      "b: failed the merged gate",
    ]);
  });
});

describe("nextAction", () => {
  const open: TrackedIssue = { number: 7 };

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
  it("lists the failing lines and links the run", () => {
    const body = failingBody(["a: broken"], RUN);
    expect(body).toContain(RUN);
    expect(body).toContain("- a: broken");
  });

  it("stays bounded by the number of failing packages, not by anything per file", () => {
    const body = failingBody(
      Array.from({ length: 30 }, (_, index) => `p${String(index)}: broken`),
      RUN,
    );
    expect(body.split("\n").length).toBeLessThan(40);
  });
});

describe("reportOutcome", () => {
  it("opens the issue for a failing run when none is open", () => {
    const { client, calls } = fakeClient(undefined);
    const action = reportOutcome(client, outcome({ planResult: "failure" }));
    expect(action).toBe("open");
    expect(calls.map((call) => call.kind)).toEqual(["find", "create"]);
    expect(calls[1]?.detail.startsWith(ISSUE_TITLE)).toBe(true);
  });

  it("updates the one open issue instead of opening a second", () => {
    const { client, calls } = fakeClient({ number: 9 });
    const action = reportOutcome(client, outcome({ sliceResult: "failure" }));
    expect(action).toBe("update");
    expect(calls.map((call) => call.kind)).toEqual([
      "find",
      "update",
      "comment",
    ]);
    expect(calls.some((call) => call.kind === "create")).toBe(false);
  });

  it("closes the open issue with a comment when the run passes", () => {
    const { client, calls } = fakeClient({ number: 9 });
    const action = reportOutcome(client, outcome());
    expect(action).toBe("close");
    expect(calls.map((call) => call.kind)).toEqual([
      "find",
      "comment",
      "close",
    ]);
  });

  it("does nothing for a passing run with no open issue", () => {
    const { client, calls } = fakeClient(undefined);
    expect(reportOutcome(client, outcome())).toBe("none");
    expect(calls.map((call) => call.kind)).toEqual(["find"]);
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
