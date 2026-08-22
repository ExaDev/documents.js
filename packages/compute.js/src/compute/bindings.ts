import { z } from 'zod';
import { QuantitySchema } from './quantity';
import { IntervalSchema } from './interval';

// FormulaBindings is compute.js's third own schema (alongside Quantity and Interval) -- see this package's README for the same coordination note that applies to Quantity. It supplies the concrete values a MathExpression's 'sym' nodes reference: keyed by symbol-table id (document-schema.js's MathSym.id / MathSymbolEntry.id, src/math.ts), each entry being either a point Quantity or a bounded Interval, so one binding shape serves both evaluation modes evaluate() supports without the caller having to know in advance which mode a given formula needs.
export const EvaluationValueSchema = z.union([QuantitySchema, IntervalSchema]);
export type EvaluationValue = z.infer<typeof EvaluationValueSchema>;

export const FormulaBindingsSchema = z.record(z.string(), EvaluationValueSchema);
export type FormulaBindings = z.infer<typeof FormulaBindingsSchema>;
