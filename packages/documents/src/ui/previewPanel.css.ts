import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

// Shared by every "Original"/"Converted" preview column (PdfPreview, MarkdownPreview, SheetPreview) and by Convert's own wrapping Stack around each -- lets each column shrink below its content's intrinsic width inside a `grow` Group.
export const flexColumn = style({ flex: 1, minWidth: 0 });

// position: relative stays as Mantine's own `pos="relative"` prop on the consuming Paper, not duplicated here.
export const previewFrame = recipe({
  base: { height: '70vh' },
  variants: {
    scroll: {
      true: { overflow: 'auto' },
      false: { overflow: 'hidden' },
    },
    padded: {
      true: { padding: 24 },
      false: {},
    },
  },
  defaultVariants: { scroll: false, padded: false },
});
