// Keeps one tracking issue in step with the outcome of a scheduled or dispatched mutation run, so a red run cannot go unnoticed. When the run failed, the issue is opened if there is none and otherwise updated in place with the failing packages and the run that found them; it is never opened twice. When a later run passes and the issue is open, the issue gets a comment naming that run and is closed.
//
// The decision and the wording are pure functions; the `gh` calls sit behind the small GhClient interface, so the whole flow is tested against a fake and only the thin wrapper at the bottom touches the network.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The title the tracking issue is found by, so it must not change without the open issue being renamed with it. */
export const ISSUE_TITLE = "Mutation testing is failing on main";

/** The login `gh` reports for issues the workflow's own token opens. */
export const WORKFLOW_ACTOR = "app/github-actions";

export interface TrackedIssue {
  readonly number: number;
}

export interface GhClient {
  findOpenIssue: (title: string) => TrackedIssue | undefined;
  createIssue: (title: string, body: string) => void;
  updateIssue: (issue: TrackedIssue, body: string) => void;
  comment: (issue: TrackedIssue, body: string) => void;
  closeIssue: (issue: TrackedIssue) => void;
}

export interface RunOutcome {
  /** The result of the plan job: success, failure, cancelled or skipped. */
  readonly planResult: string;
  /** The result of the slice matrix job. */
  readonly sliceResult: string;
  /** The packages the merged gate failed, with the reason each was failed. */
  readonly gateFailures: readonly {
    readonly package: string;
    readonly reason: string | undefined;
  }[];
  readonly runUrl: string;
}

export type Action = "open" | "update" | "close" | "none";

/** The lines that say why the run is failing, empty when it is passing. A skipped slice job is not a failure, since a run with nothing to mutate skips it. */
export function failureLines(outcome: RunOutcome): readonly string[] {
  const lines: string[] = [];
  if (outcome.planResult !== "success") {
    lines.push(`The plan job ended as ${outcome.planResult}.`);
  }
  if (
    outcome.sliceResult === "failure" ||
    outcome.sliceResult === "cancelled"
  ) {
    lines.push(`The slice jobs ended as ${outcome.sliceResult}.`);
  }
  for (const failure of outcome.gateFailures) {
    lines.push(
      `${failure.package}: ${failure.reason ?? "failed the merged gate"}`,
    );
  }
  return lines;
}

/** What to do with the tracking issue given whether one is open and whether the run is failing. */
export function nextAction(
  existing: TrackedIssue | undefined,
  failing: boolean,
): Action {
  if (failing) return existing === undefined ? "open" : "update";
  return existing === undefined ? "none" : "close";
}

/** The issue body for a failing run: what failed and the run that found it, and nothing per file, so it stays small however large the workspace grows. */
export function failingBody(lines: readonly string[], runUrl: string): string {
  return [
    `The latest scheduled or dispatched mutation run failed: ${runUrl}`,
    "",
    ...lines.map((line) => `- ${line}`),
    "",
    "This issue is kept up to date by the workflow. It closes itself when a later run passes.",
  ].join("\n");
}

/** The comment left when a passing run closes the issue. */
export function recoveredComment(runUrl: string): string {
  return `The latest scheduled or dispatched mutation run passed: ${runUrl}`;
}

/** Applies the decision through the client and returns what it did. */
export function reportOutcome(
  client: Readonly<GhClient>,
  outcome: RunOutcome,
): Action {
  const lines = failureLines(outcome);
  const existing = client.findOpenIssue(ISSUE_TITLE);
  const action = nextAction(existing, lines.length > 0);
  const body = failingBody(lines, outcome.runUrl);
  switch (action) {
    case "open":
      client.createIssue(ISSUE_TITLE, body);
      break;
    case "update":
      if (existing === undefined) throw new Error("no issue to update");
      client.updateIssue(existing, body);
      client.comment(existing, `Failing again: ${outcome.runUrl}`);
      break;
    case "close":
      if (existing === undefined) throw new Error("no issue to close");
      client.comment(existing, recoveredComment(outcome.runUrl));
      client.closeIssue(existing);
      break;
    case "none":
      break;
  }
  return action;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The gate's result file: the failing packages and why, or an empty list when the gate did not run. */
export function readGateFailures(
  text: string | undefined,
): RunOutcome["gateFailures"] {
  if (text === undefined) return [];
  const parsed: unknown = JSON.parse(text);
  const failing = isRecord(parsed) ? parsed.failing : undefined;
  if (!Array.isArray(failing)) {
    throw new Error("the gate result has no failing list");
  }
  return failing.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.package !== "string") {
      throw new Error("the gate result has a malformed failing entry");
    }
    return {
      package: entry.package,
      reason: typeof entry.reason === "string" ? entry.reason : undefined,
    };
  });
}

function ghClient(repository: string): GhClient {
  const gh = (args: readonly string[]): string =>
    execFileSync("gh", [...args, "--repo", repository], { encoding: "utf8" });
  const withBody = (body: string, run: (file: string) => void): void => {
    const file = join(tmpdir(), `mutation-issue-${String(process.pid)}.md`);
    writeFileSync(file, body);
    run(file);
  };
  return {
    findOpenIssue(title) {
      const listed: unknown = JSON.parse(
        gh([
          "issue",
          "list",
          "--state",
          "open",
          "--search",
          `in:title "${title}"`,
          "--json",
          "number,title,author",
          "--limit",
          "20",
        ]),
      );
      if (!Array.isArray(listed)) throw new Error("gh issue list gave no list");
      for (const entry of listed) {
        if (
          isRecord(entry) &&
          entry.title === title &&
          isRecord(entry.author) &&
          entry.author.login === WORKFLOW_ACTOR &&
          typeof entry.number === "number"
        ) {
          return { number: entry.number };
        }
      }
      return undefined;
    },
    createIssue(title, body) {
      withBody(body, (file) => {
        gh(["issue", "create", "--title", title, "--body-file", file]);
      });
    },
    updateIssue(issue, body) {
      withBody(body, (file) => {
        gh(["issue", "edit", String(issue.number), "--body-file", file]);
      });
    },
    comment(issue, body) {
      withBody(body, (file) => {
        gh(["issue", "comment", String(issue.number), "--body-file", file]);
      });
    },
    closeIssue(issue) {
      gh(["issue", "close", String(issue.number)]);
    },
  };
}

function main(): void {
  const [gateResultFile, runUrl] = process.argv.slice(2);
  const repository = process.env.GITHUB_REPOSITORY;
  if (gateResultFile === undefined || runUrl === undefined || !repository) {
    throw new Error(
      "usage: report-mutation-outcome.ts <gate-result-file> <run-url> with GITHUB_REPOSITORY set",
    );
  }
  const planResult = process.env.PLAN_RESULT;
  const sliceResult = process.env.SLICE_RESULT;
  if (!planResult || !sliceResult) {
    throw new Error("PLAN_RESULT and SLICE_RESULT must be set");
  }
  // The gate writes its result file only when it ran, so its absence means the plan or the slices already failed the run.
  const gateText = existsSync(gateResultFile)
    ? readFileSync(gateResultFile, "utf8")
    : undefined;
  const action = reportOutcome(ghClient(repository), {
    planResult,
    sliceResult,
    gateFailures: readGateFailures(gateText),
    runUrl,
  });
  console.log(`Tracking issue action: ${action}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
