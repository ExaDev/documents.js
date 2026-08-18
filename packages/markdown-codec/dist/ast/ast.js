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
	"tableCell",
	"mathBlock",
	"footnoteDefinition"
]);
function isMarkdownBlockNode(node) {
	return BLOCK_NODE_TYPES.has(node.type);
}
function isMarkdownInlineNode(node) {
	return !BLOCK_NODE_TYPES.has(node.type);
}
//#endregion
export { isMarkdownBlockNode, isMarkdownInlineNode };
