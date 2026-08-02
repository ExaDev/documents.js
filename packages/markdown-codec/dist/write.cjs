Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_emit_emit = require("./emit/emit.cjs");
//#region src/write.ts
function writeMarkdown(document, options = {}) {
	options.signal?.throwIfAborted();
	return require_emit_emit.emitMarkdown(document, options);
}
//#endregion
exports.writeMarkdown = writeMarkdown;
