Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_inline_footnote = require("./footnote.cjs");
const require_html_html = require("../html/html.cjs");
const require_inline_chars = require("./chars.cjs");
const require_inline_entity = require("./entity.cjs");
const require_inline_delimiter = require("./delimiter.cjs");
const require_inline_node = require("./node.cjs");
const require_inline_gfm_autolink = require("./gfm-autolink.cjs");
const require_inline_link = require("./link.cjs");
const require_inline_math = require("./math.cjs");
//#region src/inline/inline.ts
const PLAIN_TEXT_PATTERN = /[^\n`[\]\\!<&*_~]+/y;
const URI_AUTOLINK_PATTERN = /<[A-Za-z][A-Za-z0-9.+-]{1,31}:[^<>]*>/y;
const EMAIL_AUTOLINK_PATTERN = /<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/y;
const HARD_BREAK_SPACES = "  ";
const EMPTY_LABEL_LENGTH = 2;
function stripOneSurroundingSpace(content) {
	if (content.startsWith(" ") && content.endsWith(" ") && /[^ ]/.test(content)) return content.slice(1, content.length - 1);
	return content;
}
function createWrapper(kind, marker) {
	const node = new require_inline_node.InlineNode(kind);
	if (marker !== "~") node.marker = marker;
	return node;
}
var InlineParser = class {
	text;
	references;
	footnotes;
	gfmStrikethrough;
	container = new require_inline_node.InlineNode("container");
	delimiters = new require_inline_delimiter.DelimiterStack();
	brackets;
	pos = 0;
	constructor(text, references, footnotes, options) {
		this.text = text;
		this.references = references;
		this.footnotes = footnotes;
		this.gfmStrikethrough = options.gfmStrikethrough ?? true;
	}
	parse() {
		while (this.pos < this.text.length) this.step();
		require_inline_delimiter.processEmphasis(this.delimiters, void 0, createWrapper);
		mergeAdjacentText(this.container);
		return this.container;
	}
	step() {
		const char = this.text.charAt(this.pos);
		switch (char) {
			case "\n":
				this.parseLineBreak();
				return;
			case "\\":
				this.parseBackslash();
				return;
			case "`":
				this.parseCodeSpan();
				return;
			case "<":
				this.parseAngleBracket();
				return;
			case "&":
				this.parseEntity();
				return;
			case "[":
				this.parseOpenBracket();
				return;
			case "!":
				this.parseBang();
				return;
			case "]":
				this.parseCloseBracket();
				return;
			default:
				if (require_inline_delimiter.isDelimiterChar(char)) {
					this.parseDelimiterRun(char);
					return;
				}
				this.parsePlainText();
		}
	}
	appendText(literal) {
		const node = require_inline_node.createTextNode(literal);
		this.container.appendChild(node);
		return node;
	}
	parsePlainText() {
		PLAIN_TEXT_PATTERN.lastIndex = this.pos;
		const match = PLAIN_TEXT_PATTERN.exec(this.text);
		if (match === null) {
			this.appendText(this.text.charAt(this.pos));
			this.pos += 1;
			return;
		}
		this.appendText(match[0]);
		this.pos += match[0].length;
	}
	parseLineBreak() {
		this.pos += 1;
		const last = this.container.lastChild;
		if (last?.kind === "text" && last.literal.endsWith(" ")) {
			const hard = last.literal.endsWith(HARD_BREAK_SPACES);
			last.literal = last.literal.replace(/ +$/, "");
			this.container.appendChild(new require_inline_node.InlineNode(hard ? "hardBreak" : "softBreak"));
		} else this.container.appendChild(new require_inline_node.InlineNode("softBreak"));
		while (this.text.charAt(this.pos) === " ") this.pos += 1;
	}
	parseBackslash() {
		const backslashIndex = this.pos;
		this.pos += 1;
		const next = this.text.charAt(this.pos);
		if (next === "\n") {
			this.pos += 1;
			this.container.appendChild(new require_inline_node.InlineNode("hardBreak"));
			return;
		}
		if (next === "(") {
			const span = require_inline_math.matchMathInlineSpan(this.text, backslashIndex);
			if (span !== void 0) {
				const node = new require_inline_node.InlineNode("mathInline");
				node.literal = span.slice(2, span.length - 2);
				this.container.appendChild(node);
				this.pos = backslashIndex + span.length;
				return;
			}
		}
		if (require_inline_chars.isAsciiPunctuation(next)) {
			this.appendText(next);
			this.pos += 1;
			return;
		}
		this.appendText("\\");
	}
	parseCodeSpan() {
		const start = this.pos;
		let openLength = 0;
		while (this.text.charAt(start + openLength) === "`") openLength += 1;
		const afterOpen = start + openLength;
		let scan = afterOpen;
		while (scan < this.text.length) {
			if (this.text.charAt(scan) !== "`") {
				scan += 1;
				continue;
			}
			let runLength = 0;
			while (this.text.charAt(scan + runLength) === "`") runLength += 1;
			if (runLength === openLength) {
				const node = new require_inline_node.InlineNode("codeSpan");
				node.literal = stripOneSurroundingSpace(this.text.slice(afterOpen, scan).replace(/\n/g, " "));
				this.container.appendChild(node);
				this.pos = scan + runLength;
				return;
			}
			scan += runLength;
		}
		this.appendText(this.text.slice(start, afterOpen));
		this.pos = afterOpen;
	}
	parseAngleBracket() {
		const uri = this.matchUriAutolink();
		if (uri !== void 0) {
			const node = new require_inline_node.InlineNode("autolink");
			node.destination = uri;
			this.container.appendChild(node);
			this.pos += uri.length + 2;
			return;
		}
		EMAIL_AUTOLINK_PATTERN.lastIndex = this.pos;
		const email = EMAIL_AUTOLINK_PATTERN.exec(this.text);
		const address = email?.[1];
		if (email !== null && address !== void 0) {
			const node = new require_inline_node.InlineNode("autolink");
			node.destination = address;
			node.email = true;
			this.container.appendChild(node);
			this.pos += email[0].length;
			return;
		}
		const tag = require_html_html.matchHtmlTag(this.text, this.pos);
		if (tag !== void 0) {
			const node = new require_inline_node.InlineNode("rawHtml");
			node.literal = tag;
			this.container.appendChild(node);
			this.pos += tag.length;
			return;
		}
		this.appendText("<");
		this.pos += 1;
	}
	matchUriAutolink() {
		URI_AUTOLINK_PATTERN.lastIndex = this.pos;
		const match = URI_AUTOLINK_PATTERN.exec(this.text);
		if (match === null) return;
		const uri = match[0].slice(1, match[0].length - 1);
		return require_inline_chars.containsAsciiControlOrSpace(uri) ? void 0 : uri;
	}
	parseEntity() {
		const entity = require_inline_entity.matchEntity(this.text, this.pos);
		if (entity === void 0) {
			this.appendText("&");
			this.pos += 1;
			return;
		}
		const node = new require_inline_node.InlineNode("entity");
		node.raw = entity.raw;
		node.literal = entity.value;
		this.container.appendChild(node);
		this.pos += entity.raw.length;
	}
	parseDelimiterRun(char) {
		if (char === "~" && !this.gfmStrikethrough) {
			this.parseLiteralRun(char);
			return;
		}
		const run = require_inline_delimiter.scanDelimiterRun(this.text, this.pos, char);
		if (run === void 0) {
			this.parseLiteralRun(char);
			return;
		}
		const node = this.appendText(this.text.slice(this.pos, this.pos + run.count));
		this.pos += run.count;
		if (run.canOpen || run.canClose) this.delimiters.push(char, run, node);
	}
	parseLiteralRun(char) {
		let length = 0;
		while (this.text.charAt(this.pos + length) === char) length += 1;
		this.appendText(this.text.slice(this.pos, this.pos + length));
		this.pos += length;
	}
	pushBracket(node, index, image) {
		if (this.brackets !== void 0) this.brackets.bracketAfter = true;
		this.brackets = {
			node,
			previous: this.brackets,
			previousDelimiter: this.delimiters.top,
			index,
			image,
			active: true,
			bracketAfter: false
		};
	}
	parseOpenBracket() {
		const start = this.pos;
		const footnote = this.matchFootnoteReference();
		if (footnote !== void 0) {
			const node = new require_inline_node.InlineNode("footnoteReference");
			node.label = footnote.label;
			this.container.appendChild(node);
			this.pos = footnote.end;
			return;
		}
		this.pos += 1;
		this.pushBracket(this.appendText("["), start, false);
	}
	matchFootnoteReference() {
		const match = require_inline_footnote.matchFootnoteLabel(this.text, this.pos);
		if (match === void 0 || !this.footnotes.has(match.label)) return;
		return match;
	}
	parseBang() {
		const start = this.pos;
		this.pos += 1;
		if (this.text.charAt(this.pos) !== "[") {
			this.appendText("!");
			return;
		}
		if (this.matchFootnoteReference() !== void 0) {
			this.appendText("!");
			return;
		}
		this.pos += 1;
		this.pushBracket(this.appendText("!["), start + 1, true);
	}
	parseCloseBracket() {
		this.pos += 1;
		const afterCloseBracket = this.pos;
		const opener = this.brackets;
		if (opener === void 0) {
			this.appendText("]");
			return;
		}
		if (!opener.active) {
			this.brackets = opener.previous;
			this.appendText("]");
			return;
		}
		const target = this.resolveInlineLink() ?? this.resolveReferenceLink(opener, afterCloseBracket);
		if (target === void 0) {
			this.brackets = opener.previous;
			this.pos = afterCloseBracket;
			this.appendText("]");
			return;
		}
		const node = new require_inline_node.InlineNode(opener.image ? "image" : "link");
		node.destination = target.destination;
		node.title = target.title;
		let moving = opener.node.next;
		while (moving !== void 0) {
			const following = moving.next;
			node.appendChild(moving);
			moving = following;
		}
		this.container.appendChild(node);
		require_inline_delimiter.processEmphasis(this.delimiters, opener.previousDelimiter, createWrapper);
		this.brackets = opener.previous;
		opener.node.unlink();
		if (!opener.image) {
			let earlier = this.brackets;
			while (earlier !== void 0) {
				if (!earlier.image) earlier.active = false;
				earlier = earlier.previous;
			}
		}
	}
	resolveInlineLink() {
		if (this.text.charAt(this.pos) !== "(") return;
		const start = this.pos;
		const destination = require_inline_link.parseLinkDestination(this.text, require_inline_link.skipInlineWhitespace(this.text, start + 1));
		if (destination === void 0) {
			this.pos = start;
			return;
		}
		const afterDestination = destination.end;
		let cursor = require_inline_link.skipInlineWhitespace(this.text, afterDestination);
		let title;
		if (cursor > afterDestination) {
			title = require_inline_link.parseLinkTitle(this.text, cursor);
			if (title !== void 0) cursor = require_inline_link.skipInlineWhitespace(this.text, title.end);
		}
		if (this.text.charAt(cursor) !== ")") {
			this.pos = start;
			return;
		}
		this.pos = cursor + 1;
		return {
			destination: destination.value,
			title: title?.value
		};
	}
	resolveReferenceLink(opener, afterCloseBracket) {
		const labelStart = this.pos;
		const labelLength = require_inline_link.matchLinkLabel(this.text, labelStart);
		let label;
		if (labelLength > EMPTY_LABEL_LENGTH) label = this.text.slice(labelStart, labelStart + labelLength);
		else if (!opener.bracketAfter) label = this.text.slice(opener.index, afterCloseBracket);
		if (labelLength > 0) this.pos = labelStart + labelLength;
		if (label === void 0) return;
		const definition = this.references.get(require_inline_link.normalizeLinkLabel(label));
		if (definition === void 0) {
			this.pos = labelStart;
			return;
		}
		return {
			destination: definition.destination,
			title: definition.title
		};
	}
};
function mergeAdjacentText(node) {
	let child = node.firstChild;
	while (child !== void 0) {
		if (child.kind === "text") {
			let following = child.next;
			while (following?.kind === "text") {
				child.literal += following.literal;
				const after = following.next;
				following.unlink();
				following = after;
			}
			child = child.next;
			continue;
		}
		mergeAdjacentText(child);
		child = child.next;
	}
}
function flattenToPlainText(node) {
	switch (node.kind) {
		case "text":
		case "codeSpan":
		case "rawHtml":
		case "entity": return node.literal;
		case "autolink": return node.destination;
		case "softBreak":
		case "hardBreak": return " ";
		case "footnoteReference": return `[^${node.label}]`;
		default: {
			let result = "";
			let child = node.firstChild;
			while (child !== void 0) {
				result += flattenToPlainText(child);
				child = child.next;
			}
			return result;
		}
	}
}
function toChildAstNodes(node) {
	const children = [];
	let child = node.firstChild;
	while (child !== void 0) {
		const converted = toAstNode(child);
		if (converted !== void 0) children.push(converted);
		child = child.next;
	}
	return children;
}
function toLinkAstNode(node) {
	const children = toChildAstNodes(node);
	if (node.title === void 0) return {
		type: "link",
		destination: node.destination,
		children
	};
	return {
		type: "link",
		destination: node.destination,
		title: node.title,
		children
	};
}
function toImageAstNode(node) {
	const alt = flattenToPlainText(node);
	if (node.title === void 0) return {
		type: "image",
		destination: node.destination,
		alt
	};
	return {
		type: "image",
		destination: node.destination,
		title: node.title,
		alt
	};
}
function toAstNode(node) {
	switch (node.kind) {
		case "text": return node.literal.length === 0 ? void 0 : {
			type: "text",
			value: node.literal
		};
		case "emphasis": return {
			type: "emphasis",
			marker: node.marker,
			children: toChildAstNodes(node)
		};
		case "strong": return {
			type: "strong",
			marker: node.marker,
			children: toChildAstNodes(node)
		};
		case "strikethrough": return {
			type: "strikethrough",
			children: toChildAstNodes(node)
		};
		case "codeSpan": return {
			type: "codeSpan",
			literal: node.literal
		};
		case "link": return toLinkAstNode(node);
		case "image": return toImageAstNode(node);
		case "autolink": return {
			type: "autolink",
			destination: node.destination,
			email: node.email
		};
		case "hardBreak": return { type: "hardBreak" };
		case "softBreak": return { type: "softBreak" };
		case "rawHtml": return {
			type: "rawHtml",
			literal: node.literal
		};
		case "entity": return {
			type: "entity",
			raw: node.raw,
			value: node.literal
		};
		case "mathInline": return {
			type: "mathInline",
			literal: node.literal
		};
		case "footnoteReference": return {
			type: "footnoteReference",
			label: node.label
		};
		case "container": return;
	}
}
function parseInlines(content, references, footnotes, options = {}) {
	const root = new InlineParser(content, references, footnotes, options).parse();
	if (options.gfmAutolinks ?? true) {
		require_inline_gfm_autolink.applyGfmAutolinks(root);
		mergeAdjacentText(root);
	}
	return toChildAstNodes(root);
}
//#endregion
exports.parseInlines = parseInlines;
