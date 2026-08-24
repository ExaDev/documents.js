import type { OdbQueryInfo, OdbReport, Package } from "odf.js";
import { readOdbInventory } from "odf.js";
import type { HsqldbDecodeOptions } from "../../hsqldb/rowformat";
import { readOdbTables } from "../read";
import type { SqlResultSet } from "../sql/evaluate";
import { evaluateSelect } from "../sql/evaluate";
import { parseSelect } from "../sql/parser";

// Resolves what a Report Builder report's own rpt:command/rpt:command-type pair actually names, into the real rows the report renders over. This is the one place the .odb's three data-binding shapes are distinguished; everything downstream sees only a SqlResultSet, exactly as if the report had been written against a literal SELECT in the first place.
//
// The three rpt:command-type values real Report Builder writes (odf.js's own readOdbReport carries the attribute verbatim rather than narrowing it -- see that reader's finding 1):
//
// - "table"   -- rpt:command is a TABLE NAME, and the report renders every row of it. Turned into a real "SELECT * FROM <table>" and run through src/odb/sql/ like the other two, rather than lifting the HsqldbTable's own rows directly: routing all three shapes through one engine is what makes an unknown table name fail with the engine's own message (naming every table the .odb actually has) instead of a second, parallel resolution rule that could disagree with it.
// - "query"   -- rpt:command is the NAME of a saved query in the .odb's own db:queries, whose db:command holds the real SQL. Looked up by exact name, since that name is a key LibreOffice itself wrote on both sides; a name that resolves to nothing throws naming every saved query rather than falling back to reading it as a table or as literal SQL.
// - "command" -- rpt:command IS the SQL, inline. Passed through verbatim.
//
// The query's own db:escape-processing flag is deliberately not consulted. It tells LibreOffice whether to parse the command itself or hand it to the driver untouched, which is a question about LibreOffice's own SQL rewriting; either way the stored text is SQL, and this package parses it with its own grammar and no rewriting at all.
//
// THE ROWS ARRIVE IN THE COMMAND'S OWN ORDER, and the report's rpt:sort-expression is deliberately not applied on top. A group's rpt:sort-expression is a bare column name, so re-sorting by it would have to discard whatever finer ordering the command already asked for -- in the real form-and-report.odb fixture the saved query orders REGION, then QUARTER, then AMOUNT DESCENDING, and the two group sort expressions name only the first two, so re-sorting on them alone would silently throw the amount ordering away. Report Builder's own model is that the command delivers the data in group order (which is why it writes the sort into the query when the user sets it in the designer), so honouring the command is honouring the report. A command that does NOT deliver its rows in group order produces repeated group instances -- the same thing Report Builder itself produces in that situation, and visible in the output rather than silently corrected.

// A report whose data binding cannot be resolved to a runnable command at all: no rpt:command, no rpt:command-type, an rpt:command-type outside the three real values, or a "query" naming a saved query the .odb does not have.
export class OdbReportDataSourceError extends Error {
  readonly reportName: string;
  readonly command: string | undefined;
  readonly commandType: string | undefined;

  constructor(message: string, report: OdbReport) {
    super(`Report "${report.name}" data source: ${message}`);
    this.name = "OdbReportDataSourceError";
    this.reportName = report.name;
    this.command = report.command;
    this.commandType = report.commandType;
  }
}

// A table name written as a double-quoted SQL identifier, so it matches the real table exactly and can never be re-read as a keyword. Embedded double quotes are doubled -- SQL's own escaping convention, and the one src/odb/sql/lexer.ts already implements on the read side.
function quotedIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function savedQueryCommand(
  report: OdbReport,
  commandName: string,
  queries: readonly OdbQueryInfo[],
): string {
  const query = queries.find((candidate) => candidate.name === commandName);
  if (query === undefined) {
    throw new OdbReportDataSourceError(
      `rpt:command-type is "query" and rpt:command names "${commandName}", but this .odb declares no such saved query -- available quer${queries.length === 1 ? "y" : "ies"}: ${queries.length === 0 ? "(none)" : queries.map((candidate) => candidate.name).join(", ")}`,
      report,
    );
  }
  return query.command;
}

// The SQL text a report's own data binding resolves to. Separated from running it so a caller can see exactly which statement a report will issue -- and so the three-shape resolution above is testable without any table data at all.
export function odbReportCommandSql(
  report: OdbReport,
  queries: readonly OdbQueryInfo[],
): string {
  const command = report.command;
  if (command === undefined) {
    throw new OdbReportDataSourceError(
      "the report declares no rpt:command, so there is no table, query, or statement to read its rows from",
      report,
    );
  }
  switch (report.commandType) {
    case "table":
      return `SELECT * FROM ${quotedIdentifier(command)}`;
    case "query":
      return savedQueryCommand(report, command, queries);
    case "command":
      return command;
    case undefined:
      throw new OdbReportDataSourceError(
        `the report declares rpt:command "${command}" but no rpt:command-type, so whether that names a table, a saved query, or a literal statement is undetermined`,
        report,
      );
    default:
      throw new OdbReportDataSourceError(
        `rpt:command-type "${report.commandType}" is not one of the three values this package resolves ("table", "query", "command")`,
        report,
      );
  }
}

// A report plus the .odb it lives in -> the real rows it renders, in the command's own order. Reads the package's table data through readOdbTables, so whichever storage tier the .odb uses (HSQLDB TEXT/CACHED/BINARY, or Firebird) is already resolved by the time the query engine sees it.
export function resolveOdbReportRows(
  pkg: Package,
  report: OdbReport,
  options?: HsqldbDecodeOptions,
): SqlResultSet {
  const sql = odbReportCommandSql(report, readOdbInventory(pkg).queries);
  return evaluateSelect(parseSelect(sql), readOdbTables(pkg, options));
}
