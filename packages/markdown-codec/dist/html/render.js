//#region src/html/render.ts
const HREF_SAFE_PUNCTUATION = /* @__PURE__ */ new Set([
	"-",
	"_",
	".",
	"+",
	"!",
	"*",
	"(",
	")",
	",",
	"%",
	"#",
	"@",
	"?",
	"=",
	";",
	":",
	"/",
	"$",
	"~"
]);
const ALPHANUMERIC_PATTERN = /^[A-Za-z0-9]$/;
const HEX_RADIX = 16;
const PERCENT_ESCAPE_DIGITS = 2;
const DEFAULT_ORDERED_LIST_START = 1;
function escapeHtml(text) {
	return text.replace(/[&<>"]/g, (char) => {
		switch (char) {
			case "&": return "&amp;";
			case "<": return "&lt;";
			case ">": return "&gt;";
			default: return "&quot;";
		}
	});
}
function escapeHref(href) {
	const bytes = new TextEncoder().encode(href);
	let result = "";
	for (const byte of bytes) {
		const char = String.fromCharCode(byte);
		if (byte < 128 && (ALPHANUMERIC_PATTERN.test(char) || HREF_SAFE_PUNCTUATION.has(char))) {
			result += char;
			continue;
		}
		if (char === "&") {
			result += "&amp;";
			continue;
		}
		if (char === "'") {
			result += "&#x27;";
			continue;
		}
		result += `%${byte.toString(HEX_RADIX).toUpperCase().padStart(PERCENT_ESCAPE_DIGITS, "0")}`;
	}
	return result;
}
function renderTitleAttribute(title) {
	return title === void 0 ? "" : ` title="${escapeHtml(title)}"`;
}
function renderAlignmentAttribute(alignment) {
	return alignment === void 0 || alignment === "none" ? "" : ` align="${alignment}"`;
}
function renderTaskCheckbox(checked) {
	return checked ? "<input checked=\"\" disabled=\"\" type=\"checkbox\"> " : "<input disabled=\"\" type=\"checkbox\"> ";
}
function renderInline(node) {
	switch (node.type) {
		case "text": return escapeHtml(node.value);
		case "entity": return escapeHtml(node.value);
		case "codeSpan": return `<code>${escapeHtml(node.literal)}</code>`;
		case "emphasis": return `<em>${renderInlines(node.children)}</em>`;
		case "strong": return `<strong>${renderInlines(node.children)}</strong>`;
		case "strikethrough": return `<del>${renderInlines(node.children)}</del>`;
		case "link": return `<a href="${escapeHref(node.destination)}"${renderTitleAttribute(node.title)}>${renderInlines(node.children)}</a>`;
		case "image": return `<img src="${escapeHref(node.destination)}" alt="${escapeHtml(node.alt)}"${renderTitleAttribute(node.title)} />`;
		case "autolink": return `<a href="${escapeHref(node.email ? `mailto:${node.destination}` : node.destination)}">${escapeHtml(node.destination)}</a>`;
		case "rawHtml": return node.literal;
		case "hardBreak": return "<br />\n";
		case "softBreak": return "\n";
		case "mathInline": return `\\(${escapeHtml(node.literal)}\\)`;
	}
}
function renderInlines(nodes) {
	return nodes.map(renderInline).join("");
}
var HtmlRenderer = class {
	out = "";
	render(blocks, tight) {
		for (const block of blocks) this.renderBlock(block, tight);
	}
	result() {
		return this.out;
	}
	cr() {
		if (this.out.length > 0 && !this.out.endsWith("\n")) this.out += "\n";
	}
	renderBlock(node, tight) {
		switch (node.type) {
			case "paragraph":
				if (tight) {
					this.out += renderInlines(node.children);
					return;
				}
				this.cr();
				this.out += `<p>${renderInlines(node.children)}</p>\n`;
				return;
			case "heading":
				this.cr();
				this.out += `<h${String(node.level)}>${renderInlines(node.children)}</h${String(node.level)}>\n`;
				return;
			case "thematicBreak":
				this.cr();
				this.out += "<hr />\n";
				return;
			case "codeBlock":
				this.renderCodeBlock(node.infoString, node.literal);
				return;
			case "htmlBlock":
				this.cr();
				this.out += node.literal;
				this.cr();
				return;
			case "blockquote":
				this.cr();
				this.out += "<blockquote>\n";
				this.render(node.children, false);
				this.cr();
				this.out += "</blockquote>\n";
				return;
			case "list":
				this.renderList(node);
				return;
			case "table":
				this.renderTable(node);
				return;
			case "mathBlock":
				this.cr();
				this.out += `$$\n${escapeHtml(node.literal)}\n$$\n`;
				this.cr();
				return;
			case "document":
			case "listItem":
			case "tableRow":
			case "tableCell": return;
		}
	}
	renderCodeBlock(infoString, literal) {
		this.cr();
		const language = infoString === void 0 ? "" : infoString.split(/[ \t]/)[0] ?? "";
		const attribute = language.length === 0 ? "" : ` class="language-${escapeHtml(language)}"`;
		this.out += `<pre><code${attribute}>${escapeHtml(literal)}</code></pre>\n`;
	}
	renderList(node) {
		this.cr();
		const start = node.start ?? DEFAULT_ORDERED_LIST_START;
		const orderedOpenTag = start === DEFAULT_ORDERED_LIST_START ? "<ol>" : `<ol start="${String(start)}">`;
		this.out += `${node.markerType === "bullet" ? "<ul>" : orderedOpenTag}\n`;
		for (const item of node.children) {
			this.cr();
			this.out += "<li>";
			if (item.checked !== void 0) this.out += renderTaskCheckbox(item.checked);
			this.render(item.children, node.tight);
			this.out += "</li>\n";
		}
		this.out += node.markerType === "bullet" ? "</ul>\n" : "</ol>\n";
	}
	renderTable(node) {
		this.cr();
		this.out += "<table>\n";
		const [header, ...body] = node.children;
		if (header !== void 0) {
			this.out += "<thead>\n<tr>\n";
			for (const [index, cell] of header.children.entries()) this.out += `<th${renderAlignmentAttribute(node.alignments[index])}>${renderInlines(cell.children)}</th>\n`;
			this.out += "</tr>\n</thead>\n";
		}
		if (body.length > 0) {
			this.out += "<tbody>\n";
			for (const row of body) {
				this.out += "<tr>\n";
				for (const [index, cell] of row.children.entries()) this.out += `<td${renderAlignmentAttribute(node.alignments[index])}>${renderInlines(cell.children)}</td>\n`;
				this.out += "</tr>\n";
			}
			this.out += "</tbody>\n";
		}
		this.out += "</table>\n";
	}
};
function renderDocumentToHtml(document) {
	const renderer = new HtmlRenderer();
	renderer.render(document.children, false);
	return renderer.result();
}
//#endregion
export { escapeHref, escapeHtml, renderDocumentToHtml, renderInlines };
