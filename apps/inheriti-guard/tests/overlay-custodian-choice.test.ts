import { beforeEach, expect, it, vi } from 'vitest';
import { chooseCustodianInOverlay, choosePreparedCustodianInOverlay } from '../src/background/overlay-custodian-choice.js';
import type { AccessBatch } from '../src/shared/access-contract.js';

const identity = { planId: 'p', tabId: 7, frameId: 3, origin: 'https://example.test', navigationId: 'nav' };
const batch = { identity, mappings: [] } as AccessBatch;
const sendMessage = vi.fn();
const get = vi.fn();
const query = vi.fn();
const executeScript = vi.fn();

beforeEach(() => {
  sendMessage.mockReset();
  get.mockReset().mockResolvedValue({ id: 7, windowId: 12, url: 'https://example.test/login' });
  query.mockReset().mockResolvedValue([{ id: 7 }]);
  executeScript.mockReset().mockResolvedValue([{ result: true }]);
  vi.stubGlobal('chrome', { tabs: { sendMessage, get, query }, scripting: { executeScript } });
});

it('asks only the exact overlay frame and accepts the Mobile choice without a popup', async () => {
  sendMessage.mockResolvedValue('SK_MOBILE');
  await expect(chooseCustodianInOverlay(batch, new AbortController().signal)).resolves.toBe('SK_MOBILE');
  expect(sendMessage).toHaveBeenCalledWith(7,
    { type: 'inheriti-overlay-choose-custodian', identity }, { frameId: 3 });
  expect(query).toHaveBeenCalledWith({ active: true, windowId: 12 });
});

it('fails closed when navigation removes the overlay or its reply is invalid', async () => {
  sendMessage.mockRejectedValueOnce(new Error('Receiving end does not exist')).mockResolvedValueOnce('forged');
  await expect(chooseCustodianInOverlay(batch, new AbortController().signal)).rejects.toThrow();
  await expect(chooseCustodianInOverlay(batch, new AbortController().signal)).rejects.toThrow('SAFEKEY_ABORTED');
});

it('cancels a pending choice before accepting a late reply', async () => {
  let reply!: (choice: string) => void;
  sendMessage.mockImplementation(() => new Promise((resolve) => { reply = resolve; }));
  const abort = new AbortController();
  const choosing = chooseCustodianInOverlay(batch, abort.signal);
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
  abort.abort();
  await expect(choosing).rejects.toThrow('SAFEKEY_ABORTED');
  reply('SK_PRO');
});

it('rejects the choice if the tab navigates while the chooser is open', async () => {
  sendMessage.mockResolvedValue('SK_PRO');
  get.mockResolvedValueOnce({ id: 7, windowId: 12, url: 'https://example.test/login' })
    .mockResolvedValueOnce({ id: 7, windowId: 12, url: 'https://other.test/login' });
  await expect(chooseCustodianInOverlay({ ...batch, identity: { ...identity, frameId: 0 } },
    new AbortController().signal)).rejects.toThrow('SAFEKEY_ABORTED');
});

it('rejects a PRO choice when the mapped target navigates to a new document', async () => {
  const mapped = { ...batch, mappings: [{ protectedField: {
    planId: 'p', assetId: 'a', assetCode: 'A1', assetName: 'Test', assetType: 'USER-PSWD',
    fieldName: 'username' as const, selector: 'A1.username', matchesOrigin: true,
  }, source: 'SUGGESTED' as const, pageTarget: {
    targetId: 'username', tabId: 7, frameId: 3, origin: identity.origin,
    navigationId: identity.navigationId, semantic: 'username' as const, label: 'Username',
  } }] } satisfies AccessBatch;
  sendMessage.mockResolvedValue('SK_PRO');
  executeScript.mockResolvedValueOnce([{ result: true }]).mockResolvedValueOnce([{ result: false }]);
  await expect(chooseCustodianInOverlay(mapped, new AbortController().signal)).rejects.toThrow('SAFEKEY_ABORTED');
  expect(executeScript).toHaveBeenCalledTimes(2);
  expect(sendMessage).toHaveBeenCalledOnce();
});

it('returns to the inline choice after the PRO window closes before PIN, then accepts Mobile in the same reveal', async () => {
  sendMessage.mockResolvedValueOnce('SK_PRO').mockResolvedValueOnce('SK_MOBILE');
  const prepare = vi.fn().mockRejectedValueOnce(new Error('SAFEKEY_PANEL_CLOSED'));
  const signal = new AbortController().signal;
  await expect(choosePreparedCustodianInOverlay(batch, signal, prepare)).resolves.toBe('SK_MOBILE');
  expect(sendMessage).toHaveBeenCalledTimes(2);
  expect(prepare).toHaveBeenCalledOnce();
});
