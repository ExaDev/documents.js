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
