import { i as MarkdownDiagnosticSink } from "../diagnostics-CUMLtGHJ.cjs";
import { LinkReferenceDefinition } from "../inline/link.cjs";
//#region src/block/definitions.d.ts
declare function extractDefinitions(content: string, references: Map<string, LinkReferenceDefinition>, sink?: MarkdownDiagnosticSink, startLine?: number): string;
//#endregion
export { extractDefinitions };