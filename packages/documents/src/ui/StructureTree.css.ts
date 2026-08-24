import { style } from "@vanilla-extract/css";

import { vars } from "../theme.css";

export const container = style({
  maxHeight: 320,
  overflow: "auto",
  fontFamily: vars.fontFamilyMonospace,
  fontSize: vars.fontSizes.xs,
});
