Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_emit_emit = require("./emit/emit.cjs");
let document_schema_js = require("document-schema.js");
//#region src/write.ts
function writeMarkdown(documentPackage, options = {}) {
	options.signal?.throwIfAborted();
	return writeMarkdownContent((0, document_schema_js.flattenPackage)(documentPackage), options);
}
function writeMarkdownContent(document, options = {}) {
	options.signal?.throwIfAborted();
	return require_emit_emit.emitMarkdown(document, options);
}
//#endregion
exports.writeMarkdown = writeMarkdown;
exports.writeMarkdownContent = writeMarkdownContent;
