import { lowerMarkdownDetailed } from "./lower/lower.js";
import { assemblePackage } from "document-schema.js";
//#region src/read.ts
function readMarkdownDetail(text, options) {
	options.signal?.throwIfAborted();
	const diagnostics = [];
	const callerSink = options.sink;
	return {
		...lowerMarkdownDetailed(text, {
			...options,
			sink: (diagnostic) => {
				diagnostics.push(diagnostic);
				callerSink?.(diagnostic);
			}
		}),
		diagnostics
	};
}
function linkDefinitionEntries(references) {
	if (references.size === 0) return;
	const entries = {};
	for (const [label, definition] of references) entries[label] = definition.title === void 0 ? {
		kind: "link",
		destination: definition.destination
	} : {
		kind: "link",
		destination: definition.destination,
		title: definition.title
	};
	return entries;
}
function readMarkdown(text, options = {}) {
	const detail = readMarkdownDetail(text, options);
	const assembled = assemblePackage(detail.document);
	const definitions = linkDefinitionEntries(detail.references);
	const frontMatterResidue = detail.frontMatterSource === void 0 ? void 0 : {
		format: "markdown",
		xml: detail.frontMatterSource
	};
	return {
		documentPackage: definitions === void 0 && frontMatterResidue === void 0 ? assembled : {
			...assembled,
			...definitions !== void 0 ? { definitions: {
				...assembled.definitions,
				...definitions
			} } : {},
			...frontMatterResidue !== void 0 ? { source: {
				...assembled.source ?? {},
				frontmatter: frontMatterResidue
			} } : {}
		},
		diagnostics: detail.diagnostics
	};
}
function readMarkdownContent(text, options = {}) {
	const detail = readMarkdownDetail(text, options);
	return {
		document: detail.document,
		diagnostics: detail.diagnostics
	};
}
//#endregion
export { readMarkdown, readMarkdownContent };
