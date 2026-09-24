import { style } from "@vanilla-extract/css";

// The dropzone content is purely decorative — clicks/drags must reach the underlying Dropzone element, not this label.
export const dropzoneContent = style({ pointerEvents: "none" });

// The close button is the one genuinely interactive element inside dropzoneContent's otherwise click-through area: without this, dropzoneContent's own pointer-events: none would stop the button from ever becoming a click target at all. Its own onClick still has to call stopPropagation, since re-enabling pointer-events here only restores hit-testing on the button itself; the click still bubbles up through the DOM to the Dropzone's own root, which would otherwise treat it as a click to replace the file at the same moment as closing it.
export const closeButton = style({ pointerEvents: "auto" });
