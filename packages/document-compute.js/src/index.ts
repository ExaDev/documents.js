// document-compute.js: a units-typed, tree-walking evaluator for document-schema.js's MathExpression, plus bisection/Newton numeric solve-for over the same evaluator. Built for ExaDev/documents.js#573; see README.md for the full scope statement. The evaluator's value schemas (Quantity, Interval, EvaluationValue, FormulaBindings) are typed contracts defined in document-schema.js itself, imported here the same way MathExpression is -- this barrel re-exports only this package's own evaluation logic.
export * from "./compute/rational";
export * from "./compute/dimensions";
export * from "./compute/errors";
export * from "./compute/quantity";
export * from "./compute/interval";
export * from "./compute/evaluate";
export * from "./compute/solve";
