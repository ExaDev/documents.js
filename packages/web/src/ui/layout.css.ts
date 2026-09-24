import { style } from "@vanilla-extract/css";

// Lets a flex/grid child shrink below its content's own intrinsic width, which is what gives a sibling Text truncate anywhere to actually clip rather than overflowing. Needed on both the row itself and any inner Stack/Group that also participates in the same flex layout, since minWidth defaults to "auto" (the content's own width) at every level.
export const minWidthZero = style({ minWidth: 0 });

// Stops an icon sitting next to truncating text from being squeezed by its flex sibling's own shrink.
export const iconFlexShrink = style({ flexShrink: 0 });
