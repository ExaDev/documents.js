import { style } from "@vanilla-extract/css";

export const navLink = style({ textDecoration: "none", color: "inherit" });

export const versionAnchor = style({
  alignItems: "center",
  gap: 6,
  padding: "8px 12px",
});

// A real heading element for each nav group, so the sidebar's own structure is navigable by heading as well as by link. Mantine's Text sizing already handles the type scale; this only restores the margin and letter-spacing a bare h2 would otherwise bring in from the user agent stylesheet.
export const groupHeading = style({
  margin: 0,
  letterSpacing: "0.06em",
});
