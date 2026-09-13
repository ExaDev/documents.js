import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesToBase64, createDocx } from "documents.js";
import type * as DocumentOperationsModule from "document-operations";

// Three things this file needs a patched document-operations registry for, none reachable through the real operations alone: proving the REST layer actually forwards a request-scoped AbortSignal into `run()`'s own context (rather than an empty options object), proving that signal genuinely aborts when the client disconnects, and exercising odb_render_report's OdbReportNotSpecifiedError mapping (the one real .odb fixture this repo checks in declares exactly one report, so that branch is otherwise unreachable through a real file -- see server.test.ts's own comment on the same limitation).
const signalState = vi.hoisted(() => ({
  presenceHasSignal: undefined as boolean | undefined,
  abortOperationStarted: false,
  aborted: false,
}));

vi.mock("document-operations", async (importOriginal) => {
  const actual = await importOriginal<typeof DocumentOperationsModule>();
  const { OdbReportNotSpecifiedError } = await import("documents.js");

  const presenceOperation: (typeof actual.DOCUMENT_OPERATIONS)[number] = {
    name: "test_signal_presence",
    title: "Test signal presence",
    description:
      "Test-only operation reporting whether it received an AbortSignal in its run context.",
    inputSchema: z.object({}),
    run: (_input: unknown, context) => {
      signalState.presenceHasSignal = context?.signal instanceof AbortSignal;
      return Promise.resolve({ hasSignal: signalState.presenceHasSignal });
    },
  };

  const abortOperation: (typeof actual.DOCUMENT_OPERATIONS)[number] = {
    name: "test_signal_abort",
    title: "Test signal abort",
    description:
      "Test-only operation that resolves only once its run context's signal aborts.",
    inputSchema: z.object({}),
    run: (_input: unknown, context) =>
      new Promise((resolve) => {
        context?.signal?.addEventListener("abort", () => {
          signalState.aborted = true;
          resolve({ aborted: true });
        });
        // Set only once the listener above is actually attached, so the test can wait for this before it aborts the client request -- otherwise the client-side abort could race ahead of the server ever registering interest in it.
        signalState.abortOperationStarted = true;
      }),
  };

  const patchedOperations = actual.DOCUMENT_OPERATIONS.map((operation) =>
    operation.name === "odb_render_report"
      ? {
          ...operation,
          run: (): Promise<never> => {
            throw new OdbReportNotSpecifiedError(["Invoice", "Summary"]);
          },
        }
      : operation,
  );

  return {
    ...actual,
    DOCUMENT_OPERATIONS: [
      ...patchedOperations,
      presenceOperation,
      abortOperation,
    ],
  };
});

const { createRestServer } = await import("./server");

interface RunningServer {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

async function start(): Promise<RunningServer> {
  const server = createRestServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(
      "Expected the test server to bind a TCP address, not a pipe or Unix socket",
    );
  }
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

describe("createRestServer, against a patched document-operations registry", () => {
  let running: RunningServer;

  beforeEach(async () => {
    signalState.presenceHasSignal = undefined;
    signalState.abortOperationStarted = false;
    signalState.aborted = false;
    running = await start();
  });

  afterEach(async () => {
    await running.close();
  });

  it("passes a real AbortSignal into the operation's run context", async () => {
    const response = await fetch(running.baseUrl + "/test_signal_presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { hasSignal: boolean } };
    expect(body.result.hasSignal).toBe(true);
  });

  it("aborts the operation's signal when the client disconnects mid-request", async () => {
    const controller = new AbortController();
    const fetchPromise = fetch(running.baseUrl + "/test_signal_abort", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: controller.signal,
    }).catch(() => undefined);

    await vi.waitFor(() => {
      expect(signalState.abortOperationStarted).toBe(true);
    });
    controller.abort();
    await fetchPromise;
    await vi.waitFor(() => {
      expect(signalState.aborted).toBe(true);
    });
  });

  it("maps OdbReportNotSpecifiedError to a 400 naming the available reports", async () => {
    const bytesBase64 = bytesToBase64(createDocx().toBytes());
    const response = await fetch(running.baseUrl + "/odb_render_report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: { bytesBase64, format: "docx" },
        targetFormat: "odt",
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: string;
      availableReports: string[];
    };
    expect(body.availableReports).toEqual(["Invoice", "Summary"]);
    expect(body.error).toMatch(
      /this \.odb declares more than one report \(Invoice, Summary\)/,
    );
  });
});
