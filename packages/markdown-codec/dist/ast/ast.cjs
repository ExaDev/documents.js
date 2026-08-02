Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/ast/ast.ts
const BLOCK_NODE_TYPES = /* @__PURE__ */ new Set([
	"document",
	"paragraph",
	"heading",
	"blockquote",
	"list",
	"listItem",
	"codeBlock",
	"thematicBreak",
	"htmlBlock",
	"table",
	"tableRow",
	"tableCell"
]);
function isMarkdownBlockNode(node) {
	return BLOCK_NODE_TYPES.has(node.type);
}
function isMarkdownInlineNode(node) {
	return !BLOCK_NODE_TYPES.has(node.type);
}
//#endregion
exports.isMarkdownBlockNode = isMarkdownBlockNode;
exports.isMarkdownInlineNode = isMarkdownInlineNode;
