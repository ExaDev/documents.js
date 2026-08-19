Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_read = require("./read.cjs");
const require_write = require("./write.cjs");
let zod = require("zod");
let document_schema_js = require("document-schema.js");
//#region src/codec.ts
function isWellFormedUtf8Text(bytes) {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}
const MarkdownBytesSchema = zod.z.instanceof(Uint8Array).refine(isWellFormedUtf8Text, { message: "not well-formed UTF-8 text" });
const markdownCodec = zod.z.codec(MarkdownBytesSchema, document_schema_js.DocumentPackageSchema, {
	decode: (bytes) => require_read.readMarkdown(new TextDecoder().decode(bytes)).documentPackage,
	encode: (documentPackage) => new TextEncoder().encode(require_write.writeMarkdown(documentPackage))
});
const markdownContentCodec = zod.z.codec(MarkdownBytesSchema, document_schema_js.ContentDocumentSchema, {
	decode: (bytes) => require_read.readMarkdownContent(new TextDecoder().decode(bytes)).document,
	encode: (document) => new TextEncoder().encode(require_write.writeMarkdownContent(document))
});
//#endregion
exports.MarkdownBytesSchema = MarkdownBytesSchema;
exports.markdownCodec = markdownCodec;
exports.markdownContentCodec = markdownContentCodec;
