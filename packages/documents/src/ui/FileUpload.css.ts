import { style } from '@vanilla-extract/css';

// The dropzone content is purely decorative -- clicks/drags must reach the underlying Dropzone element, not this label.
export const dropzoneContent = style({ pointerEvents: 'none' });
