import { style } from "@vanilla-extract/css";

import { vars } from "../theme.css";

export const slideContainer = style({
  width: "100%",
  border: `1px solid ${vars.colors.defaultBorder}`,
  borderRadius: vars.radius.sm,
  overflow: "hidden",
});

export const slideSvg = style({
  display: "block",
  width: "100%",
  height: "100%",
});

export const segmentedControl = style({ margin: 8 });
