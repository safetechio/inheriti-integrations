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
});
