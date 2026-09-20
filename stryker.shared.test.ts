import { afterEach, describe, expect, it, vi } from "vitest";
import { packageStrykerConfig } from "./stryker.shared";

describe("packageStrykerConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("gates the package on its own break threshold in a plain local run", () => {
    vi.stubEnv("MUTATION_DEFER_BREAK", undefined);
    expect(packageStrykerConfig({ breakThreshold: 80 }).thresholds?.break).toBe(
      80,
    );
  });

  it("leaves the break threshold out when the workflow defers it to the merged gate", () => {
    vi.stubEnv("MUTATION_DEFER_BREAK", "true");
    expect(
      packageStrykerConfig({ breakThreshold: 80 }).thresholds,
    ).not.toHaveProperty("break");
  });

  it("keeps the high and low colour thresholds whichever way the break is decided", () => {
    vi.stubEnv("MUTATION_DEFER_BREAK", "true");
    expect(packageStrykerConfig({ breakThreshold: 80 }).thresholds).toEqual({
      high: 80,
      low: 60,
    });
  });

  it("records no break for a package that passes none, deferred or not", () => {
    vi.stubEnv("MUTATION_DEFER_BREAK", undefined);
    expect(packageStrykerConfig().thresholds).not.toHaveProperty("break");
  });

  it("writes the json report the merged gate reads", () => {
    expect(packageStrykerConfig().reporters).toContain("json");
  });
});
