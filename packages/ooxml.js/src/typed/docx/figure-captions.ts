import type { ContentBlock } from "document-schema.js";

// The style Word's Insert Caption applies. Matched case-insensitively because the style id a producer
// writes is its own spelling ("Caption", "caption", localised builds vary), and w:pStyle/@w:val is
// explicitly documented on ContentParagraph as producer-specific.
const CAPTION_STYLE_ID = "caption";

// Associates a Caption-styled paragraph with the figure it describes, recording it on the image block's
// own `caption` while leaving the paragraph itself exactly where it is.
//
// Associated rather than moved or copied, for two reasons. A caption is real prose the document
// contains, so removing it would lose text a reader expects to find; and copying it into the image as
// well would duplicate it in every flat-text projection and search index built from the block list.
// What the image gains is the *association* — enough for a consumer to caption a figure, describe it to
// a model, or use it as an accessible name, without the caption being said twice.
//
// The paragraph below the figure wins, because that is where Word's own Insert Caption puts a figure
// caption; the one above is a fallback, since an author who typed their own often puts it there. A
// caption between two figures is claimed by the earlier one only — the later is left uncaptioned rather
// than given words about someone else's figure.
//
// Length-preserving by construction: no block is added, removed or reordered, only an image block
// replaced with a copy carrying `caption`. That matters because the extent list this output is handed to
// (insertConstructMarkers) indexes into the same array.
export function associateFigureCaptions(
  blocks: readonly ContentBlock[],
): ContentBlock[] {
  const claimed = new Set<number>();
  return blocks.map((block, index) => {
    if (block.kind !== "image") {
      return block;
    }
    for (const candidate of [index + 1, index - 1]) {
      if (claimed.has(candidate)) {
        continue;
      }
      const caption = captionTextAt(blocks, candidate);
      if (caption !== undefined) {
        claimed.add(candidate);
        return { ...block, caption };
      }
    }
    return block;
  });
}

// The text of blocks[index] when it is a non-empty Caption-styled paragraph, else undefined.
function captionTextAt(
  blocks: readonly ContentBlock[],
  index: number,
): string | undefined {
  const block = blocks[index];
  if (
    block?.kind !== "paragraph" ||
    block.styleId?.toLowerCase() !== CAPTION_STYLE_ID
  ) {
    return undefined;
  }
  const text = block.runs
    .map((run) => run.text)
    .join("")
    .trim();
  return text === "" ? undefined : text;
}
