import { describe, expect, it } from "vitest";
import {
  SI_KILOGRAM,
  SI_METRE,
  SI_METRE_PER_SECOND_SQUARED,
  SI_NEWTON,
  SI_SECOND,
  SI_UNIT_REGISTRY,
} from "./units";

// This fixture registry is consumed indirectly, by unit id, throughout the rest of this package's test suite (evaluate.test.ts, worked-example.test.ts, corpus.test.ts all resolve a qty node's "si:..." unit id against SI_UNIT_REGISTRY.units without ever inspecting a unit's own symbol or display name) -- so a unit's cosmetic fields (symbol, name) and its own object-literal shape have no other test anywhere that would notice one going missing or blank. These tests assert each exported constant's exact literal shape directly, the same way a canonical data table gets tested: not because any of these fields are exercised by a computation, but because the registry's whole point is to BE this exact, stable set of values.
describe("SI unit fixtures", () => {
  it("defines SI_KILOGRAM exactly", () => {
    expect(SI_KILOGRAM).toEqual({
      id: "si:kilogram",
      symbol: "kg",
      name: "kilogram",
      dimension: { mass: 1 },
      factorToSi: { numerator: "1", denominator: "1" },
    });
  });

  it("defines SI_METRE exactly", () => {
    expect(SI_METRE).toEqual({
      id: "si:metre",
      symbol: "m",
      name: "metre",
      dimension: { length: 1 },
      factorToSi: { numerator: "1", denominator: "1" },
    });
  });

  it("defines SI_SECOND exactly", () => {
    expect(SI_SECOND).toEqual({
      id: "si:second",
      symbol: "s",
      name: "second",
      dimension: { time: 1 },
      factorToSi: { numerator: "1", denominator: "1" },
    });
  });

  it("defines SI_METRE_PER_SECOND_SQUARED exactly", () => {
    expect(SI_METRE_PER_SECOND_SQUARED).toEqual({
      id: "si:metre-per-second-squared",
      symbol: "m/s^2",
      name: "metre per second squared",
      dimension: { length: 1, time: -2 },
      factorToSi: { numerator: "1", denominator: "1" },
    });
  });

  it("defines SI_NEWTON exactly", () => {
    expect(SI_NEWTON).toEqual({
      id: "si:newton",
      symbol: "N",
      name: "newton",
      dimension: { mass: 1, length: 1, time: -2 },
      factorToSi: { numerator: "1", denominator: "1" },
    });
  });

  it("registers no pre-bound symbols, only units -- this registry exists solely to resolve unit ids", () => {
    expect(SI_UNIT_REGISTRY.symbols).toEqual([]);
  });

  it("registers exactly the five units above, in this order", () => {
    expect(SI_UNIT_REGISTRY.units).toEqual([
      SI_KILOGRAM,
      SI_METRE,
      SI_SECOND,
      SI_METRE_PER_SECOND_SQUARED,
      SI_NEWTON,
    ]);
  });
});
