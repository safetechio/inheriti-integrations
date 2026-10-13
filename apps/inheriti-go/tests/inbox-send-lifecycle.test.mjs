import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ slots: [], cursor: 0, effects: [], first: true }));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal()),
  useRef(initial) {
    const index = hooks.cursor++;
    return hooks.slots[index] ??= { current: initial };
  },
  useState(initial) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], value => { hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value; }];
  },
  useEffect(effect) { if (hooks.first) hooks.effects.push(effect); },
}));

import { useInboxMessages } from '../src/modules/inbox/ui/hooks/useInboxMessages.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function render() {
  hooks.cursor = 0;
  const inbox = useInboxMessages(() => {});
  if (hooks.first) { hooks.first = false; hooks.effects.forEach(effect => effect()); }
  return inbox;
}

async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }

beforeEach(() => {
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.first = true;
  let hidden;
  globalThis.window = { confirm: vi.fn(() => true), inheritiTray: {
    onHidden: callback => { hidden = callback; return () => {}; },
    onInboxTransferProgress: () => () => {},
    onInboxParentSendProgress: () => () => {},
    onInboxFileForPlan: () => () => {},
    inboxHideText: vi.fn(async () => {}),
    inboxMessages: vi.fn(async () => ({ items: [] })),
    inboxNormalMessages: vi.fn(async () => ({ items: [], unreadCount: 0 })),
    inboxParents: vi.fn(async () => ({ items: [], unreadCount: 0 })),
    inboxNormalPreparation: vi.fn(async () => ({ parentId: 'parent-1' })),
    inboxSendNormal: vi.fn(async () => {}),
    inboxClearHistory: vi.fn(async () => {}),
  } };
  window.hideInbox = () => hidden();
});

it('finishes an in-flight send after reselecting the same conversation and clears history after delivery', async () => {
  const preparation = deferred();
  window.inheritiTray.inboxNormalPreparation.mockReturnValue(preparation.promise);
  let inbox = render();
  await inbox.select('conversation');
  inbox = render();
  inbox.setDraft('first message');
  inbox = render();
  inbox.send({ preventDefault() {} });
  inbox = render();
  expect(inbox.draft).toBe('');
  expect(inbox.pendingMessages).toHaveLength(1);
  await inbox.select('conversation');
  inbox = render();
  expect(inbox.pendingMessages[0].status).toBe('sending');
  await inbox.clearHistory();
  expect(window.inheritiTray.inboxClearHistory).not.toHaveBeenCalled();
  preparation.resolve({ parentId: 'parent-1' });
  await flush();
  inbox = render();
  expect(inbox.pendingMessages).toHaveLength(0);
  expect(inbox.acceptedMessages).toHaveLength(1);
  expect(window.inheritiTray.inboxSendNormal).toHaveBeenCalledWith('conversation', 'parent-1', 'first message');
  await inbox.clearHistory();
  inbox = render();
  expect(inbox.acceptedMessages).toHaveLength(0);
});

it('keeps a failed message across conversation switches and does not send after the window hides', async () => {
  const preparation = deferred();
  window.inheritiTray.inboxNormalPreparation.mockReturnValue(preparation.promise);
  window.inheritiTray.inboxSendNormal.mockRejectedValue(new Error('offline'));
  let inbox = render();
  await inbox.select('first');
  inbox = render();
  inbox.setDraft('keep me');
  inbox = render();
  inbox.send({ preventDefault() {} });
  await inbox.select('second');
  preparation.resolve({ parentId: 'parent-1' });
  await flush();
  inbox = render();
  expect(inbox.pendingMessages[0]).toMatchObject({ conversationId: 'first', status: 'failed', text: 'keep me' });
  await inbox.select('first');
  inbox = render();
  expect(inbox.pendingMessages[0].status).toBe('failed');

  const next = deferred();
  window.inheritiTray.inboxNormalPreparation.mockReturnValue(next.promise);
  inbox.setDraft('do not send after hide');
  inbox = render();
  inbox.send({ preventDefault() {} });
  window.hideInbox();
  next.resolve({ parentId: 'parent-2' });
  await flush();
  expect(window.inheritiTray.inboxSendNormal).toHaveBeenCalledTimes(1);
  expect(render().pendingMessages).toHaveLength(0);
});

it('accepts a second message while the first is still sending', async () => {
  const firstSend = deferred();
  window.inheritiTray.inboxNormalPreparation
    .mockResolvedValueOnce({ parentId: 'parent-1' })
    .mockResolvedValueOnce({ parentId: 'parent-2' });
  window.inheritiTray.inboxSendNormal.mockImplementation((id, parentId) =>
    parentId === 'parent-1' ? firstSend.promise : Promise.resolve());
  let inbox = render();
  await inbox.select('conversation');
  inbox = render();
  inbox.setDraft('first');
  render().send({ preventDefault() {} });
  await flush();
  inbox = render();
  expect(inbox.draft).toBe('');
  inbox.setDraft('second');
  render().send({ preventDefault() {} });
  await flush();
  inbox = render();
  expect(window.inheritiTray.inboxSendNormal).toHaveBeenCalledWith('conversation', 'parent-1', 'first');
  expect(window.inheritiTray.inboxSendNormal).toHaveBeenCalledWith('conversation', 'parent-2', 'second');
  expect(inbox.pendingMessages).toHaveLength(1);
  expect(inbox.pendingMessages[0].text).toBe('first');
  expect(inbox.draft).toBe('');
  firstSend.resolve();
  await flush();
  expect(render().pendingMessages).toHaveLength(0);
});

it('ignores a message load that fails after leaving the conversation', async () => {
  const pending = deferred();
  window.inheritiTray.inboxMessages.mockReturnValue(pending.promise);
  const loading = render().select('conversation');
  expect(render().busy).toBe('loading');
  expect(render().leave()).toBe(true);
  pending.reject(new Error('cancelled'));
  await loading;
  const inbox = render();
  expect(inbox.conversationId).toBe('');
  expect(inbox.busy).toBe('');
  expect(inbox.error).toBe('');
});

it('shows previously loaded messages immediately while refreshing a revisited conversation', async () => {
  const secondLoad = deferred();
  const first = [{ id: 'message-1' }];
  const updated = [{ id: 'message-2' }];
  window.inheritiTray.inboxMessages.mockResolvedValueOnce({ items: first });
  window.inheritiTray.inboxMessages.mockImplementationOnce(() => secondLoad.promise);
  let inbox = render();
  await inbox.select('conversation');
  expect(render().items).toEqual(first);
  expect(render().leave()).toBe(true);
  const loading = render().select('conversation');
  inbox = render();
  expect(inbox.items).toEqual(first);
  expect(inbox.busy).toBe('');
  secondLoad.resolve({ items: updated });
  await loading;
  expect(render().items).toEqual(updated);
});

it('clears recent messages when the window hides', async () => {
  window.inheritiTray.inboxMessages.mockResolvedValueOnce({ items: [{ id: 'message-1' }] });
  await render().select('conversation');
  window.hideInbox();
  const nextLoad = deferred();
  window.inheritiTray.inboxMessages.mockImplementationOnce(() => nextLoad.promise);
  const loading = render().select('conversation');
  expect(render().busy).toBe('loading');
  expect(render().items).toEqual([]);
  nextLoad.resolve({ items: [] });
  await loading;
});

it('retries a cancelled message page and clears a previous refresh error after recovery', async () => {
  window.inheritiTray.inboxParents.mockRejectedValueOnce(new DOMException('This operation was aborted', 'AbortError'));
  let inbox = render();
  await inbox.select('conversation');
  inbox = render();
  expect(inbox.error).toBe('');
  expect(window.inheritiTray.inboxParents).toHaveBeenCalledTimes(2);

  window.inheritiTray.inboxMessages.mockRejectedValue(new Error('server unavailable'));
  await inbox.refresh();
  inbox = render();
  expect(inbox.error).toBe('Could not refresh all messages. Try again.');

  window.inheritiTray.inboxMessages.mockResolvedValue({ items: [] });
  await inbox.refresh();
  expect(render().error).toBe('');
});

it('keeps a file save failure visible through a successful background refresh', async () => {
  window.inheritiTray.inboxOpenFile = vi.fn().mockRejectedValue(new Error('download failed'));
  let inbox = render();
  await inbox.select('conversation');
  inbox = render();
  await inbox.saveFile('file-1');
  inbox = render();
  expect(inbox.error).toBe('Could not save this protected file. Try again while it is available.');
  await inbox.refresh();
  expect(render().error).toBe('Could not save this protected file. Try again while it is available.');
});

it('unlocks the composer after a file upload fails', async () => {
  window.inheritiTray.inboxSendFile = vi.fn().mockRejectedValue(new Error('upload failed'));
  let inbox = render();
  await inbox.select('conversation');
  inbox = render();
  await inbox.sendFile();
  inbox = render();
  expect(inbox.busy).toBe('');
  expect(inbox.sendError).toBe('Could not send the file. Try again.');
});
