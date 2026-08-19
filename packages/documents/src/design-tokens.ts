// Mirrors @mantine/core's built-in 'indigo' scale (theme.ts's primaryColor: 'indigo', shade 6 -- Mantine's default primaryShade.light). Not imported live from theme.ts/@mantine/core into vite.config.ts: the Node build config's tsconfig has no DOM/React types, and reaching from build config into browser UI code cuts against this repo's import-boundary discipline (see eslint.config.ts's no-restricted-imports rule). design-tokens.test.ts asserts this stays in sync with Mantine's real value instead.
export const BRAND_COLOR = '#4c6ef5';
export const BACKGROUND_COLOR = '#ffffff';
