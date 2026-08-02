Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/emit/front-matter.ts
const NEEDS_QUOTING_PATTERN = /^[-?#!&*"'@`|>[\]{}%]|: |:$/;
function emitScalar(value) {
	if (!NEEDS_QUOTING_PATTERN.test(value) && value.trim() === value && value.length > 0) return value;
	return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
function emitFrontMatter(metadata) {
	const lines = [];
	if (metadata.title !== void 0) lines.push(`title: ${emitScalar(metadata.title)}`);
	if (metadata.author !== void 0) lines.push(`author: ${emitScalar(metadata.author)}`);
	if (metadata.subject !== void 0) lines.push(`subject: ${emitScalar(metadata.subject)}`);
	if (metadata.creator !== void 0) lines.push(`creator: ${emitScalar(metadata.creator)}`);
	if (metadata.createdIso !== void 0) lines.push(`date: ${emitScalar(metadata.createdIso)}`);
	if (metadata.keywords !== void 0 && metadata.keywords.length > 0) lines.push(`keywords: [${metadata.keywords.map((keyword) => emitScalar(keyword)).join(", ")}]`);
	if (lines.length === 0) return;
	return [
		"---",
		...lines,
		"---"
	].join("\n");
}
//#endregion
exports.emitFrontMatter = emitFrontMatter;
