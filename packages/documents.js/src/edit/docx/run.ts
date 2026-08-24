import type { XmlElement, XmlNode } from "ooxml.js";
import { textContent } from "ooxml.js";
import type { Color as LayoutColor } from "document-schema.js";
import { colorToRgbHex } from "document-schema.js";
import { removeChild, setAttr } from "../../xml/edit";
import { encodeXmlText, needsSpacePreserve } from "../../xml/entities";
import { el, txt } from "../../xml/fragment";
import { walkElements } from "../../xml/query";
import {
  ensureFirstChild,
  getColor,
  getFontFamily,
  getSizePt,
  getToggle,
  RPR_ORDER,
  setColor,
  setFontFamily,
  setSizePt,
  setToggle,
} from "./props";

// WordprocessingML text is the content of w:t elements and nothing else -- never a raw text-node concatenation of the whole subtree, which is what ooxml.js's own textContent (deliberately format-agnostic) performs. A w:r can also carry a w:drawing, and an anchored shape inside one holds real element text of its own that is not text at all: wp:posOffset's content is an EMU coordinate (see src/edit/docx/vector.ts). A w:p can further carry an m:oMathPara equation, whose glyphs live in m:t. Concatenating either into a paragraph's or run's reported text would report markup as prose.
export function wordprocessingText(element: XmlElement): string {
  let out = "";
  for (const cursor of walkElements([element])) {
    if (cursor.node.tag === "w:t") {
      out += textContent(cursor.node);
    }
  }
  return out;
}

export interface RunInit {
  readonly text?: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
  readonly strike?: boolean;
  readonly fontFamily?: string;
  readonly sizePt?: number;
  readonly color?: LayoutColor;
}

function directChild(parent: XmlElement, tag: string): XmlElement | undefined {
  for (const child of parent.children) {
    if (child.type === "element" && child.tag === tag) {
      return child;
    }
  }
  return undefined;
}

// w:u sits after w:szCs in CT_RPr -- after everything RPR_ORDER already tracks -- so appending is always correct without needing w:u in RPR_ORDER itself.
function appendUElement(rPr: XmlElement, value: boolean): XmlElement {
  const created = el("w:u", { "w:val": value ? "single" : "none" });
  rPr.children.push(created);
  return created;
}

function findOrCreateT(run: XmlElement): XmlElement {
  const existing = directChild(run, "w:t");
  if (existing !== undefined) {
    return existing;
  }
  const created = el("w:t");
  run.children.push(created);
  return created;
}

// A live view over a w:r element: every getter/setter reads or mutates the actual node inside the decoded Package, so saving is nothing more than encodePackage(pkg) -- see the plan's Step 6 for why this (rather than an independent object model regenerated on save) is the load-bearing design.
export class DocxRun {
  private readonly container: XmlNode[];
  private readonly node: XmlElement;
  private removed = false;

  constructor(container: XmlNode[], node: XmlElement) {
    this.container = container;
    this.node = node;
  }

  private live(): XmlElement {
    if (this.removed) {
      throw new Error(
        "this DocxRun has been removed from its paragraph and can no longer be used",
      );
    }
    return this.node;
  }

  private rPr(create: true): XmlElement;
  private rPr(create: false): XmlElement | undefined;
  private rPr(create: boolean): XmlElement | undefined {
    const node = this.live();
    return create
      ? ensureFirstChild(node, "w:rPr")
      : directChild(node, "w:rPr");
  }

  get text(): string {
    return wordprocessingText(this.live());
  }

  set text(value: string) {
    const tNode = findOrCreateT(this.live());
    if (needsSpacePreserve(value)) {
      setAttr(tNode, "xml:space", "preserve");
    }
    tNode.children = [txt(encodeXmlText(value))];
  }

  get bold(): boolean {
    return getToggle(this.rPr(false), "w:b");
  }

  set bold(value: boolean) {
    setToggle(this.rPr(true), "w:b", value, RPR_ORDER);
  }

  get italic(): boolean {
    return getToggle(this.rPr(false), "w:i");
  }

  set italic(value: boolean) {
    setToggle(this.rPr(true), "w:i", value, RPR_ORDER);
  }

  get strike(): boolean {
    return getToggle(this.rPr(false), "w:strike");
  }

  set strike(value: boolean) {
    setToggle(this.rPr(true), "w:strike", value, RPR_ORDER);
  }

  get underline(): boolean {
    const rPr = this.rPr(false);
    const uElement = rPr === undefined ? undefined : directChild(rPr, "w:u");
    if (uElement === undefined) {
      return false;
    }
    for (const a of uElement.attributes) {
      if (a.name === "w:val") {
        return a.value !== "none";
      }
    }
    return true;
  }

  set underline(value: boolean) {
    const rPr = this.rPr(true);
    const existing = directChild(rPr, "w:u");
    if (existing === undefined) {
      appendUElement(rPr, value);
      return;
    }
    setAttr(existing, "w:val", value ? "single" : "none");
  }

  get fontFamily(): string | undefined {
    return getFontFamily(this.rPr(false));
  }

  set fontFamily(value: string) {
    setFontFamily(this.rPr(true), value);
  }

  get sizePt(): number | undefined {
    return getSizePt(this.rPr(false));
  }

  set sizePt(value: number) {
    setSizePt(this.rPr(true), value);
  }

  get color(): LayoutColor | undefined {
    return getColor(this.rPr(false));
  }

  set color(value: LayoutColor) {
    setColor(this.rPr(true), value);
  }

  remove(): void {
    removeChild(this.container, this.live());
    this.removed = true;
  }
}

function insertRPrChildInOrder(rPr: XmlElement, child: XmlElement): void {
  const rank = RPR_ORDER.indexOf(child.tag);
  if (rank === -1) {
    rPr.children.push(child);
    return;
  }
  for (let i = 0; i < rPr.children.length; i++) {
    const sibling = rPr.children[i];
    if (sibling?.type !== "element") {
      continue;
    }
    const siblingRank = RPR_ORDER.indexOf(sibling.tag);
    if (siblingRank !== -1 && siblingRank > rank) {
      rPr.children.splice(i, 0, child);
      return;
    }
  }
  rPr.children.push(child);
}

// Builds a fresh w:r element from scratch (not a live view -- for constructing new runs to append or insert, whose properties are then read back through DocxRun once inserted into the tree).
export function buildRun(init: RunInit = {}): XmlElement {
  const rPrChildren: XmlElement[] = [];
  if (init.bold === true) {
    rPrChildren.push(el("w:b"));
  }
  if (init.italic === true) {
    rPrChildren.push(el("w:i"));
  }
  if (init.strike === true) {
    rPrChildren.push(el("w:strike"));
  }
  if (init.fontFamily !== undefined) {
    rPrChildren.push(
      el("w:rFonts", {
        "w:ascii": init.fontFamily,
        "w:hAnsi": init.fontFamily,
      }),
    );
  }
  if (init.sizePt !== undefined) {
    const half = String(Math.round(init.sizePt * 2));
    rPrChildren.push(
      el("w:sz", { "w:val": half }),
      el("w:szCs", { "w:val": half }),
    );
  }
  if (init.color !== undefined) {
    rPrChildren.push(el("w:color", { "w:val": colorToRgbHex(init.color) }));
  }

  const run = el("w:r");
  if (rPrChildren.length > 0 || init.underline === true) {
    const rPr = el("w:rPr");
    for (const child of rPrChildren) {
      insertRPrChildInOrder(rPr, child);
    }
    if (init.underline === true) {
      appendUElement(rPr, true);
    }
    run.children.push(rPr);
  }

  const text = init.text ?? "";
  const tAttrs: Record<string, string> = needsSpacePreserve(text)
    ? { "xml:space": "preserve" }
    : {};
  run.children.push(el("w:t", tAttrs, [txt(encodeXmlText(text))]));
  return run;
}
