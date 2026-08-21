import { MarkdownDiagnosticCodes, MarkdownPackageFlattenError, MarkdownUnsupportedDocumentKindError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from "./diagnostics/diagnostics.js";
import { emitFrontMatter } from "./emit/front-matter.js";
import { escapeLinkDestination, renderLinkTitle } from "./emit/inline.js";
import { emitMarkdown } from "./emit/emit.js";
import { flattenPackage } from "document-schema.js";
//#region src/write.ts
function renderLinkDefinition(label, entry) {
	const destination = entry.destination;
	const title = entry.title;
	if (typeof destination !== "string") return;
	if (title !== void 0 && typeof title !== "string") return;
	return `[${label}]: ${escapeLinkDestination(destination)}${title === void 0 ? "" : ` "${renderLinkTitle(title)}"`}`;
}
function renderLinkDefinitions(definitions) {
	const lines = [];
	for (const [label, entry] of Object.entries(definitions)) {
		const line = renderLinkDefinition(label, entry);
		if (line !== void 0) lines.push(line);
	}
	return lines.length > 0 ? lines.join("\n") : void 0;
}
function reportDroppedPackageTables(documentPackage, definitionsRendered, sink) {
	const definitions = documentPackage.definitions;
	const tables = [
		["definitions", definitions !== void 0 && !definitionsRendered && Object.keys(definitions).length > 0],
		["layers", documentPackage.layers !== void 0 && Object.keys(documentPackage.layers).length > 0],
		["attachments", documentPackage.attachments !== void 0 && Object.keys(documentPackage.attachments).length > 0],
		["destinations", documentPackage.destinations !== void 0 && Object.keys(documentPackage.destinations).length > 0],
		["pages", documentPackage.pages !== void 0 && documentPackage.pages.length > 0]
	];
	for (const [name, present] of tables) {
		if (!present) continue;
		sink({
			code: MarkdownDiagnosticCodes.PACKAGE_TABLE_DROPPED,
			severity: "info",
			message: `the package's own "${name}" table has no markdown representation; flattenPackage's envelope carries forward only metadata and symbolTable, so "${name}" is dropped rather than rendered`
		});
	}
}
function writeMarkdown(documentPackage, options = {}) {
	options.signal?.throwIfAborted();
	if (documentPackage.kind !== "wordprocessing") throw new MarkdownUnsupportedDocumentKindError(documentPackage.kind);
	const sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
	const definitionsBlock = documentPackage.definitions === void 0 ? void 0 : renderLinkDefinitions(documentPackage.definitions);
	reportDroppedPackageTables(documentPackage, definitionsBlock !== void 0, sink);
	let flattened;
	try {
		flattened = flattenPackage(documentPackage);
	} catch (error) {
		throw new MarkdownPackageFlattenError(error);
	}
	const body = writeMarkdownContent(flattened, {
		...options,
		frontMatter: false
	});
	const frontMatterResidue = documentPackage.source?.frontmatter;
	const frontMatter = options.frontMatter === true ? frontMatterResidue?.format === "markdown" ? frontMatterResidue.xml : emitFrontMatter(flattened.metadata) : void 0;
	const withFrontMatter = frontMatter === void 0 ? body : `${frontMatter}\n\n${body}`;
	return definitionsBlock === void 0 ? withFrontMatter : withFrontMatter.length > 0 ? `${withFrontMatter}\n\n${definitionsBlock}` : definitionsBlock;
}
function writeMarkdownContent(document, options = {}) {
	options.signal?.throwIfAborted();
	return emitMarkdown(document, options);
}
//#endregion
export { writeMarkdown, writeMarkdownContent };
