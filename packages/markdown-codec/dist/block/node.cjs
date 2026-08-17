Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/block/node.ts
var BlockNode = class {
	kind;
	parent;
	children = [];
	open = true;
	startLine = 0;
	content = "";
	lastLineBlank = false;
	lastLineChecked = false;
	level = 1;
	setext = false;
	fenced = false;
	fenceChar = "`";
	fenceLength = 0;
	fenceOffset = 0;
	infoString = "";
	literal = "";
	htmlBlockType = 1;
	listData;
	tight = true;
	alignments = [];
	headerLine = "";
	constructor(kind, startLine) {
		this.kind = kind;
		this.startLine = startLine;
	}
	get lastChild() {
		return this.children.at(-1);
	}
	appendChild(child) {
		child.parent = this;
		this.children.push(child);
	}
	replaceWith(replacement) {
		const parent = this.parent;
		if (parent === void 0) return;
		const index = parent.children.indexOf(this);
		if (index === -1) return;
		parent.children[index] = replacement;
		replacement.parent = parent;
		this.parent = void 0;
	}
	unlink() {
		const parent = this.parent;
		if (parent === void 0) return;
		const index = parent.children.indexOf(this);
		if (index !== -1) parent.children.splice(index, 1);
		this.parent = void 0;
	}
};
function canContain(parent, child) {
	switch (parent) {
		case "document":
		case "blockquote":
		case "listItem": return child !== "listItem";
		case "list": return child === "listItem";
		default: return false;
	}
}
function acceptsLines(kind) {
	return kind === "paragraph" || kind === "codeBlock" || kind === "htmlBlock" || kind === "table" || kind === "mathBlock";
}
//#endregion
exports.BlockNode = BlockNode;
exports.acceptsLines = acceptsLines;
exports.canContain = canContain;
