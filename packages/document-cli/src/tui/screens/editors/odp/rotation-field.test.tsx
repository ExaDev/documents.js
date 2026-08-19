import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { RotationField } from './rotation-field.js';

describe('RotationField', () => {
  it('renders the current value', () => {
    const { lastFrame } = render(
      <RotationField rotationDeg={15} isSelected={false} isEditing={false} draftValue="" onDraftChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    const frame = lastFrame();
    expect(frame).toContain('15°');
  });

  it('renders "(unset)" when no rotation has been applied yet', () => {
    const { lastFrame } = render(
      <RotationField rotationDeg={undefined} isSelected={false} isEditing={false} draftValue="" onDraftChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(lastFrame()).toContain('(unset)');
  });

  it('rounds floating-point rotation noise to a clean display value', () => {
    const { lastFrame } = render(
      // documents.js's own rotation setter can round-trip a clean 15 into 14.999999999999998 (confirmed empirically) -- this must never leak into the UI.
      <RotationField
        rotationDeg={14.999999999999998}
        isSelected={false}
        isEditing={false}
        draftValue=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('15°');
    expect(frame).not.toContain('14.999999999999998');
  });

  it('shows an editable TextField when isEditing', () => {
    const { lastFrame } = render(
      <RotationField rotationDeg={undefined} isSelected isEditing draftValue="45" onDraftChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(lastFrame()).toContain('45');
    expect(lastFrame()).toContain('Rotation (deg');
  });
});
