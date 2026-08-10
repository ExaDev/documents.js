import { style } from '@vanilla-extract/css';

import { vars } from '../theme.css';

export const table = style({ borderCollapse: 'collapse', marginBlock: 12 });

export const tableCell = style({ border: `1px solid ${vars.colors.defaultBorder}`, padding: '4px 8px' });

export const image = style({ maxWidth: '100%' });

export const heading = style({ marginBlock: '0.6em 0.3em' });

export const blockquote = style({
  margin: '0.6em 0',
  paddingLeft: 12,
  borderLeft: `3px solid ${vars.colors.defaultBorder}`,
  color: vars.colors.dimmed,
});

export const codeBlock = style({ background: vars.colors.default, padding: 12, borderRadius: 4, overflowX: 'auto' });

export const hr = style({ border: 'none', borderTop: `1px solid ${vars.colors.defaultBorder}`, margin: '1em 0' });

export const paragraph = style({ margin: '0.4em 0', lineHeight: 1.5 });

export const inlineCode = style({ background: vars.colors.default, padding: '1px 4px', borderRadius: 3 });

// Shared by both <ol> and <ul> -- byte-identical today (see renderListNodes' own call sites).
export const list = style({ margin: '0.3em 0', paddingLeft: 24 });
