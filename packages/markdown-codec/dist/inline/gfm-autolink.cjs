Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
const require_inline_node = require("./node.cjs");
//#region src/inline/gfm-autolink.ts
const DOMAIN_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const MIN_DOMAIN_SEGMENTS = 2;
const VALID_PRECEDING_CHARACTERS = /* @__PURE__ */ new Set([
	"*",
	"_",
	"~",
	"("
]);
const TRAILING_PUNCTUATION = /* @__PURE__ */ new Set([
	"?",
	"!",
	".",
	",",
	":",
	"*",
	"_",
	"~"
]);
const EMAIL_LOCAL_PART_PATTERN = /[A-Za-z0-9._+-]/;
const EMAIL_DOMAIN_PATTERN = /[A-Za-z0-9._-]/;
const ENTITY_TAIL_PATTERN = /&[A-Za-z0-9]+;$/;
const WWW_PREFIX = "www.";
const URL_SCHEME_PREFIXES = [
	"http://",
	"https://",
	"ftp://"
];
const PROTOCOL_PREFIXES = ["mailto:", "xmpp:"];
const OPAQUE_KINDS = /* @__PURE__ */ new Set([
	"link",
	"image",
	"codeSpan",
	"rawHtml",
	"autolink"
]);
function isWhitespace(char) {
	return char === "" || char === " " || char === "	" || char === "\n" || char === "\r" || char === "\f";
}
function isValidStartBoundary(text, index) {
	if (index === 0) return true;
	const before = text.charAt(index - 1);
	return isWhitespace(before) || VALID_PRECEDING_CHARACTERS.has(before);
}
function isValidDomain(domain) {
	const segments = domain.split(".");
	if (segments.length < MIN_DOMAIN_SEGMENTS) return false;
	if (!segments.every((segment) => DOMAIN_SEGMENT_PATTERN.test(segment))) return false;
	return segments.slice(-2).every((segment) => !segment.includes("_"));
}
function trimTrailingPunctuation(candidate) {
	let end = candidate.length;
	for (;;) {
		const before = end;
		while (end > 0 && TRAILING_PUNCTUATION.has(candidate.charAt(end - 1))) end -= 1;
		if (end > 0 && candidate.charAt(end - 1) === ")") {
			const slice = candidate.slice(0, end);
			if (slice.split(")").length > slice.split("(").length) end -= 1;
		}
		if (end > 0 && candidate.charAt(end - 1) === ";") {
			const entityTail = ENTITY_TAIL_PATTERN.exec(candidate.slice(0, end));
			if (entityTail !== null) end -= entityTail[0].length;
		}
		if (end === before) return candidate.slice(0, end);
	}
}
function scanRawCandidate(text, start) {
	let end = start;
	while (end < text.length && !isWhitespace(text.charAt(end)) && text.charAt(end) !== "<") end += 1;
	return text.slice(start, end);
}
function matchPrefixed(text, index, prefixLength, destinationPrefix, requireValidDomain) {
	const trimmed = trimTrailingPunctuation(scanRawCandidate(text, index));
	if (trimmed.length <= prefixLength) return;
	if (requireValidDomain) {
		if (!isValidDomain(trimmed.slice(prefixLength).split(/[/?#]/)[0] ?? "")) return;
	}
	return {
		text: trimmed,
		destination: destinationPrefix + trimmed,
		start: index
	};
}
function scanEmailDomain(text, start) {
	let end = start;
	while (end < text.length && EMAIL_DOMAIN_PATTERN.test(text.charAt(end))) end += 1;
	return text.slice(start, end);
}
function matchEmailAt(text, atIndex) {
	let start = atIndex;
	while (start > 0 && EMAIL_LOCAL_PART_PATTERN.test(text.charAt(start - 1))) start -= 1;
	if (start === atIndex || !isValidStartBoundary(text, start)) return;
	const local = text.slice(start, atIndex);
	if (local.startsWith(".") || local.endsWith(".")) return;
	const domain = scanEmailDomain(text, atIndex + 1).replace(/\.+$/, "");
	if (domain.endsWith("-") || domain.endsWith("_") || !isValidDomain(domain)) return;
	const address = `${local}@${domain}`;
	return {
		text: address,
		destination: `mailto:${address}`,
		start
	};
}
function startsWithIgnoringCase(text, index, prefix) {
	return text.slice(index, index + prefix.length).toLowerCase() === prefix;
}
function findAutolinkAt(text, index) {
	if (text.charAt(index) === "@") return matchEmailAt(text, index);
	if (!isValidStartBoundary(text, index)) return;
	if (startsWithIgnoringCase(text, index, WWW_PREFIX)) return matchPrefixed(text, index, 4, "http://", true);
	for (const prefix of URL_SCHEME_PREFIXES) if (startsWithIgnoringCase(text, index, prefix)) return matchPrefixed(text, index, prefix.length, "", true);
	for (const prefix of PROTOCOL_PREFIXES) if (startsWithIgnoringCase(text, index, prefix)) return matchPrefixed(text, index, prefix.length, "", false);
}
function expandTextNode(node) {
	const text = node.literal;
	let cursor = 0;
	let anchor = node;
	let matches = 0;
	let index = 0;
	while (index < text.length) {
		const found = findAutolinkAt(text, index);
		if (found === void 0 || found.start < cursor) {
			index += 1;
			continue;
		}
		if (found.start > cursor) {
			const before = require_inline_node.createTextNode(text.slice(cursor, found.start));
			anchor.insertAfter(before);
			anchor = before;
		}
		const link = new require_inline_node.InlineNode("link");
		link.destination = found.destination;
		link.appendChild(require_inline_node.createTextNode(found.text));
		anchor.insertAfter(link);
		anchor = link;
		cursor = found.start + found.text.length;
		matches += 1;
		index = cursor;
	}
	if (matches === 0) return;
	if (cursor < text.length) anchor.insertAfter(require_inline_node.createTextNode(text.slice(cursor)));
	node.unlink();
}
function applyGfmAutolinks(root) {
	let child = root.firstChild;
	while (child !== void 0) {
		const following = child.next;
		if (child.kind === "text") expandTextNode(child);
		else if (!OPAQUE_KINDS.has(child.kind)) applyGfmAutolinks(child);
		child = following;
	}
}
//#endregion
exports.applyGfmAutolinks = applyGfmAutolinks;
