import { style } from "@vanilla-extract/css";

// Shared by the row's own Group and its inner name/badge Stack -- both need to shrink below their content's intrinsic width so Text truncate has room to actually truncate.
export const minWidthZero = style({ minWidth: 0 });

export const iconFlexShrink = style({ flexShrink: 0 });
