import type {
  Box,
  ContentParagraph as ContentParagraphNode,
  ContentShape,
  ContentSlide,
} from "document-schema.js";
import { buildParagraph, DocParagraph } from "../doc/paragraph";

export interface TextBoxInit {
  readonly frame: Box;
  readonly text?: string;
}

// A live view over one ContentShape object inside a slide's own shapes array. ppt-codec's writer covers plain text-box shapes with basic character formatting (see that package's own README), so the paragraph surface here reuses DocParagraph directly -- the identical ContentParagraph node under a presentation shape as under a doc section, the same reuse ODP's editor applies when it shares OdtParagraph/OdtRun for a draw:text-box's own text:p model.
//
// The schema's four inset fields default to 0 for a shape this editor creates: [MS-PPT]'s writer has no per-shape inset concept at all (ppt-codec's reader never reads one), so the model's required fields carry the neutral value rather than inventing a margin the format cannot state.
export class PptShape {
  private readonly container: ContentShape[];
  private readonly node: ContentShape;
  private removed = false;

  constructor(container: ContentShape[], node: ContentShape) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentShape {
    if (this.removed) {
      throw new Error(
        "this PptShape has been removed from its slide and can no longer be used",
      );
    }
    return this.node;
  }

  get frame(): Box {
    return this.live().frame;
  }

  set frame(value: Box) {
    this.live().frame = value;
  }

  // Getter-only, deliberately: [MS-PPT]'s own writer cannot state a shape rotation (ppt-codec has no rotation concept on either side), so a setter here would build model content the very next toBytes() drops. The shared ContentShape field stays readable for a shape that arrived from a format which does carry one.
  get rotationDeg(): number | undefined {
    return this.live().rotationDeg;
  }

  paragraphs(): DocParagraph[] {
    return this.live()
      .blocks.filter(
        (block): block is ContentParagraphNode => block.kind === "paragraph",
      )
      .map((block) => new DocParagraph(this.live().blocks, block));
  }

  appendParagraph(init?: Parameters<typeof buildParagraph>[0]): DocParagraph {
    const node = this.live();
    const paragraph = buildParagraph(init);
    node.blocks.push(paragraph);
    return new DocParagraph(node.blocks, paragraph);
  }

  get text(): string {
    return this.paragraphs()
      .map((p) => p.text)
      .join("\n");
  }

  // Clears the shape's existing blocks and replaces them with a single paragraph carrying a single run -- the same clear-and-replace convention OdpShape.text's own setter uses.
  set text(value: string) {
    this.live().blocks = [buildParagraph({ text: value })];
  }

  remove(): void {
    const node = this.live();
    const index = this.container.indexOf(node);
    if (index !== -1) {
      this.container.splice(index, 1);
    }
    this.removed = true;
  }
}

// A live view over one ContentSlide object inside the editor's own slides array: size and notes are plain required model fields (the writer consumes both directly), shapes are the array of ContentShape a text box joins.
export class PptSlide {
  private readonly container: ContentSlide[];
  private readonly node: ContentSlide;
  private removed = false;

  constructor(container: ContentSlide[], node: ContentSlide) {
    this.container = container;
    this.node = node;
  }

  private live(): ContentSlide {
    if (this.removed) {
      throw new Error(
        "this PptSlide has been removed from its presentation and can no longer be used",
      );
    }
    return this.node;
  }

  get size(): ContentSlide["size"] {
    return this.live().size;
  }

  set size(value: ContentSlide["size"]) {
    this.live().size = value;
  }

  get notes(): string {
    return this.live().notes;
  }

  set notes(value: string) {
    this.live().notes = value;
  }

  shapes(): PptShape[] {
    return this.live().shapes.map(
      (shape) => new PptShape(this.live().shapes, shape),
    );
  }

  addTextBox(init: TextBoxInit): PptShape {
    const node = this.live();
    const shape: ContentShape = {
      frame: init.frame,
      insetLeftPt: 0,
      insetTopPt: 0,
      insetRightPt: 0,
      insetBottomPt: 0,
      blocks: [buildParagraph({ text: init.text ?? "" })],
    };
    node.shapes.push(shape);
    return new PptShape(node.shapes, shape);
  }

  remove(): void {
    const node = this.live();
    const index = this.container.indexOf(node);
    if (index !== -1) {
      this.container.splice(index, 1);
    }
    this.removed = true;
  }
}

// Builds a fresh empty ContentSlide (not a live view) -- the shape the editor's own addSlide appends, kept next to the classes that view it.
export function buildSlide(size: ContentSlide["size"]): ContentSlide {
  return { size, shapes: [], notes: "" };
}
