import { afterEach, describe, expect, it, vi } from "vitest";

// This is a real Web Worker entry point (constructed via `new Worker(...)` in src/rpc/client.ts), so its whole body runs unconditionally at import — vi.resetModules() plus a fresh dynamic import in each test forces that top-level code to genuinely re-run per test, which is what lets Stryker attribute coverage of it to a specific test rather than only to whichever import happened first.
interface CapturedHandlerOptions {
  experimental_transfer: (message: unknown) => Transferable[] | null;
}
let capturedOptions: CapturedHandlerOptions | undefined;
let capturedUpgradeTarget: unknown;
let capturedUpgradeOptions: { context: () => unknown } | undefined;

class FakeRPCHandler {
  constructor(
    public router: unknown,
    options: CapturedHandlerOptions,
  ) {
    capturedOptions = options;
  }

  upgrade(target: unknown, options: { context: () => unknown }): void {
    capturedUpgradeTarget = target;
    capturedUpgradeOptions = options;
  }
}
vi.mock("@orpc/server/message-port", () => ({ RPCHandler: FakeRPCHandler }));

const fakeRouter = { isFakeRouter: true };
vi.mock("../rpc/router", () => ({ router: fakeRouter }));

vi.mock("../shared/transferables", () => ({
  collectTransferableBuffers: vi.fn(),
}));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  capturedOptions = undefined;
  capturedUpgradeTarget = undefined;
  capturedUpgradeOptions = undefined;
});

// A statically-written `import("./documents.worker")` pulls the real module into TypeScript's type-checking program for every tsconfig that reaches this test file — including tsconfig.node.json, whose own lib set has no WebWorker (its test files run under jsdom, not a real worker), so it type-checks this file's `self.postMessage` call against DOM's Window overload instead and fails. tsconfig.worker.json already exists specifically to check documents.worker.ts correctly; this test only needs the module's side effect (constructing the handler), never its exported type, so a non-literal specifier is enough to keep TypeScript from resolving the target module's types at all while Vite still loads the real file at runtime exactly as a literal specifier would.
const workerModulePath = "./documents.worker";
async function importWorkerModule(): Promise<void> {
  await import(/* @vite-ignore */ workerModulePath);
}

describe("documents.worker entry point", () => {
  it("constructs the RPCHandler with the real router and upgrades self with a context factory resolving to an empty object", async () => {
    await importWorkerModule();
    expect(capturedUpgradeTarget).toBe(self);
    expect(capturedUpgradeOptions?.context()).toEqual({});
  });

  it("returns the collected transferable buffers from experimental_transfer when any are found", async () => {
    const { collectTransferableBuffers } =
      await import("../shared/transferables");
    const buffer = new ArrayBuffer(1);
    vi.mocked(collectTransferableBuffers).mockReturnValue([buffer]);

    await importWorkerModule();
    const message = { some: "message" };
    const result = capturedOptions?.experimental_transfer(message);

    expect(collectTransferableBuffers).toHaveBeenCalledWith(message);
    expect(result).toEqual([buffer]);
  });

  it("returns null from experimental_transfer when no transferable buffers are found", async () => {
    const { collectTransferableBuffers } =
      await import("../shared/transferables");
    vi.mocked(collectTransferableBuffers).mockReturnValue([]);

    await importWorkerModule();
    const result = capturedOptions?.experimental_transfer({});

    expect(result).toBeNull();
  });
});
