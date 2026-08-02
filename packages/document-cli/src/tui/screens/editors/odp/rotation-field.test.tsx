import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { RotationField } from './rotation-field.js';

describe('RotationField', () => {
  it('renders greyed out and inert for a pptx shape (isEditable: false)', () => {
    const { lastFrame } = render(
      <RotationField
        rotationDeg={undefined}
        isEditable={false}
        isSelected
        isEditing={false}
        draftValue=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain('not available for pptx shapes');
    // The greyed-out branch must never claim editability -- no rotation value, no editing affordance leaks through even when the caller (incorrectly) says isSelected/isEditing.
    expect(frame).not.toContain('°');
  });

  it('renders the current value for an odp shape (isEditable: true)', () => {
    const { lastFrame } = render(
      <RotationField rotationDeg={15} isEditable isSelected={false} isEditing={false} draftValue="" onDraftChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    const frame = lastFrame();
    expect(frame).toContain('15°');
    expect(frame).not.toContain('not available for pptx shapes');
  });

  it('renders "(unset)" for an odp shape with no rotation applied yet', () => {
    const { lastFrame } = render(
      <RotationField rotationDeg={undefined} isEditable isSelected={false} isEditing={false} draftValue="" onDraftChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(lastFrame()).toContain('(unset)');
  });

  it('rounds floating-point rotation noise to a clean display value', () => {
    const { lastFrame } = render(
      // documents.js's own rotation setter can round-trip a clean 15 into 14.999999999999998 (confirmed empirically) -- this must never leak into the UI.
      <RotationField
        rotationDeg={14.999999999999998}
        isEditable
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

  it('shows an editable TextField for an odp shape when isEditing, and no TextField when greyed out', () => {
    const editable = render(
      <RotationField
        rotationDeg={undefined}
        isEditable
        isSelected
        isEditing
        draftValue="45"
        onDraftChange={() => {}}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(editable.lastFrame()).toContain('45');
    expect(editable.lastFrame()).toContain('Rotation (deg');

    // Even if a caller mistakenly asks for edit mode on a pptx shape, the greyed-out branch wins -- there is no way to edit an unrotatable shape.
    const greyed = render(
      <RotationField rotationDeg={undefined} isEditable={false} isSelected isEditing draftValue="45" onDraftChange={() => {}} onSubmit={() => {}} onCancel={() => {}} />,
    );
    expect(greyed.lastFrame()).toContain('not available for pptx shapes');
    expect(greyed.lastFrame()).not.toContain('45');
  });
});
