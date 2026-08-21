import { i as MarkdownDiagnosticSink } from "../diagnostics-CUMLtGHJ.js";
import { LinkReferenceDefinition } from "../inline/link.js";
//#region src/block/definitions.d.ts
declare function extractDefinitions(content: string, references: Map<string, LinkReferenceDefinition>, sink?: MarkdownDiagnosticSink, startLine?: number): string;
//#endregion
export { extractDefinitions };