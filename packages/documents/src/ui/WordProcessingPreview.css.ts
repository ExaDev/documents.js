import { style } from '@vanilla-extract/css';

import { vars } from '../theme.css';

// A neutral, non-committal list marker (a plain hyphen, deliberately distinct from both the browser's bullet glyph and a number). docx/odt-sourced lists carry no ordered-vs-bullet information in ContentDocument today (numbering definitions aren't folded in), so rendering real bullets would be confidently wrong for a genuinely-ordered list, and rendering numbers would be wrong for a bullet list. The hyphen signals "list item" without asserting either.
export const neutralList = style({
  margin: '0.3em 0',
  paddingLeft: 24,
  listStyle: 'none',
});

export const neutralListItem = style({
  '::before': {
    content: '"-"',
    marginRight: '0.5em',
    color: vars.colors.dimmed,
  },
});
