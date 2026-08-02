import { HTML_ENTITY_TABLE } from "../scan/entity-table.js";
import { isAsciiPunctuation } from "./chars.js";
//#region src/inline/entity.ts
const REPLACEMENT_CHARACTER = "�";
const MAX_CODEPOINT = 1114111;
const SURROGATE_FIRST = 55296;
const SURROGATE_LAST = 57343;
const ENTITY_PATTERN = /^&(?:#[Xx]([0-9A-Fa-f]{1,6})|#([0-9]{1,7})|([A-Za-z][A-Za-z0-9]{1,31}));/;
function codepointToString(codepoint) {
	if (codepoint === 0 || codepoint > MAX_CODEPOINT || codepoint >= SURROGATE_FIRST && codepoint <= SURROGATE_LAST) return REPLACEMENT_CHARACTER;
	return String.fromCodePoint(codepoint);
}
function matchEntity(text, start) {
	if (text.charAt(start) !== "&") return;
	const match = ENTITY_PATTERN.exec(text.slice(start));
	if (match === null) return;
	const [raw, hex, decimal, name] = match;
	if (hex !== void 0) return {
		raw,
		value: codepointToString(Number.parseInt(hex, 16))
	};
	if (decimal !== void 0) return {
		raw,
		value: codepointToString(Number.parseInt(decimal, 10))
	};
	if (name === void 0) return;
	const resolved = HTML_ENTITY_TABLE[name];
	if (resolved === void 0) return;
	return {
		raw,
		value: resolved
	};
}
function unescapeString(text) {
	if (!text.includes("\\") && !text.includes("&")) return text;
	let result = "";
	let index = 0;
	while (index < text.length) {
		const char = text.charAt(index);
		if (char === "\\") {
			const next = text.charAt(index + 1);
			if (isAsciiPunctuation(next)) {
				result += next;
				index += 2;
				continue;
			}
			result += char;
			index += 1;
			continue;
		}
		if (char === "&") {
			const entity = matchEntity(text, index);
			if (entity !== void 0) {
				result += entity.value;
				index += entity.raw.length;
				continue;
			}
		}
		result += char;
		index += 1;
	}
	return result;
}
//#endregion
export { matchEntity, unescapeString };
