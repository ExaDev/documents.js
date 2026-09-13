import { McpServer } from "@modelcontextprotocol/server";
import { odbRenderReportOperation } from "document-operations";
import { OdbReportNotSpecifiedError } from "documents.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as registerOperationModule from "../register-operation";
import {
  odbReportNotSpecifiedResult,
  registerOdbRenderReportTools,
} from "./odb-render-report";

vi.mock("../register-operation", () => ({ registerOperation: vi.fn() }));

type MapError = (error: unknown) => unknown;

function capturedMapError(): MapError {
  const call = vi.mocked(registerOperationModule.registerOperation).mock
    .calls[0] as [unknown, unknown, { mapError: MapError }];
  return call[2].mapError;
}

// registerOdbRenderReportTools's own mapError wiring is otherwise unreachable through a real client/server round trip: the one real .odb fixture this repo checks in declares exactly one report, so OdbReportNotSpecifiedError is never actually thrown by odb-render-report.test.ts's own end-to-end tests (see that file's own comment on odbReportNotSpecifiedResult). Spying on registerOperation here proves the wiring directly instead: that a mapError is passed at all, that it delegates to odbReportNotSpecifiedResult for the one error it special-cases, and that it declines (returns undefined) for every other error, falling through to registerOperation's own default handling.
describe("registerOdbRenderReportTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes registerOperation the real operation alongside a mapError option", () => {
    const server = new McpServer({ name: "wiring-test", version: "0.0.0" });
    registerOdbRenderReportTools(server);

    expect(registerOperationModule.registerOperation).toHaveBeenCalledTimes(1);
    const [passedServer, passedOperation] = vi.mocked(
      registerOperationModule.registerOperation,
    ).mock.calls[0] as [unknown, unknown, unknown];
    expect(passedServer).toBe(server);
    expect(passedOperation).toBe(odbRenderReportOperation);
    expect(typeof capturedMapError()).toBe("function");
  });

  it("delegates to odbReportNotSpecifiedResult for an OdbReportNotSpecifiedError", () => {
    registerOdbRenderReportTools(
      new McpServer({ name: "wiring-test", version: "0.0.0" }),
    );
    const mapError = capturedMapError();

    const error = new OdbReportNotSpecifiedError(["OnlyReport"]);
    expect(mapError(error)).toEqual(odbReportNotSpecifiedResult(error));
  });

  it("declines to handle any other error, falling through to registerOperation's own default", () => {
    registerOdbRenderReportTools(
      new McpServer({ name: "wiring-test", version: "0.0.0" }),
    );
    const mapError = capturedMapError();

    expect(mapError(new Error("some other failure"))).toBeUndefined();
  });
});
