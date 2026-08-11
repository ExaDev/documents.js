import { style } from '@vanilla-extract/css';

import { vars } from '../theme.css';

// Shared block/run-level styles consumed by every flowing-document preview component (MarkdownPreview, WordProcessingPreview). Format-specific paragraph styles (blockquote, code block, hr, list markers) live in each component's own .css.ts.
export const paragraph = style({ margin: '0.4em 0', lineHeight: 1.5 });

export const heading = style({ marginBlock: '0.6em 0.3em' });

export const inlineCode = style({ background: vars.colors.default, padding: '1px 4px', borderRadius: 3 });

export const table = style({ borderCollapse: 'collapse', marginBlock: 12 });

export const tableCell = style({ border: `1px solid ${vars.colors.defaultBorder}`, padding: '4px 8px' });

export const image = style({ maxWidth: '100%' });
