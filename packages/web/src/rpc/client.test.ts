import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom implements no Worker at all -- getRpcClient() is untestable without stubbing one, plus the two @orpc entry points it wires the worker's MessagePort through.
interface CapturedWorker {
  url: URL;
  options: WorkerOptions | undefined;
}
const workerInstances: CapturedWorker[] = [];
// A plain constructor function, not a class -- the only thing under test is that `new Worker(url, options)` was called with the right arguments and that the resulting instance is threaded through to RPCLink's own `port` option, neither of which needs a class body beyond the constructor a class-with-only-a-constructor would just be a longer way to write.
function FakeWorker(this: object, url: URL, options?: WorkerOptions): void {
  workerInstances.push({ url, options });
}
vi.stubGlobal("Worker", FakeWorker);

interface CapturedLinkOptions {
  port: unknown;
  experimental_transfer: (message: unknown) => Transferable[] | null;
}
let capturedLinkOptions: CapturedLinkOptions | undefined;
class FakeRPCLink {
  isFakeRPCLink = true;
  constructor(options: CapturedLinkOptions) {
    capturedLinkOptions = options;
  }
}
vi.mock("@orpc/client/message-port", () => ({ RPCLink: FakeRPCLink }));

const fakeClient = { isFakeClient: true };
const createORPCClient = vi.fn().mockReturnValue(fakeClient);
vi.mock("@orpc/client", () => ({ createORPCClient }));

vi.mock("../shared/transferables", () => ({
  cloneAndCollectTransferableBuffers: vi.fn(),
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  workerInstances.length = 0;
  capturedLinkOptions = undefined;
});

describe("getRpcClient", () => {
  it("constructs a module-type Worker pointed at the documents worker entry point", async () => {
    const { getRpcClient } = await import("./client");
    getRpcClient();
    expect(workerInstances).toHaveLength(1);
    expect(workerInstances[0]?.url.pathname).toContain("documents.worker");
    expect(workerInstances[0]?.options).toEqual({ type: "module" });
  });

  it("wires the RPCLink's port to the constructed Worker and returns the created ORPC client", async () => {
    const { getRpcClient } = await import("./client");
    const client = getRpcClient();
    expect(client).toBe(fakeClient);
    expect(capturedLinkOptions?.port).toBeInstanceOf(FakeWorker);
    expect(createORPCClient).toHaveBeenCalledWith(
      expect.any(FakeRPCLink) as unknown,
    );
  });

  it("caches the client across calls, constructing the Worker only once", async () => {
    const { getRpcClient } = await import("./client");
    const first = getRpcClient();
    const second = getRpcClient();
    expect(second).toBe(first);
    expect(workerInstances).toHaveLength(1);
    expect(createORPCClient).toHaveBeenCalledTimes(1);
  });

  it("returns the collected transferable buffers from experimental_transfer when any are found", async () => {
    const { cloneAndCollectTransferableBuffers } =
      await import("../shared/transferables");
    const buffer = new ArrayBuffer(1);
    vi.mocked(cloneAndCollectTransferableBuffers).mockReturnValue([buffer]);

    const { getRpcClient } = await import("./client");
    getRpcClient();
    const message = { some: "message" };
    const result = capturedLinkOptions?.experimental_transfer(message);

    expect(cloneAndCollectTransferableBuffers).toHaveBeenCalledWith(message);
    expect(result).toEqual([buffer]);
  });

  it("returns null from experimental_transfer when no transferable buffers are found", async () => {
    const { cloneAndCollectTransferableBuffers } =
      await import("../shared/transferables");
    vi.mocked(cloneAndCollectTransferableBuffers).mockReturnValue([]);

    const { getRpcClient } = await import("./client");
    getRpcClient();
    const result = capturedLinkOptions?.experimental_transfer({});

    expect(result).toBeNull();
  });
});
