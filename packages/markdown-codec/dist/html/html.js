//#region src/html/html.ts
const TAG_NAME = "[A-Za-z][A-Za-z0-9-]*";
const OPEN_TAG = `<${TAG_NAME}(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^"'=<>\`\\x00-\\x20]+|'[^']*'|"[^"]*"))?)*\\s*/?>`;
const CLOSING_TAG = `</${TAG_NAME}\\s*>`;
const HTML_TAG_PATTERN = new RegExp(`^(?:${OPEN_TAG}|${CLOSING_TAG}|<!-->|<!--->|<!--[\\s\\S]*?-->|<\\?[\\s\\S]*?\\?>|<![A-Za-z][^>]*>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>)`);
function matchHtmlTag(text, start) {
	if (text.charAt(start) !== "<") return;
	const match = HTML_TAG_PATTERN.exec(text.slice(start));
	return match === null ? void 0 : match[0];
}
const HTML_BLOCK_START_PATTERNS = [
	/^(?!)/,
	/^<(?:pre|script|style|textarea)(?:[ \t]|>|$)/i,
	/^<!--/,
	/^<\?/,
	/^<![A-Za-z]/,
	/^<!\[CDATA\[/,
	new RegExp(`^</?(?:${[
		"address",
		"article",
		"aside",
		"base",
		"basefont",
		"blockquote",
		"body",
		"caption",
		"center",
		"col",
		"colgroup",
		"dd",
		"details",
		"dialog",
		"dir",
		"div",
		"dl",
		"dt",
		"fieldset",
		"figcaption",
		"figure",
		"footer",
		"form",
		"frame",
		"frameset",
		"h1",
		"h2",
		"h3",
		"h4",
		"h5",
		"h6",
		"head",
		"header",
		"hr",
		"html",
		"iframe",
		"legend",
		"li",
		"link",
		"main",
		"menu",
		"menuitem",
		"nav",
		"noframes",
		"ol",
		"optgroup",
		"option",
		"p",
		"param",
		"search",
		"section",
		"summary",
		"table",
		"tbody",
		"td",
		"tfoot",
		"th",
		"thead",
		"title",
		"tr",
		"track",
		"ul"
	].join("|")})(?:[ \\t]|/?>|$)`, "i"),
	new RegExp(`^(?:${OPEN_TAG}|${CLOSING_TAG})[ \\t]*$`, "i")
];
const HTML_BLOCK_END_PATTERNS = [
	/^(?!)/,
	/<\/(?:pre|script|style|textarea)>/i,
	/-->/,
	/\?>/,
	/>/,
	/\]\]>/
];
const HTML_BLOCK_TYPES = [
	1,
	2,
	3,
	4,
	5,
	6,
	7
];
const LAST_HTML_BLOCK_TYPE = 7;
function matchHtmlBlockStart(line, interruptsParagraph) {
	if (!line.startsWith("<")) return;
	for (const type of HTML_BLOCK_TYPES) {
		if (type === LAST_HTML_BLOCK_TYPE && interruptsParagraph) continue;
		if (HTML_BLOCK_START_PATTERNS[type]?.test(line) === true) return type;
	}
}
function matchesHtmlBlockEnd(line, type) {
	return HTML_BLOCK_END_PATTERNS[type]?.test(line) === true;
}
//#endregion
export { matchHtmlBlockStart, matchHtmlTag, matchesHtmlBlockEnd };
