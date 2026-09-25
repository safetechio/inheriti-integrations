import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fillPageTarget, preflightPageTarget } from '../src/background/page-fill.js';
import { revalidatePageTarget, writePageTarget } from '../src/background/page-target.js';

const executeScript = vi.fn();
const tabGet = vi.fn(async () => ({ id: 7, windowId: 17, url: 'https://example.test/login' }));
const tabQuery = vi.fn(async () => [{ id: 7, windowId: 17, url: 'https://example.test/login' }]);

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { chrome: { scripting: { executeScript }, tabs: { get: tabGet, query: tabQuery } } });
});

const target = { tabId: 7, frameId: 3, targetId: 'opaque-1', origin: 'https://example.test', navigationId: 'nav-1' };

describe('page target execution', () => {
  it('preflights the exact frame and opaque document target', async () => {
    executeScript.mockResolvedValue([{ result: 'ready' }]);
    await expect(preflightPageTarget(target, revalidatePageTarget)).resolves.toBe('ready');
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [3] }, func: revalidatePageTarget,
      args: ['opaque-1', 'https://example.test', 'nav-1'],
    });
  });

  it('delivers write-only and returns only the stable result code', async () => {
    executeScript.mockResolvedValue([{ result: 'filled' }]);
    await expect(fillPageTarget(target, 'private-value', writePageTarget)).resolves.toBe('filled');
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7, frameIds: [3] }, func: writePageTarget,
      args: ['opaque-1', 'https://example.test', 'nav-1', 'private-value'],
    });
  });

  it('does not deliver to a tab that is no longer active', async () => {
    tabQuery.mockResolvedValueOnce([{ id: 8, windowId: 17, url: 'https://other.test' }]);
    await expect(fillPageTarget(target, 'private-value', writePageTarget)).resolves.toBe('tab-inactive');
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('does not deliver after exact-origin authorization is revoked', async () => {
    await expect(fillPageTarget(target, 'private-value', writePageTarget, async () => false))
      .resolves.toBe('authorization-denied');
    expect(executeScript).not.toHaveBeenCalled();
  });
});
