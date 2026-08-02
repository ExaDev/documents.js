import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { settle } from '../../../test-support.js';
import { MarkdownHarness } from './test-support.js';

describe('MarkdownLineListScreen', () => {
  it('lists every line of the source, numbered from 1, with blank lines called out', async () => {
    const { lastFrame } = render(<MarkdownHarness source={'# Title\n\nAlpha\nBeta'} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('Lines (4 of 4)');
    });
    expect(lastFrame()).toContain('1: # Title');
    expect(lastFrame()).toContain('2: (blank)');
    expect(lastFrame()).toContain('3: Alpha');
    expect(lastFrame()).toContain('4: Beta');
  });

  it('pushes markdownLineEditor for the selected line on Enter, and commits the rejoined source back through SET_MARKDOWN_SOURCE', async () => {
    // Line 2 is blank, so the RunTextEditor it opens starts empty -- typing straight into it needs no backspacing to clear a pre-filled value first.
    const { lastFrame, stdin } = render(<MarkdownHarness source={'Alpha\n\nGamma'} />);
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('top:markdownLineList');
    });
    await settle();

    stdin.write('j');
    await settle();
    stdin.write('\r');
    await vi.waitFor(() => {
      expect(lastFrame()).toContain('top:markdownLineEditor');
    });
    expect(lastFrame()).toContain('Edit line 2');
    await settle();

    stdin.write('Beta');
    await settle();
    stdin.write('\r');

    await vi.waitFor(() => {
      expect(lastFrame()).toContain('top:markdownLineList');
    });
    expect(lastFrame()).toContain('1: Alpha');
    expect(lastFrame()).toContain('2: Beta');
    expect(lastFrame()).toContain('3: Gamma');
  });
});
