import { describe, expect, it, vi } from "vitest";

const mountApp = vi.fn();
vi.mock("./mountApp", () => ({ mountApp }));

describe("main entry point", () => {
  it("mounts the app against the real document", async () => {
    await import("./main");
    expect(mountApp).toHaveBeenCalledWith(document);
  });
});
