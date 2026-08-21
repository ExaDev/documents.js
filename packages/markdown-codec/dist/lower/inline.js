import { MarkdownDiagnosticCodes } from "../diagnostics/diagnostics.js";
import { FOOTNOTE_REFERENCE_FONT_MARKER, MATH_INLINE_FONT_MARKER, MONOSPACE_FONT_FAMILY } from "../shared/style-constants.js";
//#region src/lower/inline.ts
function buildRun(text, style, fontFamily) {
	return {
		text,
		...style.bold === true ? { bold: true } : {},
		...style.italic === true ? { italic: true } : {},
		...style.strike === true ? { strike: true } : {},
		...style.hyperlink !== void 0 ? { hyperlink: style.hyperlink } : {},
		...fontFamily !== void 0 ? { fontFamily } : {}
	};
}
function lowerNestedEmphasisLike(kind, node, style, context, runs, extents) {
	if (style[kind] === true) context.sink({
		code: MarkdownDiagnosticCodes.NESTED_EMPHASIS_FLATTENED,
		severity: "info",
		message: `a ${kind === "italic" ? "emphasis" : kind === "bold" ? "strong emphasis" : "strikethrough"} span is nested inside another span of the same kind; ContentRun has no nesting depth of its own, so both collapse to one flat run`
	});
	const childStyle = {
		...style,
		[kind]: true
	};
	lowerNodesInto(node.children, childStyle, context, runs, extents);
}
function lowerInlineNodeInto(node, style, context, runs, extents) {
	switch (node.type) {
		case "text":
			if (node.value.length > 0) runs.push(buildRun(node.value, style));
			return;
		case "entity":
			if (node.value.length > 0) runs.push(buildRun(node.value, style));
			return;
		case "softBreak":
			runs.push(buildRun(" ", style));
			return;
		case "hardBreak":
			runs.push(buildRun("\n", style));
			return;
		case "codeSpan":
			runs.push(buildRun(node.literal, style, MONOSPACE_FONT_FAMILY));
			return;
		case "rawHtml":
			if (context.rawHtml === "drop") {
				context.sink({
					code: MarkdownDiagnosticCodes.RAW_HTML_DROPPED,
					severity: "info",
					message: "inline raw HTML was dropped per the rawHtml: \"drop\" option"
				});
				return;
			}
			context.sink({
				code: MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT,
				severity: "info",
				message: "inline raw HTML was preserved as literal text; it will not be rendered as HTML by any consumer of the resulting ContentDocument"
			});
			if (node.literal.length > 0) runs.push(buildRun(node.literal, style));
			return;
		case "mathInline":
			context.sink({
				code: MarkdownDiagnosticCodes.MATH_INLINE_PRESERVED_AS_TEXT,
				severity: "info",
				message: "inline math (\\( \\)) was preserved as literal raw LaTeX text; it is not parsed as LaTeX or converted to MathML by this package"
			});
			runs.push(buildRun(node.literal, style, MATH_INLINE_FONT_MARKER));
			return;
		case "footnoteReference":
			context.sink({
				code: MarkdownDiagnosticCodes.FOOTNOTE_REFERENCE_PRESERVED_AS_TEXT,
				severity: "info",
				message: `footnote reference "[^${node.label}]" is preserved as a marked text run rather than an anchor construct: a construct's extent is block-scoped, and a reference site sits between two runs inside a paragraph, which no block-level boundary marker can bracket`
			});
			runs.push(buildRun(`[^${node.label}]`, style, FOOTNOTE_REFERENCE_FONT_MARKER));
			return;
		case "autolink": {
			const destination = node.email ? `mailto:${node.destination}` : node.destination;
			runs.push(buildRun(node.destination, {
				...style,
				hyperlink: destination
			}));
			return;
		}
		case "link": {
			const childStyle = {
				...style,
				hyperlink: node.destination
			};
			const startRun = runs.length;
			lowerNodesInto(node.children, childStyle, context, runs, extents);
			if (runs.length === startRun) runs.push(buildRun("", childStyle));
			if (node.title !== void 0) extents.push({
				descriptor: {
					kind: "link",
					target: {
						kind: "external",
						uri: node.destination
					},
					title: node.title
				},
				startRun,
				endRun: runs.length
			});
			return;
		}
		case "image":
			if (node.title !== void 0) context.sink({
				code: MarkdownDiagnosticCodes.LINK_TITLE_DROPPED,
				severity: "info",
				message: `image title "${node.title}" has no ContentRun equivalent and was dropped`
			});
			runs.push(buildRun(node.alt, {
				...style,
				hyperlink: node.destination
			}));
			return;
		case "emphasis":
			lowerNestedEmphasisLike("italic", node, style, context, runs, extents);
			return;
		case "strong":
			lowerNestedEmphasisLike("bold", node, style, context, runs, extents);
			return;
		case "strikethrough":
			lowerNestedEmphasisLike("strike", node, style, context, runs, extents);
			return;
	}
}
function lowerNodesInto(nodes, style, context, runs, extents) {
	for (const node of nodes) lowerInlineNodeInto(node, style, context, runs, extents);
}
function lowerInlineNodes(nodes, context) {
	const runs = [];
	const extents = [];
	lowerNodesInto(nodes, {}, context, runs, extents);
	return {
		runs,
		linkTitleExtents: extents
	};
}
function lowerCodeBlockRun(literal) {
	return {
		text: literal,
		fontFamily: MONOSPACE_FONT_FAMILY
	};
}
//#endregion
export { lowerCodeBlockRun, lowerInlineNodes };
