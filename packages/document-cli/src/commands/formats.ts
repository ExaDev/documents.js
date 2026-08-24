import { type Command } from "commander";
import { createLocalDocumentConverter } from "documents.js";

const COMMANDS_NOT_LISTED =
  "odm-to-pdf, odb-to-csv, odb-to-xlsx, odb-tables, odb-forms, odb-reports, odb-query, odb-render-report, pdf-inspect, from-package, fonts, docx-extras, metadata, set-metadata, outline";

export function registerFormatsCommand(program: Command): void {
  program
    .command("formats")
    .description(
      "list every source -> target conversion this CLI supports via a <source>-to-<target> command",
    )
    .option(
      "--json",
      "emit the conversion list as a JSON array instead of a human-readable table",
      false,
    )
    .action((options: { readonly json: boolean }) => {
      const { conversions } = createLocalDocumentConverter();

      if (options.json) {
        process.stdout.write(`${JSON.stringify(conversions)}\n`);
        return;
      }

      for (const { source, target } of conversions) {
        process.stdout.write(`${source} -> ${target}\n`);
      }
      process.stdout.write(
        `\nnot covered by this list, each its own command: ${COMMANDS_NOT_LISTED}\n`,
      );
    });
}
