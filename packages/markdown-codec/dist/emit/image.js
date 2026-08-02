import { escapeMarkdownText } from "./inline.js";
//#region src/emit/image.ts
function emitImage(block, embedData) {
	const alt = escapeMarkdownText(block.altText ?? "");
	if (!embedData) return `![${alt}]()`;
	return `![${alt}](data:image/${block.format};base64,${block.base64})`;
}
//#endregion
export { emitImage };
