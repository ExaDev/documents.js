import type { MathUnit, SymbolTable } from "document-schema.js";

// A small SI unit registry for tests that need real dimensioned qty nodes (this package's own evaluate() resolves a MathQty's unit id against exactly this shape, SymbolTable.units) -- kilogram, metre, second, and the two derived units the worked-example harness's own physics fixtures need (metre-per-second-squared, newton). factorToSi is 1/1 for every base SI unit itself, matching MathUnitSchema's own convention that a coherent SI unit converts to itself with no scale.
const ONE = { numerator: "1", denominator: "1" };

export const SI_KILOGRAM: MathUnit = {
  id: "si:kilogram",
  symbol: "kg",
  name: "kilogram",
  dimension: { mass: 1 },
  factorToSi: ONE,
};

export const SI_METRE: MathUnit = {
  id: "si:metre",
  symbol: "m",
  name: "metre",
  dimension: { length: 1 },
  factorToSi: ONE,
};

export const SI_SECOND: MathUnit = {
  id: "si:second",
  symbol: "s",
  name: "second",
  dimension: { time: 1 },
  factorToSi: ONE,
};

export const SI_METRE_PER_SECOND_SQUARED: MathUnit = {
  id: "si:metre-per-second-squared",
  symbol: "m/s^2",
  name: "metre per second squared",
  dimension: { length: 1, time: -2 },
  factorToSi: ONE,
};

export const SI_NEWTON: MathUnit = {
  id: "si:newton",
  symbol: "N",
  name: "newton",
  dimension: { mass: 1, length: 1, time: -2 },
  factorToSi: ONE,
};

export const SI_UNIT_REGISTRY: SymbolTable = {
  symbols: [],
  units: [
    SI_KILOGRAM,
    SI_METRE,
    SI_SECOND,
    SI_METRE_PER_SECOND_SQUARED,
    SI_NEWTON,
  ],
};
