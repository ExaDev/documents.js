import type { ReactElement } from 'react';
import { useAppState } from '../../../state/context.js';
import { buildOdpSlideFamilyAdapter, SlideFamilySlideList } from '../../shared/slide-family.js';

// slide-detail, shape-editor and slide-table-detail are genuinely shared between pptx and odp (see their own doc comments in ../pptx/) -- re-exported here too so an odp-side caller (the app.tsx screen router) never has to know they physically live under the pptx/ directory.
export { ShapeEditorScreen, SlideDetailScreen, SlideTableDetailScreen } from '../pptx/index.js';
export { NotesEditorScreen } from './notes-editor.js';
export { RotationField } from './rotation-field.js';

export function OdpSlideListScreen(): ReactElement {
  const state = useAppState();
  const doc = state.openDocument;
  if (doc?.format !== 'odp') {
    throw new Error('OdpSlideListScreen rendered without an open odp document; check the screen router in app.tsx.');
  }
  return <SlideFamilySlideList adapter={buildOdpSlideFamilyAdapter(doc.editor)} />;
}
