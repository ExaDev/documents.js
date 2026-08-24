import type { ContentBlock } from "document-schema.js";

// A generic "insert this before original position N" splice utility -- the shared shape src/ooxml/docx/embedded-objects.ts and src/odf/odt/read.ts's own formula/vector splicing both reduce to, generalised over WHAT is being inserted (a formula block, a vector-group drawing block, or anything else a future caller wants spliced the same way) rather than fixed to one block kind. Extracted from two independent, already-working implementations (src/ooxml/docx/formula.ts's own spliceDocxFormulas and src/odf/odt/read.ts's own spliceFormulaBlocks, both pre-dating this module) rather than designed from scratch, so this is a faithful abstraction of what they already did, not a redesign.

export interface BlockPlacement {
  // 0-based position in the ORIGINAL (pre-splice) blocks array immediately before which this item is inserted -- may equal blocks.length to append at the very end. Placements passed to spliceBlocks must be sorted ascending by index; each caller already produces them in that order by construction, since every one is discovered walking the source document in document order.
  readonly index: number;
  // Builds the ContentBlock to insert, given its own FINAL sourcePath -- computed lazily, at splice time, since a block's final position (and hence its sourcePath) depends on how many earlier blocks were dropped or how many earlier placements landed before it.
  readonly build: (sourcePath: string) => ContentBlock;
}

// One forward pass over `blocks`: at every original index, first emit every placement due there (in placements' own order), then emit the original block at that index unless it is in `consumedIndices` -- the shape a "this paragraph/container held nothing but the thing(s) just inserted" case needs (the original block is dropped outright and the placement(s) due at index+1 take its place, since a consuming container's own placements are always recorded one past its own index -- see either caller's own detection pass for why). `sourcePathFor` receives the position an inserted block will actually occupy in the OUTPUT array, so each caller can format its own sourcePath string (`sections[i].blocks[N]`, `slides[i].shapes[N]`, ...).
export function spliceBlocks(
  blocks: readonly ContentBlock[],
  placements: readonly BlockPlacement[],
  consumedIndices: ReadonlySet<number>,
  sourcePathFor: (position: number) => string,
): ContentBlock[] {
  const out: ContentBlock[] = [];
  let next = 0;
  for (let index = 0; index <= blocks.length; index++) {
    while (next < placements.length && placements[next]!.index === index) {
      const { build } = placements[next]!;
      out.push(build(sourcePathFor(out.length)));
      next += 1;
    }
    const block = blocks[index];
    if (block !== undefined && !consumedIndices.has(index)) {
      out.push(block);
    }
  }
  return out;
}
