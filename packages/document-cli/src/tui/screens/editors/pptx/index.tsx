import type { ReactElement } from 'react';
import { useAppState } from '../../../state/context.js';
import { buildPptxSlideFamilyAdapter, SlideFamilySlideList } from '../../shared/slide-family.js';

export { ShapeEditorScreen } from './shape-editor.js';
export { SlideDetailScreen } from './slide-detail.js';
export { SlideTableDetailScreen } from './slide-table-detail.js';

export function PptxSlideListScreen(): ReactElement {
  const state = useAppState();
  const doc = state.openDocument;
  if (doc?.format !== 'pptx') {
    throw new Error('PptxSlideListScreen rendered without an open pptx document; check the screen router in app.tsx.');
  }
  return <SlideFamilySlideList adapter={buildPptxSlideFamilyAdapter(doc.editor)} />;
}
