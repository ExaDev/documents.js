import { style } from "@vanilla-extract/css";

// Never narrower than the controls column above (900px), grows at 85% of viewport width, never wider than 2200px so preview text doesn't sprawl on an ultrawide monitor.
export const donePanel = style({ maxWidth: "clamp(900px, 85vw, 2200px)" });
