import { style } from "@vanilla-extract/css";

import { vars } from "../theme.css";

// The same row-highlight treatment EditorPanel.css.ts gives editor paragraphs: rounded, a short background transition, and a hover wash in the theme's default surface colour so it follows the active colour scheme. Applied to each recent-file row so the pointer target reads as one unit containing the name, metadata and actions.
export const recentRow = style({
  borderRadius: vars.radius.sm,
  transition: "background-color 120ms ease",
  selectors: {
    "&:hover": {
      backgroundColor: vars.colors.default,
    },
  },
});
