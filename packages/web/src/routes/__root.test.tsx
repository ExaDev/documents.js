import { describe, expect, it } from "vitest";

import {
  activeColorSchemeOption,
  nextColorSchemeOption,
  optionAt,
} from "./__root";

describe("optionAt", () => {
  it("returns the option at a genuinely in-range index", () => {
    expect(optionAt(0).value).toBe("light");
    expect(optionAt(2).value).toBe("auto");
  });

  it("throws for an out-of-range index rather than silently substituting a fallback", () => {
    expect(() => optionAt(99)).toThrow(
      "Color scheme option index 99 out of range",
    );
    expect(() => optionAt(-1)).toThrow(
      "Color scheme option index -1 out of range",
    );
  });
});

describe("activeColorSchemeOption", () => {
  it("finds the option matching the current value", () => {
    expect(activeColorSchemeOption("dark").value).toBe("dark");
    expect(activeColorSchemeOption("auto").value).toBe("auto");
  });

  it("falls back to the first option (light) for a value that isn't one of the three", () => {
    expect(activeColorSchemeOption("not-a-real-scheme").value).toBe("light");
  });
});

describe("nextColorSchemeOption", () => {
  it("steps to the following option in cycle order", () => {
    expect(nextColorSchemeOption("light").value).toBe("dark");
    expect(nextColorSchemeOption("dark").value).toBe("auto");
  });

  it("wraps from the last option back to the first", () => {
    expect(nextColorSchemeOption("auto").value).toBe("light");
  });

  it("treats an unrecognised current value as if it were the first option, stepping to the second", () => {
    expect(nextColorSchemeOption("not-a-real-scheme").value).toBe("dark");
  });
});
