Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
//#region src/inline/node.ts
var InlineNode = class {
	kind;
	literal = "";
	destination = "";
	title;
	email = false;
	marker = "*";
	raw = "";
	parent;
	firstChild;
	lastChild;
	previous;
	next;
	constructor(kind) {
		this.kind = kind;
	}
	appendChild(child) {
		child.unlink();
		child.parent = this;
		if (this.lastChild === void 0) {
			this.firstChild = child;
			this.lastChild = child;
			return;
		}
		child.previous = this.lastChild;
		this.lastChild.next = child;
		this.lastChild = child;
	}
	insertAfter(sibling) {
		sibling.unlink();
		sibling.next = this.next;
		if (sibling.next !== void 0) sibling.next.previous = sibling;
		sibling.previous = this;
		this.next = sibling;
		sibling.parent = this.parent;
		if (sibling.next === void 0 && sibling.parent !== void 0) sibling.parent.lastChild = sibling;
	}
	unlink() {
		if (this.previous !== void 0) this.previous.next = this.next;
		else if (this.parent !== void 0) this.parent.firstChild = this.next;
		if (this.next !== void 0) this.next.previous = this.previous;
		else if (this.parent !== void 0) this.parent.lastChild = this.previous;
		this.parent = void 0;
		this.next = void 0;
		this.previous = void 0;
	}
};
function createTextNode(literal) {
	const node = new InlineNode("text");
	node.literal = literal;
	return node;
}
//#endregion
exports.InlineNode = InlineNode;
exports.createTextNode = createTextNode;
