import { type Command } from 'commander';

// The common flag surface every conversion-shaped command shares -- centralised here since the identical `.option()` calls are registered verbatim across all twenty-seven explicit per-format conversion commands, the generic `convert` command, and the odm/odb bridge commands; duplicating them at every one of those call sites would drift the moment a single flag's wording changed.
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
  return command.option('--dump-package <file>', 'write the intermediate DocumentTree (the tree form: container-grouped content carrying per-node rendered frames, plus page sizes) this conversion built to a JSON file');
}

// Accumulates repeated --font-file <path> flags into a list, in the order given -- which is also the order documents.js's own FontRegistry resolves them in, so an earlier --font-file wins a family+weight+slope tie against a later one.
function collectFontFile(value: string, previous: readonly string[]): readonly string[] {
  return [...previous, value];
}

// The two font flags, registered only on commands whose target can actually be pdf -- the conversions that run a layout engine and resolve a typeface to draw with. A pdf-to-<format> reconstruction reads a PDF's own already-positioned glyphs and a format-to-format bridge runs no layout engine at all, so offering these there would advertise an option that could not do anything (the same reasoning that keeps --dump-package out of addConversionFlags below).
export function addFontOptions(command: Command): Command {
  command.option(
    '--font-file <path>',
    "embed this font file (.ttf/.otf) when the document asks for the family it declares; repeatable. The family, weight, and slope are read from the font's own 'name'/'OS/2' tables, so no accompanying family flag is needed",
    collectFontFile,
    [],
  );
  command.option('--report-font-substitutions', 'print each font face that resolved to something other than what the document asked for to stderr, as it happens', false);
  return command;
}

// The shared flag set for a command that reads one file, converts or extracts from it, and writes one file: output destination, a run timeout, and the three output-shaping flags every such command supports. --dump-package is deliberately not included here -- it exists only where a DocumentConverter port conversion runs and populates ConversionResult.package, so it is added separately by the conversion commands themselves (commands/convert.ts), not the direct-call commands (odm/odb/metadata/...) that bypass the port entirely.
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

// addFontOptions's own two attributes, kept out of ConversionCliFlags because that interface describes what addConversionFlags registers and these are registered separately, on the subset of commands that can reach a layout engine. Both are optional for exactly that reason: on a command addFontOptions was never applied to, commander leaves them undefined rather than defaulting them.
export interface FontCliFlags {
  readonly fontFile?: readonly string[];
  readonly reportFontSubstitutions?: boolean;
}

// The three selection flags documents.js's converter threads to its csv and svg edges: a csv source reads (and a csv target writes) with `delimiter`, a csv target picks `sheet` when the source document carries more than one, and an svg target picks `page` when the source document has more than one (0-based, matching the array index documents.js's own SvgPageNotFoundError reports). Registered only on the commands whose fixed format pair can reach the edge in question, plus unconditionally on `convert` and `from-package` whose target is only known at run time -- the same registration reasoning addFontOptions's own comment documents for the font flags.
export function addDelimiterOption(command: Command): Command {
  return command.option('--delimiter <char>', 'field delimiter a csv source reads with, or a csv target writes with (default \',\')');
}

export function addSheetOption(command: Command): Command {
  return command.option('--sheet <name>', 'the sheet a csv target writes, when the source document has more than one');
}

export function addPageOption(command: Command): Command {
  return command.option('--page <index>', 'the 0-based page an svg target draws, when the source document has more than one', (value: string) => Number.parseInt(value, 10));
}

// The three attributes the helpers above register, kept out of ConversionCliFlags for the same reason FontCliFlags is: they exist only on the subset of commands the helpers were applied to.
export interface SelectionCliFlags {
  readonly delimiter?: string;
  readonly sheet?: string;
  readonly page?: number;
}
