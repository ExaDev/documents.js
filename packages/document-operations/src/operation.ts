import type { z } from "zod";

/**
 * Carried alongside an operation's own input -- transport concerns an operation's own logic needs but that don't belong in its Zod input schema, since a caller (MCP tool args, a REST request body, a CLI flag set) never supplies them directly. Currently just an abort signal: MCP derives it from the tool call's own `ctx.mcpReq.signal`, document-cli from its own `--timeout`-derived controller, and a REST server would derive it from the incoming HTTP request's own abort event.
 */
export interface DocumentOperationContext {
  readonly signal?: AbortSignal;
}

/**
 * One document operation, complete enough for any of the three transports (MCP tool registration, a CLI command, a REST route) to expose it without redefining its shape or its behaviour: `inputSchema`/`outputSchema` are the single source of truth for validation and description text, and `run()` is the transport-agnostic implementation, throwing a plain (or documents.js's own typed) Error on failure rather than shaping any transport-specific result -- each transport decides for itself how to present a thrown error (MCP wraps it as an isError tool result, a REST route as a 4xx JSON body, a CLI command as a stderr message and a non-zero exit code).
 */
export interface DocumentOperation<In = unknown, Out = unknown> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<In>;
  // Optional: a handful of operations (list_document_conversions' own input, metadata_read's own output) have no schema in the original MCP tool registration to derive one from -- adding a guessed schema here would risk introducing MCP output validation that did not exist before and could reject a genuine value the guess did not anticipate. Only set when the original tool declared one.
  readonly outputSchema?: z.ZodType<Out>;
  run(input: In, context?: DocumentOperationContext): Promise<Out>;
}

/**
 * Builds a DocumentOperation whose input and output types are both inferred from real Zod schemas, so a call site never has to repeat `z.infer<typeof Schema>` itself. Use `defineOperationWithoutOutputSchema` instead for the rare operation whose original MCP tool registration declared no outputSchema at all.
 *
 * Deliberately returns the parameter object's own inferred literal type rather than an explicit `DocumentOperation<...>` return annotation. Zod 4's ZodType carries its own output type as one of three generic parameters (ZodType<Output, Input, Internals>), and TypeScript cannot prove, from inside this function body, that a generic `InputSchema extends z.ZodType` also extends `z.ZodType<z.infer<InputSchema>>` -- the two-step indirection through an abstract type parameter defeats it even though it is true for every concrete schema. Letting the literal's own type flow out instead sidesteps that: a caller's own concrete schema (e.g. `ConvertDocumentInputSchema`) is trivially assignable to `DocumentOperation<In, Out>`'s `z.ZodType<In>` field wherever that supertype is actually needed (the registry array below, or a future MCP/REST/CLI adapter parameter), because widening a CONCRETE schema's output type to line up is a normal covariant check, not the same self-referential generic one.
 */
export function defineOperation<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(operation: {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: InputSchema;
  readonly outputSchema: OutputSchema;
  run(
    input: z.infer<InputSchema>,
    context?: DocumentOperationContext,
  ): Promise<z.infer<OutputSchema>>;
}) {
  return operation;
}

/**
 * The `defineOperation` counterpart for an operation with no output schema to infer from (the original MCP tool registration declared none) -- `Out` is inferred from `run`'s own return type instead. See `defineOperation`'s own comment for why this returns the parameter object's inferred literal type rather than an explicit `DocumentOperation<...>` annotation.
 */
export function defineOperationWithoutOutputSchema<
  InputSchema extends z.ZodType,
  Out,
>(operation: {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: InputSchema;
  run(
    input: z.infer<InputSchema>,
    context?: DocumentOperationContext,
  ): Promise<Out>;
}) {
  return operation;
}
