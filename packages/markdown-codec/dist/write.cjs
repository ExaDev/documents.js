Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_diagnostics_diagnostics = require("./diagnostics/diagnostics.cjs");
const require_emit_emit = require("./emit/emit.cjs");
let document_schema_js = require("document-schema.js");
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
			code: require_diagnostics_diagnostics.MarkdownDiagnosticCodes.PACKAGE_TABLE_DROPPED,
			severity: "info",
			message: `the package's own "${name}" table has no markdown representation; flattenPackage's envelope carries forward only metadata and symbolTable, so "${name}" is dropped rather than rendered`
		});
	}
}
function writeMarkdown(documentPackage, options = {}) {
	options.signal?.throwIfAborted();
	if (documentPackage.kind !== "wordprocessing") throw new require_diagnostics_diagnostics.MarkdownUnsupportedDocumentKindError(documentPackage.kind);
	reportDroppedPackageTables(documentPackage, options.sink ?? require_diagnostics_diagnostics.NOOP_MARKDOWN_DIAGNOSTIC_SINK);
	let flattened;
	try {
		flattened = (0, document_schema_js.flattenPackage)(documentPackage);
	} catch (error) {
		throw new require_diagnostics_diagnostics.MarkdownPackageFlattenError(error);
	}
	return writeMarkdownContent(flattened, options);
}
function writeMarkdownContent(document, options = {}) {
	options.signal?.throwIfAborted();
	return require_emit_emit.emitMarkdown(document, options);
}
//#endregion
exports.writeMarkdown = writeMarkdown;
exports.writeMarkdownContent = writeMarkdownContent;
