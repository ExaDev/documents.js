import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocxWithMetadata, METADATA_FIXTURE } from '../test-support/metadata-fixture.js';
import { App } from './app.js';
import { settle, waitForFrame } from './test-support.js';

// Exercises the real App/AppShell wiring end to end (not a per-screen harness that only routes the screens under test) -- opening a real docx fixture from disk via `startPath`, the same way `document-cli tui <path>` opens one, so this proves the actual global 'm' key handler in app.tsx's own AppShell (not a reimplementation of it) pushes the metadata screen and that it renders real values read from the open document.

let workspace: string;
let fixturePath: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'document-cli-tui-metadata-'));
  fixturePath = join(workspace, 'fixture.docx');
  await writeFile(fixturePath, buildDocxWithMetadata());
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('App metadata screen', () => {
  it("opens the metadata screen on 'm' and shows the open document's real metadata", async () => {
    const { lastFrame, stdin } = render(<App startPath={fixturePath} />);
    await waitForFrame(lastFrame, (frame) => frame.includes('Body (docx)'));
    await settle();

    stdin.write('m');

    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Document metadata'));
    expect(frame).toContain(`title: ${METADATA_FIXTURE.title}`);
    expect(frame).toContain(`author: ${METADATA_FIXTURE.author}`);
    expect(frame).toContain(`subject: ${METADATA_FIXTURE.subject}`);
  });

  it('goes back to the previous screen on Esc', async () => {
    const { lastFrame, stdin } = render(<App startPath={fixturePath} />);
    await waitForFrame(lastFrame, (frame) => frame.includes('Body (docx)'));
    await settle();
    stdin.write('m');
    await waitForFrame(lastFrame, (candidate) => candidate.includes('Document metadata'));
    await settle();

    stdin.write('');

    const frame = await waitForFrame(lastFrame, (candidate) => candidate.includes('Body (docx)'));
    expect(frame).toContain('Paragraphs');
  });
});

// Exercises the real global Ctrl+Z handler in app.tsx's own AppShell (not a reimplementation of it), through a fresh in-memory document rather than the on-disk fixture above, since this suite mutates the open document and the metadata fixture above is shared read-only state across that describe block.
describe('App Ctrl+Z undo', () => {
  it('reverts the last paragraph append when Ctrl+Z is pressed', async () => {
    const { lastFrame, stdin } = render(<App />);
    await waitForFrame(lastFrame, (frame) => frame.includes('document-cli'));
    await settle();

    stdin.write('n');
    await waitForFrame(lastFrame, (frame) => frame.includes('New document'));
    await settle();

    // The first creatable format in new-document-picker.tsx's own list is docx.
    stdin.write('\r');
    await waitForFrame(lastFrame, (frame) => frame.includes('Body (docx)'));
    await settle();

    stdin.write('a');
    await waitForFrame(lastFrame, (frame) => frame.includes('Paragraph 0'));
    await settle();

    // Real ESC byte (0x1B), matching the "goes back to the previous screen on Esc" test above.
    stdin.write('\x1B');
    const beforeUndo = await waitForFrame(lastFrame, (frame) => frame.includes('Paragraphs (1/1)'));
    expect(beforeUndo).toContain('Paragraphs (1/1)');
    await settle();

    // Ctrl+Z: codepoint 26 (0x1A) is how a real terminal sends it, and how ink's own parse-keypress.js recognises key.ctrl + 'z'.
    stdin.write('\x1a');
    const afterUndo = await waitForFrame(lastFrame, (frame) => frame.includes('No paragraphs or tables yet'));
    expect(afterUndo).not.toContain('Paragraphs (1/1)');
  });
});
