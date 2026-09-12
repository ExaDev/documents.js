import { describe, expect, it, vi } from "vitest";

import { createMockRpcClient } from "../../test/mockRpcClient";

vi.mock("../../rpc/client", () => ({ getRpcClient: vi.fn() }));

import { getRpcClient } from "../../rpc/client";
import { convertViaWorker } from "./workerDocumentConverter";

describe("convertViaWorker", () => {
  it("calls the RPC client's convert with only the source, targetFormat, and bytes fields", async () => {
    const client = createMockRpcClient();
    const output = {
      document: { format: "pdf" as const, bytes: new Uint8Array([9]) },
      diagnostics: [],
      content: undefined,
    };
    vi.mocked(client.convert).mockResolvedValue(output);
    vi.mocked(getRpcClient).mockReturnValue(client);

    const controller = new AbortController();
    const result = await convertViaWorker({
      source: "docx",
      targetFormat: "pdf",
      bytes: new Uint8Array([1, 2]),
      signal: controller.signal,
    });

    expect(client.convert).toHaveBeenCalledWith(
      { source: "docx", targetFormat: "pdf", bytes: new Uint8Array([1, 2]) },
      { signal: controller.signal },
    );
    expect(result).toEqual(output);
  });

  it("passes an undefined signal through unchanged when the caller supplies none", async () => {
    const client = createMockRpcClient();
    vi.mocked(client.convert).mockResolvedValue({
      document: { format: "pdf" as const, bytes: new Uint8Array() },
      diagnostics: [],
      content: undefined,
    });
    vi.mocked(getRpcClient).mockReturnValue(client);

    await convertViaWorker({
      source: "docx",
      targetFormat: "pdf",
      bytes: new Uint8Array([1]),
    });

    expect(client.convert).toHaveBeenCalledWith(expect.anything(), {
      signal: undefined,
    });
  });
});
