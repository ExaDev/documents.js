import { type Command } from 'commander';

// The common flag surface every conversion-shaped command shares -- centralised here since the identical `.option()` calls are registered verbatim across all nineteen explicit per-format conversion commands, the generic `convert` command, and the odm/odb bridge commands; duplicating them at every one of those call sites would drift the moment a single flag's wording changed.
export function addOutOption(command: Command): Command {
  return command.option('-o, --out <file>', "output file path (defaults to the input path with the target format's extension); use - for stdout");
}

export function addTimeoutOption(command: Command): Command {
  return command.option('--timeout <ms>', 'abort the run after this many milliseconds', (value: string) => Number.parseInt(value, 10));
}

export function addJsonOption(command: Command): Command {
  return command.option('--json', 'emit diagnostics and the result summary as newline-delimited JSON on stderr', false);
}

export function addQuietOption(command: Command): Command {
  return command.option('-q, --quiet', 'suppress diagnostic and summary output', false);
}

export function addVerboseOption(command: Command): Command {
  return command.option('--verbose', 'include a full stack trace when the run fails', false);
}

export function addDumpPackageOption(command: Command): Command {
  return command.option('--dump-package <file>', 'write the intermediate DocumentPackage (content + layout) this conversion built to a JSON file');
}

// The shared flag set for a command that reads one file, converts or extracts from it, and writes one file: output destination, a run timeout, and the three output-shaping flags every such command supports. --dump-package is deliberately not included here -- only the PDF-pivot conversions ever populate ConversionResult.package, so it is added separately by callers that actually go through buildConversionAction.
export function addConversionFlags(command: Command): Command {
  addOutOption(command);
  addTimeoutOption(command);
  addJsonOption(command);
  addQuietOption(command);
  addVerboseOption(command);
  return command;
}

// The raw shape commander produces once addConversionFlags has registered its five options -- kept separate from commands/shared.ts's ConversionCommandOptions (which uses timeoutMs, matching buildConversionAction's own contract) because commander derives its attribute name from the flag itself ("timeout"), not from the interface the built action expects.
export interface ConversionCliFlags {
  readonly out?: string;
  readonly timeout?: number;
  readonly json: boolean;
  readonly quiet: boolean;
  readonly verbose: boolean;
}
