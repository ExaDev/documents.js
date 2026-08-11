import { style } from '@vanilla-extract/css';

import { vars } from '../theme.css';

// Markdown-specific paragraph styles. Shared block/run styles (paragraph, heading, inlineCode, table, tableCell, image) live in contentBlocks.css.ts.
export const blockquote = style({
  margin: '0.6em 0',
  paddingLeft: 12,
  borderLeft: `3px solid ${vars.colors.defaultBorder}`,
  color: vars.colors.dimmed,
});

export const codeBlock = style({ background: vars.colors.default, padding: 12, borderRadius: 4, overflowX: 'auto' });

export const hr = style({ border: 'none', borderTop: `1px solid ${vars.colors.defaultBorder}`, margin: '1em 0' });

export const list = style({ margin: '0.3em 0', paddingLeft: 24 });
