import { readMarkdown, readMarkdownContent } from "./read.js";
import { writeMarkdown, writeMarkdownContent } from "./write.js";
import { z } from "zod";
import { ContentDocumentSchema, DocumentPackageSchema } from "document-schema.js";
//#region src/codec.ts
function isWellFormedUtf8Text(bytes) {
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		return true;
	} catch {
		return false;
	}
}
const MarkdownBytesSchema = z.instanceof(Uint8Array).refine(isWellFormedUtf8Text, { message: "not well-formed UTF-8 text" });
const markdownCodec = z.codec(MarkdownBytesSchema, DocumentPackageSchema, {
	decode: (bytes) => readMarkdown(new TextDecoder().decode(bytes)).documentPackage,
	encode: (documentPackage) => new TextEncoder().encode(writeMarkdown(documentPackage))
});
const markdownContentCodec = z.codec(MarkdownBytesSchema, ContentDocumentSchema, {
	decode: (bytes) => readMarkdownContent(new TextDecoder().decode(bytes)).document,
	encode: (document) => new TextEncoder().encode(writeMarkdownContent(document))
});
//#endregion
export { MarkdownBytesSchema, markdownCodec, markdownContentCodec };
