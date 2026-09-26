import { style } from "@vanilla-extract/css";

import { vars } from "../theme.css";

// One visual row per paragraph: rounded so the hover wash reads as a row highlight rather than a full-width band. The wash uses the theme's default surface colour (the same token inlineCode and table headers use), so it follows the active colour scheme rather than hardcoding a light-only grey.
export const editorRow = style({
  borderRadius: vars.radius.sm,
  transition: "background-color 120ms ease",
  selectors: {
    "&:hover": {
      backgroundColor: vars.colors.default,
    },
  },
});
