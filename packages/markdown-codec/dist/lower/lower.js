import { DEFAULT_MARGINS } from "../defaults/defaults.js";
import { MarkdownDiagnosticCodes, MarkdownInputTooLargeError, NOOP_MARKDOWN_DIAGNOSTIC_SINK } from "../diagnostics/diagnostics.js";
import { parseMarkdown } from "../block/block.js";
import { createNumIdMintState, mintListItemId, mintListNumId, mintedListType } from "../shared/list-id.js";
import { CODE_BLOCK_STYLE_ID, HORIZONTAL_RULE_STYLE_ID, HTML_PREFORMATTED_STYLE_ID, QUOTE_STYLE_ID, headingStyleId } from "../shared/style-constants.js";
import { extractFrontMatter } from "./front-matter.js";
import { resolveMarkdownImage } from "./image.js";
import { lowerCodeBlockRun, lowerInlineNodes } from "./inline.js";
import { lowerTable } from "./table.js";
import { PAGE_SIZE_A4 } from "document-schema.js";
//#region src/lower/lower.ts
function inlineContext(context) {
	return {
		sink: context.sink,
		rawHtml: context.rawHtmlMode
	};
}
function decorateParagraph(paragraph, context) {
	let result = paragraph;
	if (context.quoteDepth > 0) result = {
		...result,
		indentLeftPt: context.quoteDepth * 36,
		...result.styleId === void 0 ? { styleId: QUOTE_STYLE_ID } : {}
	};
	if (context.list !== void 0) result = {
		...result,
		list: { ...context.list }
	};
	return result;
}
function paragraphWithConstructs(runs, linkTitleExtents) {
	return {
		runs,
		...linkTitleExtents.length > 0 ? { constructs: [...linkTitleExtents] } : {}
	};
}
function lowerHeading(node, context) {
	const inline = lowerInlineNodes(node.children, inlineContext(context));
	return [decorateParagraph({
		kind: "paragraph",
		...paragraphWithConstructs(inline.runs, inline.linkTitleExtents),
		styleId: headingStyleId(node.level),
		headingLevel: node.level
	}, context)];
}
function lowerParagraph(node, context) {
	const blocks = [];
	const inlineCtx = inlineContext(context);
	let segment = [];
	const flushSegment = (force) => {
		if (segment.length === 0 && !force) return;
		const inline = lowerInlineNodes(segment, inlineCtx);
		blocks.push(decorateParagraph({
			kind: "paragraph",
			...paragraphWithConstructs(inline.runs, inline.linkTitleExtents)
		}, context));
		segment = [];
	};
	for (const child of node.children) {
		if (child.type !== "image") {
			segment.push(child);
			continue;
		}
		const resolved = resolveMarkdownImage(child.destination, {
			alt: child.alt,
			title: child.title
		}, context.images);
		if (resolved === void 0) {
			context.sink({
				code: MarkdownDiagnosticCodes.IMAGE_UNRESOLVED,
				severity: "info",
				message: `image "${child.destination}" could not be resolved to real bytes; it degrades to a text run of its own alt text, hyperlinked at its own destination`
			});
			segment.push(child);
			continue;
		}
		flushSegment(false);
		if (context.list !== void 0) context.sink({
			code: MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED,
			severity: "info",
			message: "a resolved image block directly inside a list item has no ContentListMembership field of its own -- only ContentParagraph carries .list -- so its association with the enclosing list item is lost"
		});
		const image = {
			kind: "image",
			format: resolved.format,
			base64: resolved.base64,
			widthPt: resolved.widthPt,
			heightPt: resolved.heightPt,
			...child.alt.length > 0 ? { altText: child.alt } : {}
		};
		if (child.title === void 0) {
			blocks.push(image);
			continue;
		}
		blocks.push({
			kind: "constructStart",
			descriptor: {
				kind: "link",
				target: {
					kind: "external",
					uri: child.destination
				},
				title: child.title
			}
		}, image, { kind: "constructEnd" });
	}
	flushSegment(blocks.length === 0);
	return blocks;
}
function splitInfoString(infoString) {
	const firstWhitespace = infoString.search(/\s/);
	if (firstWhitespace === -1) return infoString.startsWith("{") ? {
		language: void 0,
		remainder: infoString
	} : {
		language: infoString,
		remainder: void 0
	};
	const firstWord = infoString.slice(0, firstWhitespace);
	const remainder = infoString.slice(firstWhitespace).trim();
	if (firstWord.startsWith("{")) return {
		language: void 0,
		remainder: infoString.trim()
	};
	return {
		language: firstWord,
		remainder: remainder.length > 0 ? remainder : void 0
	};
}
function lowerCodeBlock(node, context) {
	const info = node.fenced && node.infoString !== void 0 && node.infoString.length > 0 ? splitInfoString(node.infoString) : {
		language: void 0,
		remainder: void 0
	};
	return [decorateParagraph({
		kind: "paragraph",
		runs: [lowerCodeBlockRun(node.literal.replace(/\n$/, ""))],
		styleId: CODE_BLOCK_STYLE_ID,
		...info.language !== void 0 ? { codeLanguage: info.language } : {},
		...info.remainder !== void 0 ? { source: {
			format: "markdown",
			xml: info.remainder
		} } : {}
	}, context)];
}
function lowerThematicBreak(context) {
	return [decorateParagraph({
		kind: "paragraph",
		runs: [],
		styleId: HORIZONTAL_RULE_STYLE_ID
	}, context)];
}
function lowerHtmlBlock(node, context) {
	if (context.rawHtmlMode === "drop") {
		context.sink({
			code: MarkdownDiagnosticCodes.RAW_HTML_DROPPED,
			severity: "info",
			message: "block-level raw HTML was dropped per the rawHtml: \"drop\" option"
		});
		return [];
	}
	context.sink({
		code: MarkdownDiagnosticCodes.RAW_HTML_PRESERVED_AS_TEXT,
		severity: "info",
		message: "block-level raw HTML was preserved as literal text (styleId \"HTMLPreformatted\"); it will not be rendered as HTML by any consumer of the resulting ContentDocument, and its verbatim original rides the paragraph's own markdown residue for this package's writer to re-emit as-is"
	});
	const literal = node.literal.replace(/\n+$/, "");
	return [decorateParagraph({
		kind: "paragraph",
		runs: literal.length === 0 ? [] : [{ text: literal }],
		styleId: HTML_PREFORMATTED_STYLE_ID,
		source: {
			format: "markdown",
			xml: node.literal
		}
	}, context)];
}
function lowerMathBlock(node, context) {
	if (context.list !== void 0) context.sink({
		code: MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED,
		severity: "info",
		message: "a display-math block directly inside a list item has no ContentListMembership field of its own -- only ContentParagraph carries .list -- so its association with the enclosing list item is lost"
	});
	return [{
		kind: "embeddedObject",
		objectKind: "formula",
		document: {
			kind: "formula",
			metadata: {},
			formula: {
				mathml: [],
				presentation: { latex: node.literal.replace(/\n$/, "") }
			}
		},
		frame: {
			xPt: 0,
			yPt: 0,
			widthPt: 0,
			heightPt: 0
		}
	}];
}
function blockquoteSubtreeContainsHeading(node) {
	const walk = (block) => {
		switch (block.type) {
			case "heading": return true;
			case "blockquote":
			case "list":
			case "listItem": return block.children.some(walk);
			default: return false;
		}
	};
	return node.children.some(walk);
}
function lowerBlockquote(node, context, contentWidthPt) {
	const nested = {
		...context,
		quoteDepth: context.quoteDepth + 1
	};
	const blocks = node.children.flatMap((child) => lowerBlock(child, nested, contentWidthPt));
	const inner = blocks.length === 0 ? [decorateParagraph({
		kind: "paragraph",
		runs: []
	}, nested)] : blocks;
	if (blockquoteSubtreeContainsHeading(node)) {
		context.sink({
			code: MarkdownDiagnosticCodes.BLOCKQUOTE_CONTAINER_SKIPPED,
			severity: "info",
			message: "a blockquote containing a heading cannot carry its division construct -- a marker extent may not open a heading scope, and the last heading inside an extent always leaves one standing -- so this quote degrades to indent-only structure while the heading keeps its heading fidelity"
		});
		return inner;
	}
	return [
		{
			kind: "constructStart",
			descriptor: { kind: "division" }
		},
		...inner,
		{ kind: "constructEnd" }
	];
}
function lowerListItem(item, numId, level, context, contentWidthPt) {
	const membership = {
		numId,
		level,
		...item.checked !== void 0 ? { checked: item.checked } : {},
		itemId: mintListItemId(context.numIdState)
	};
	const itemContext = {
		...context,
		list: membership
	};
	const blocks = [];
	let ownLevelBlockCount = 0;
	for (const child of item.children) {
		if (child.type === "list") {
			blocks.push(...lowerList(child, numId, level + 1, context, contentWidthPt));
			continue;
		}
		const childBlocks = lowerBlock(child, itemContext, contentWidthPt);
		ownLevelBlockCount += childBlocks.length;
		blocks.push(...childBlocks);
	}
	if (ownLevelBlockCount === 0) blocks.unshift(decorateParagraph({
		kind: "paragraph",
		runs: []
	}, itemContext));
	return blocks;
}
function lowerList(node, ancestorNumId, level, context, contentWidthPt) {
	let numId;
	if (ancestorNumId === void 0) {
		const task = node.children.some((item) => item.checked !== void 0);
		numId = mintListNumId(context.numIdState, {
			type: node.markerType,
			start: node.start,
			task,
			loose: !node.tight
		});
	} else {
		numId = ancestorNumId;
		const mintedType = mintedListType(numId);
		if (mintedType !== void 0 && mintedType !== node.markerType) context.sink({
			code: MarkdownDiagnosticCodes.LIST_MARKER_TYPE_CONFLICT,
			severity: "warning",
			message: `a nested ${node.markerType} list sits under a list minted as ${mintedType}; the enclosing list's own marker type is kept (first-wins) and this nested list's own type is not separately represented`
		});
	}
	return node.children.flatMap((item) => lowerListItem(item, numId, level, context, contentWidthPt));
}
function flattenFootnoteBodyHeadings(node, context) {
	switch (node.type) {
		case "heading":
			context.sink({
				code: MarkdownDiagnosticCodes.FOOTNOTE_BODY_HEADING_FLATTENED,
				severity: "info",
				message: `a level-${String(node.level)} heading inside a footnote definition's body is carried as literal ATX text: a construct boundary marker's extent may not contain a block that opens or closes a heading scope, so the heading cannot stay a heading inside the anchor construct the definition lowers to`
			});
			return {
				type: "paragraph",
				children: [{
					type: "text",
					value: `${"#".repeat(node.level)} `
				}, ...node.children]
			};
		case "blockquote": return {
			type: "blockquote",
			children: node.children.map((child) => flattenFootnoteBodyHeadings(child, context))
		};
		case "list": return {
			...node,
			children: node.children.map((item) => flattenFootnoteBodyHeadingsInItem(item, context))
		};
		case "listItem": return flattenFootnoteBodyHeadingsInItem(node, context);
		default: return node;
	}
}
function flattenFootnoteBodyHeadingsInItem(item, context) {
	return {
		...item,
		children: item.children.map((child) => flattenFootnoteBodyHeadings(child, context))
	};
}
function lowerFootnoteDefinition(node, context, contentWidthPt) {
	const descriptor = {
		kind: "anchor",
		anchorType: "footnote",
		name: node.label
	};
	const body = node.children.flatMap((child) => lowerBlock(flattenFootnoteBodyHeadings(child, context), context, contentWidthPt));
	return [
		{
			kind: "constructStart",
			descriptor
		},
		...body,
		{ kind: "constructEnd" }
	];
}
function lowerBlock(node, context, contentWidthPt) {
	switch (node.type) {
		case "paragraph": return lowerParagraph(node, context);
		case "heading": return lowerHeading(node, context);
		case "blockquote": return lowerBlockquote(node, context, contentWidthPt);
		case "list": return lowerList(node, void 0, 0, context, contentWidthPt);
		case "codeBlock": return lowerCodeBlock(node, context);
		case "thematicBreak": return lowerThematicBreak(context);
		case "htmlBlock": return lowerHtmlBlock(node, context);
		case "mathBlock": return lowerMathBlock(node, context);
		case "footnoteDefinition": return lowerFootnoteDefinition(node, context, contentWidthPt);
		case "table":
			if (context.list !== void 0) context.sink({
				code: MarkdownDiagnosticCodes.LIST_ITEM_BLOCK_UNLISTED,
				severity: "info",
				message: "a table directly inside a list item has no ContentListMembership field of its own -- only ContentParagraph carries .list -- so its association with the enclosing list item is lost"
			});
			return [lowerTable(node, contentWidthPt, inlineContext(context))];
		case "document":
		case "listItem":
		case "tableRow":
		case "tableCell": return [];
	}
}
function lowerParsedMarkdown(parsed, options = {}, metadata = {}) {
	const sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
	sink({
		code: MarkdownDiagnosticCodes.INVENTED_PAGE_GEOMETRY,
		severity: "info",
		message: "markdown carries no page geometry of its own; the resulting ContentSection uses a synthesised page size and margins (ReadMarkdownOptions.pageSize/margins, or document-schema.js's own PAGE_SIZE_A4 default)"
	});
	const pageSize = options.pageSize ?? PAGE_SIZE_A4;
	const margins = options.margins ?? DEFAULT_MARGINS;
	const contentWidthPt = pageSize.widthPt - margins.leftPt - margins.rightPt;
	const context = {
		sink,
		images: options.images,
		rawHtmlMode: options.rawHtml ?? "preserve",
		numIdState: createNumIdMintState(),
		quoteDepth: 0,
		list: void 0
	};
	return {
		kind: "wordprocessing",
		metadata,
		sections: [{
			pageSize,
			margins,
			blocks: parsed.document.children.flatMap((child) => lowerBlock(child, context, contentWidthPt))
		}]
	};
}
function lowerMarkdown(source, options = {}) {
	if (options.maxInputBytes !== void 0) {
		const actualBytes = new TextEncoder().encode(source).length;
		if (actualBytes > options.maxInputBytes) throw new MarkdownInputTooLargeError(options.maxInputBytes, actualBytes);
	}
	const sink = options.sink ?? NOOP_MARKDOWN_DIAGNOSTIC_SINK;
	const { metadata, rest } = options.frontMatter ?? false ? extractFrontMatter(source, sink) : {
		metadata: {},
		rest: source
	};
	const parseOptions = {
		gfmTables: options.gfmTables,
		gfmAutolinks: options.gfmAutolinks,
		gfmStrikethrough: options.gfmStrikethrough,
		gfmTaskLists: options.gfmTaskLists,
		footnotes: options.footnotes,
		maxNesting: options.maxBlockNesting,
		sink
	};
	return lowerParsedMarkdown(parseMarkdown(rest, parseOptions), options, metadata);
}
//#endregion
export { lowerMarkdown, lowerParsedMarkdown };
