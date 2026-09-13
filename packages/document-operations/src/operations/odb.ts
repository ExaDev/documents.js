import { readFile } from "node:fs/promises";
import {
  base64ToBytes,
  decodeOdbPackage,
  evaluateSelect,
  odbToCsv,
  odbToXlsx,
  parseSelect,
  readOdbForms,
  readOdbInventory,
  readOdbReports,
  readOdbTables,
  type Package,
} from "documents.js";
import { z } from "zod";
import { DocumentInputSchema, type DocumentInput } from "../io/document-input";
import {
  DocumentOutputSchema,
  resolveDocumentOutput,
  type ResolvedDocumentOutput,
} from "../io/document-output";
import { defineOperationWithoutOutputSchema } from "../operation";

// None of the six operations below has an original outputSchema to reuse: a thrown HsqldbSqlUnsupportedError/HsqldbSqlParseError/HsqldbSqlEvaluationError (odb_query), OdbNoEmbeddedDataSourceError/OdbUnsupportedFormatError/OdbTableNotFoundError/OdbTableNotSpecifiedError (documents.js's own odb reader/exporters), or a decodeOdbPackage failure on malformed bytes propagates as-is -- there is nothing here to catch or reshape, matching the original MCP tools' own identical no-try/catch convention.

const ODB_SOURCE_DESCRIPTION =
  ".odb database to read. 'path' points at the .odb file on disk -- its extension is never used to infer a document format, since documents.js deliberately excludes 'odb' from DocumentFormat (an embedded database front end has no single natural target format -- tables, saved queries, and reports are three unrelated output shapes -- see that package's own README). 'bytesBase64' carries the .odb bytes inline; its 'format' field is required by the shared hybrid input shape but unused by every odb operation.";

// `source` here is a .odb database, not a document with a DocumentFormat -- resolveDocumentInput's own format inference (io/document-input.ts) has no '.odb' entry and would throw for the ordinary 'path' shape a caller most naturally reaches for. This reads the hybrid DocumentInput's raw bytes directly instead (mirroring from-package.ts's own readSourceBytes, and odb-render-report.ts's own identically-named function, for the identical problem), so no document format is ever inferred from.
export async function resolveOdbBytes(
  source: DocumentInput,
): Promise<Uint8Array<ArrayBuffer>> {
  if ("path" in source) {
    const buffer = await readFile(source.path);
    return new Uint8Array(buffer);
  }
  return base64ToBytes(source.bytesBase64);
}

/** Resolves an .odb DocumentInput straight through to a decoded Package (via documents.js's own decodeOdbPackage) -- the shape every read (as opposed to export) odb operation needs. */
async function resolveOdbPackage(source: DocumentInput): Promise<Package> {
  return decodeOdbPackage(await resolveOdbBytes(source));
}

/** Resolves a saved query's own SQL text by name against the .odb's own db:queries (read via readOdbInventory) -- odb_query's own equivalent of document-cli's resolveQuerySql, for the case where the caller named a saved query rather than supplying SQL directly. Throws, naming every available query, when the name doesn't resolve. */
function resolveSavedQuerySql(pkg: Package, name: string): string {
  const inventory = readOdbInventory(pkg);
  const saved = inventory.queries.find((candidate) => candidate.name === name);
  if (saved === undefined) {
    const available = inventory.queries.map((candidate) => candidate.name);
    throw new Error(
      `This .odb declares no saved query named "${name}".${available.length === 0 ? "" : ` Available: ${available.join(", ")}.`}`,
    );
  }
  return saved.command;
}

type QuerySpec =
  | { readonly kind: "literal"; readonly sql: string }
  | { readonly kind: "saved"; readonly name: string };

/** Classifies odb_query's own sql/query pair before any package is read: exactly one of the two must be given. Throws for either "both given" or "neither given". Kept as a pure, synchronous check (no Package involved) so both variables narrow cleanly through ordinary control flow, rather than needing a cross-variable inference TypeScript can't derive from two separate `!== undefined` checks. */
function classifyQueryInput(
  sql: string | undefined,
  query: string | undefined,
): QuerySpec {
  if (sql !== undefined && query !== undefined) {
    throw new Error('Provide "sql" or "query", not both.');
  }
  if (sql !== undefined) {
    return { kind: "literal", sql };
  }
  if (query !== undefined) {
    return { kind: "saved", name: query };
  }
  throw new Error(
    'Provide either "sql" (a literal SELECT statement) or "query" (the name of one of this .odb\'s own saved queries).',
  );
}

const OdbSourceInputSchema = z.object({
  source: DocumentInputSchema.describe(ODB_SOURCE_DESCRIPTION),
});

export const odbTablesOperation = defineOperationWithoutOutputSchema<
  typeof OdbSourceInputSchema,
  ReturnType<typeof readOdbTables>
>({
  name: "odb_tables",
  title: "List .odb tables",
  description:
    "Lists every table an embedded .odb database declares -- column names, types, and row data -- across every storage tier documents.js supports (HSQLDB TEXT/CACHED/BINARY script formats, Firebird gbak backups).",
  inputSchema: OdbSourceInputSchema,
  async run({ source }) {
    return readOdbTables(await resolveOdbPackage(source));
  },
});

export const odbFormsOperation = defineOperationWithoutOutputSchema<
  typeof OdbSourceInputSchema,
  ReturnType<typeof readOdbForms>
>({
  name: "odb_forms",
  title: "List .odb forms",
  description:
    "Lists every form an .odb database declares, with each form's own data source and field-bound controls.",
  inputSchema: OdbSourceInputSchema,
  async run({ source }) {
    return readOdbForms(await resolveOdbPackage(source));
  },
});

export const odbReportsOperation = defineOperationWithoutOutputSchema<
  typeof OdbSourceInputSchema,
  ReturnType<typeof readOdbReports>
>({
  name: "odb_reports",
  title: "List .odb reports",
  description:
    "Lists every report an .odb database declares, with each report's own data-source command, band/group structure, and rpt: formula expressions.",
  inputSchema: OdbSourceInputSchema,
  async run({ source }) {
    return readOdbReports(await resolveOdbPackage(source));
  },
});

const OdbQueryInputSchema = z.object({
  source: DocumentInputSchema.describe(ODB_SOURCE_DESCRIPTION),
  sql: z
    .string()
    .describe(
      'A literal SELECT statement to run. Mutually exclusive with "query".',
    )
    .optional(),
  query: z
    .string()
    .describe(
      'The name of one of the .odb\'s own saved queries to run. Mutually exclusive with "sql".',
    )
    .optional(),
});

export const odbQueryOperation = defineOperationWithoutOutputSchema<
  typeof OdbQueryInputSchema,
  ReturnType<typeof evaluateSelect>
>({
  name: "odb_query",
  title: "Query an .odb database",
  description:
    "Runs a bounded SELECT (with optional JOINs of any kind, table aliases, a derived table in FROM, and IN/EXISTS subqueries) over an embedded .odb database's own extracted tables, given directly as SQL or by naming one of the database's saved queries. No database engine is involved -- the query runs in memory over the same tables odb_tables would return, against a closed grammar (SELECT/FROM/JOIN [INNER|LEFT [OUTER]|RIGHT [OUTER]|FULL [OUTER]|CROSS|NATURAL] ... [ON|USING]/WHERE/GROUP BY/ORDER BY, with an optional [AS] alias on any table, WHERE and ON also accepting [NOT] IN (SELECT ...) and [NOT] EXISTS (SELECT ...) -- no column aliases); an unsupported construct is reported as an error naming it, never silently ignored.",
  inputSchema: OdbQueryInputSchema,
  async run({ source, sql, query }) {
    const spec = classifyQueryInput(sql, query);
    const pkg = await resolveOdbPackage(source);
    const resolvedSql =
      spec.kind === "literal" ? spec.sql : resolveSavedQuerySql(pkg, spec.name);
    return evaluateSelect(parseSelect(resolvedSql), readOdbTables(pkg));
  },
});

const OdbToCsvInputSchema = z.object({
  source: DocumentInputSchema.describe(ODB_SOURCE_DESCRIPTION),
  table: z
    .string()
    .describe(
      "The table to export -- required when the .odb declares more than one table.",
    )
    .optional(),
  output: DocumentOutputSchema.optional().describe(
    "Where to write the resulting CSV. Omit entirely (or omit outputPath within it) to receive the bytes inline instead.",
  ),
});

export const odbToCsvOperation = defineOperationWithoutOutputSchema<
  typeof OdbToCsvInputSchema,
  ResolvedDocumentOutput
>({
  name: "odb_to_csv",
  title: "Export one .odb table to CSV",
  description:
    "Extracts exactly one named table from an embedded .odb database as CSV bytes. The table name is required whenever the database declares more than one table.",
  inputSchema: OdbToCsvInputSchema,
  async run({ source, table, output }, context) {
    const bytes = await resolveOdbBytes(source);
    const csvBytes = odbToCsv(bytes, { signal: context?.signal, table });
    return resolveDocumentOutput(csvBytes, output ?? {});
  },
});

const OdbToXlsxInputSchema = z.object({
  source: DocumentInputSchema.describe(ODB_SOURCE_DESCRIPTION),
  output: DocumentOutputSchema.optional().describe(
    "Where to write the resulting xlsx workbook. Omit entirely (or omit outputPath within it) to receive the bytes inline instead.",
  ),
});

export const odbToXlsxOperation = defineOperationWithoutOutputSchema<
  typeof OdbToXlsxInputSchema,
  ResolvedDocumentOutput
>({
  name: "odb_to_xlsx",
  title: "Export .odb tables to xlsx",
  description:
    "Extracts every table an embedded .odb database declares into one xlsx workbook, one sheet per table.",
  inputSchema: OdbToXlsxInputSchema,
  async run({ source, output }, context) {
    const bytes = await resolveOdbBytes(source);
    const xlsxBytes = odbToXlsx(bytes, { signal: context?.signal });
    return resolveDocumentOutput(xlsxBytes, output ?? {});
  },
});
