import { MarkdownDiagnosticCodes, MarkdownPackageFlattenError, MarkdownUnsupportedDocumentKindError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from "./diagnostics/diagnostics.js";
import { emitMarkdown } from "./emit/emit.js";
import { flattenPackage } from "document-schema.js";
//#region src/write.ts
function reportDroppedPackageTables(documentPackage, sink) {
	const tables = [
		["definitions", documentPackage.definitions !== void 0 && Object.keys(documentPackage.definitions).length > 0],
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
	reportDroppedPackageTables(documentPackage, options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK);
	let flattened;
	try {
		flattened = flattenPackage(documentPackage);
	} catch (error) {
		throw new MarkdownPackageFlattenError(error);
	}
	return writeMarkdownContent(flattened, options);
}
function writeMarkdownContent(document, options = {}) {
	options.signal?.throwIfAborted();
	return emitMarkdown(document, options);
}
//#endregion
export { writeMarkdown, writeMarkdownContent };
