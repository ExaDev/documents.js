import { i as MarkdownDiagnosticSink } from "../diagnostics-BuO5-SW1.cjs";
import { t as LinkReferenceDefinition } from "../link-Dv4kxVjk.cjs";
//#region src/block/definitions.d.ts
declare function extractDefinitions(content: string, references: Map<string, LinkReferenceDefinition>, sink?: MarkdownDiagnosticSink, startLine?: number): string;
//#endregion
export { extractDefinitions };