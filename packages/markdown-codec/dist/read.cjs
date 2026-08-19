Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_lower_lower = require("./lower/lower.cjs");
let document_schema_js = require("document-schema.js");
//#region src/read.ts
function readMarkdown(text, options = {}) {
	const { document, diagnostics } = readMarkdownContent(text, options);
	return {
		documentPackage: (0, document_schema_js.assemblePackage)(document),
		diagnostics
	};
}
function readMarkdownContent(text, options = {}) {
	options.signal?.throwIfAborted();
	const diagnostics = [];
	const callerSink = options.sink;
	return {
		document: require_lower_lower.lowerMarkdown(text, {
			...options,
			sink: (diagnostic) => {
				diagnostics.push(diagnostic);
				callerSink?.(diagnostic);
			}
		}),
		diagnostics
	};
}
//#endregion
exports.readMarkdown = readMarkdown;
exports.readMarkdownContent = readMarkdownContent;
