import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('in-page overlay security surface', () => {
  it('uses an isolated Shadow DOM and metadata-only DOM construction', async () => {
    const source = await readFile(new URL('../src/content/overlay.ts', import.meta.url), 'utf8');
    expect(source).toContain("attachShadow({ mode: 'closed' })");
    expect(source).toContain('textContent');
    expect(source).not.toContain('innerHTML');
    // Page field values are never read. The overlay's own filter box, inside the closed shadow root,
    // is destructured from the event target and is the only value the content script ever touches.
    expect(source).not.toMatch(/\.value\b/u);
    expect(source).toContain('const { value } = box as HTMLInputElement;');
    expect(source).not.toContain('document.activeElement');
    expect(source).not.toContain('iframe');
    expect(source).not.toContain('fetch(');
    expect(source).toContain("type === 'inheriti-overlay-discover-targets'");
    expect(source).toContain('sendResponse([...controls.keys()]');
    expect(source).toContain('onOutsidePointerDown');
    expect(source).toContain("position:fixed;width:0;height:0");
    expect(source).toContain('document.documentElement.append(host)');
    expect(source).toContain('positionControls();');
    expect(source).not.toContain("insertAdjacentElement('afterend', host)");
  });

  it('exposes only the shared confirmation as a reveal-starting message', async () => {
    const source = await readFile(new URL('../src/content/overlay.ts', import.meta.url), 'utf8');
    expect(source.match(/overlay-reveal-and-autofill/gu)).toHaveLength(1);
    expect(source).not.toContain('withReveal');
    expect(source).not.toContain('protectedValue');
    expect(source).not.toContain('token');
    expect(source).not.toContain('passphrase');
    expect(source).toContain('Open side panel');
  });

  it('reads reveal progress as view state only', async () => {
    const source = await readFile(new URL('../src/content/overlay.ts', import.meta.url), 'utf8');
    expect(source).toContain("type: 'overlay-reveal-state'");
    expect(source).toContain("type: 'overlay-cancel-reveal'");
    expect(source).not.toContain('protectedValue');
  });

  it('explains distinct sign-in, load failure, and empty suggestion states', async () => {
    const source = await readFile(new URL('../src/content/overlay.ts', import.meta.url), 'utf8');
    for (const text of ['Sign in to use autofill', 'Plans could not be loaded', 'InheritiGuard did not respond',
      'No plans support autofill', 'Selected plan unavailable', 'No autofill fields found', 'No matching ${semantic} field']) {
      expect(source).toContain(text);
    }
    expect(source).not.toContain('Plan Access is not ready');
    expect(source).not.toContain("return 'Denied'");
    expect(source).toContain('Not allowed on this site');
    expect(source).toContain('Autofill credentials');
    expect(source).toContain("field${mappings.length === 1 ? '' : 's'} ready");
    expect(source).toContain('candidate.assetFieldNames.map(titleCase)');
  });
});
