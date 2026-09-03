// Read and write options, matching the shape markdown-codec's and pdf-codec's own option objects already use in this family: an AbortSignal and a diagnostic sink on both sides, and resource limits on the read side only, since a writer's input is a value this process already holds rather than bytes of unknown provenance.

import type { RtfDiagnosticSink } from "./diagnostics";

// The default input cap. RTF has no length field and no structural bound of its own, so a reader handed adversarial input has nothing but a limit like this between it and unbounded allocation. 64 MiB is well above any real .rtf document -- the format is 7-bit text whose largest payloads are hex-encoded pictures -- and a caller with a genuinely larger file raises it explicitly.
export const DEFAULT_MAX_INPUT_BYTES = 64 * 1024 * 1024;

// The default group-nesting cap. RTF's own grammar puts no bound on nesting, and this reader walks groups with an explicit stack rather than recursion, so the cap is not a stack-overflow guard so much as a refusal to build an unbounded state stack for input that cannot be a real document: Word's own deepest legitimate nesting (a nested table inside a field result inside a content-control-equivalent destination) is an order of magnitude below this.
export const DEFAULT_MAX_GROUP_DEPTH = 256;

export interface ReadRtfOptions {
  readonly signal?: AbortSignal;
  readonly sink?: RtfDiagnosticSink;
  readonly maxInputBytes?: number;
  readonly maxGroupDepth?: number;
}

export type RtfLineEnding = "\n" | "\r\n";

export interface WriteRtfOptions {
  readonly signal?: AbortSignal;
  readonly sink?: RtfDiagnosticSink;
  // Which line ending separates the writer's own output lines. RTF ignores bare CR/LF entirely ("CRLFs should be ignored by RTF readers except that they can act as control word delimiters"), so this changes nothing a reader sees -- it exists because the specification recommends breaking long output for transmission, and a caller diffing output against a Windows-produced file wants to choose. Default "\n".
  readonly lineEnding?: RtfLineEnding;
}
