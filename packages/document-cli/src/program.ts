import { Command, type CommanderError } from 'commander';
import { registerConversionCommands } from './commands/convert';
import { registerDocxExtrasCommand } from './commands/docx-extras';
import { registerFontsCommand } from './commands/fonts';
import { registerFormatsCommand } from './commands/formats';
import { registerFromPackageCommand } from './commands/from-package';
import { registerMetadataCommand } from './commands/metadata';
import { registerOdbCommands } from './commands/odb';
import { registerOdmCommand } from './commands/odm';
import { registerPdfInspectCommand } from './commands/pdf-inspect';
import { registerSetMetadataCommand } from './commands/set-metadata';
import { EXIT_SUCCESS, EXIT_USAGE_ERROR } from './runtime/exit-codes';
// resolveJsonModule lets rolldown (via tsdown) inline this package's own declared version straight into the bundle at build time -- no runtime fs read, no import-attribute syntax that would otherwise need to differ between the ESM and CJS build outputs.
import { version } from '../package.json';

// Builds the fully assembled commander program, but never parses argv or exits the process itself -- that is src/cli.ts's job, so this stays testable as pure construction and importable from anywhere (including the Ink TUI, which shells out to individual commands rather than re-implementing conversion logic of its own).
export function createProgram(): Command {
  const program = new Command('document-cli');
  program.description('every documents.js docx/pptx/odt/odp/ods/odg/odf/pdf/odm/odb/xlsx/csv/svg/markdown conversion, bridge, and inspector as a scriptable command');
  program.version(version);

  // Without exitOverride, a commander usage error (or --help/--version) calls process.exit() directly from deep inside .parse()/.parseAsync(), which is exactly the hard, uncontrolled exit this codebase's own convention (set process.exitCode, let Node drain and exit naturally) exists to avoid. Registering a callback here is the only way to prevent that call (see commander's own Command#_exit -- it falls through to a bare process.exit(exitCode) immediately after invoking the callback unless the callback throws), so process.exitCode is set correctly *before* rethrowing; by the time this throws, the exit code is already right regardless of what, if anything, the eventual .parseAsync() caller in src/cli.ts does with the rejection.
  program.exitOverride((error: CommanderError) => {
    process.exitCode = error.exitCode === 0 ? EXIT_SUCCESS : EXIT_USAGE_ERROR;
    throw error;
  });

  registerConversionCommands(program);
  registerFormatsCommand(program);
  registerFromPackageCommand(program);
  registerOdmCommand(program);
  registerOdbCommands(program);
  registerPdfInspectCommand(program);
  registerFontsCommand(program);
  registerDocxExtrasCommand(program);
  registerMetadataCommand(program);
  registerSetMetadataCommand(program);

  return program;
}
