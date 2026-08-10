import { createVar, fallbackVar, style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';

import { vars } from '../theme.css';

export const table = style({ borderCollapse: 'collapse', fontSize: 13 });

export const segmentedControl = style({ margin: 8 });

export const headerCell = style({
  position: 'sticky',
  top: 0,
  background: vars.colors.default,
  border: `1px solid ${vars.colors.defaultBorder}`,
  padding: '2px 8px',
  fontWeight: 500,
  color: vars.colors.dimmed,
  whiteSpace: 'nowrap',
});

export const rowHeaderCell = style([headerCell, { left: 0, textAlign: 'right' }]);

export const cornerCell = style([headerCell, { left: 0, zIndex: 1 }]);

// A cell's fill color is arbitrary per-cell data (an {r,g,b} float triple), not one of a finite set of variants -- set per-instance via assignInlineVars rather than modeled as a recipe variant.
export const cellBackgroundVar = createVar();

export const cell = recipe({
  base: {
    border: `1px solid ${vars.colors.defaultBorder}`,
    padding: '2px 8px',
    whiteSpace: 'nowrap',
    background: fallbackVar(cellBackgroundVar, 'transparent'),
  },
  variants: {
    align: {
      left: { textAlign: 'left' },
      center: { textAlign: 'center' },
      right: { textAlign: 'right' },
      justify: { textAlign: 'justify' },
    },
    verticalAlign: {
      top: { verticalAlign: 'top' },
      middle: { verticalAlign: 'middle' },
      bottom: { verticalAlign: 'bottom' },
    },
    error: {
      true: { color: vars.colors.red[6] },
      false: {},
    },
  },
  defaultVariants: { align: 'left', verticalAlign: 'bottom', error: false },
});
