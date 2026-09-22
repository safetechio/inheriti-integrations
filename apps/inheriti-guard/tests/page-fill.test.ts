import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillPageTarget, preflightPageTarget } from '../src/background/page-fill.js';

const executeScript = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { chrome: { scripting: { executeScript } } });
});

const target = { tabId: 7, frameId: 3, targetId: 'opaque-1', origin: 'https://example.test', navigationId: 'nav-1' };

describe('page target execution', () => {
  it('preflights the exact frame and opaque document target', async () => {
    const revalidate = vi.fn(() => true);
    executeScript.mockResolvedValue([{ result: true }]);
    await expect(preflightPageTarget(target, revalidate)).resolves.toBe(true);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [3] }, func: revalidate,
      args: ['opaque-1', 'https://example.test', 'nav-1'],
    });
  });

  it('delivers write-only and returns only the stable result code', async () => {
    const write = vi.fn(() => 'filled' as const);
    executeScript.mockResolvedValue([{ result: 'filled' }]);
    await expect(fillPageTarget(target, 'private-value', write)).resolves.toBe('filled');
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [3] }, func: write,
      args: ['opaque-1', 'https://example.test', 'nav-1', 'private-value'],
    });
  });
});
