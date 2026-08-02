Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_emit_inline = require("./inline.cjs");
//#region src/emit/image.ts
function emitImage(block, embedData) {
	const alt = require_emit_inline.escapeMarkdownText(block.altText ?? "");
	if (!embedData) return `![${alt}]()`;
	return `![${alt}](data:image/${block.format};base64,${block.base64})`;
}
//#endregion
exports.emitImage = emitImage;
