import { createTheme, DEFAULT_THEME, mergeMantineTheme } from "@mantine/core";

// Every spacing step, in rem at the browser's own 16px root. Stated here rather than left to Mantine's defaults (10/12/16/20/32px) because those steps are not on a grid: 10 and 12 are near enough to be indistinguishable on screen, which makes the choice between `gap="xs"` and `gap="sm"` arbitrary at the call site and the result inconsistent across pages. A 4px grid that doubles from `sm` upward gives every step a visible job: `xs` separates parts of one thing (a label from its value), `sm` separates things inside a panel, `md` is a panel's own padding, `lg` separates panels, and `xl` separates a page's major regions.
const spacing = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2.5rem",
} as const;

// Mantine's own heading defaults run to 2.125rem at h1 and 700 throughout, sized for a marketing page where a heading is the loudest thing on screen. Here a heading labels a tool the reader has already chosen from the sidebar, so it only has to be findable, not arresting: each step is roughly a 1.2 ratio down from 1.75rem, and 600 carries the weight difference against body text without the density a 700 brings to a short line.
const headings = {
  fontWeight: "600",
  sizes: {
    h1: { fontSize: "1.75rem", lineHeight: "1.25" },
    h2: { fontSize: "1.375rem", lineHeight: "1.3" },
    h3: { fontSize: "1.125rem", lineHeight: "1.4" },
    h4: { fontSize: "1rem", lineHeight: "1.45" },
    h5: { fontSize: "0.875rem", lineHeight: "1.45" },
    h6: { fontSize: "0.8125rem", lineHeight: "1.45" },
  },
} as const;

const themeOverride = createTheme({
  primaryColor: "indigo",
  defaultRadius: "md",
  fontFamily: "Inter, system-ui, sans-serif",
  spacing,
  headings,
});

export const theme = mergeMantineTheme(DEFAULT_THEME, themeOverride);
