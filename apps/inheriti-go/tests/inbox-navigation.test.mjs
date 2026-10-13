import { beforeEach, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ slots: [], cursor: 0 }));
vi.mock('react', async importOriginal => ({
  ...(await importOriginal()),
  useRef(initial) { return hooks.slots[hooks.cursor++] ??= { current: initial }; },
  useState(initial) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = initial;
    return [hooks.slots[index], value => { hooks.slots[index] = value; }];
  },
  useEffect() {},
}));

import { useInboxNavigation } from '../src/modules/inbox/ui/hooks/useInboxNavigation.js';

beforeEach(() => { hooks.slots = []; hooks.cursor = 0; });

it('opens a thread once its first message load is ready and ignores a cancelled opening', async () => {
  let finish;
  const inbox = { messages: { select: vi.fn(() => new Promise(resolve => { finish = resolve; })), leave: vi.fn(() => true) },
    conversations: { refresh: vi.fn(async () => {}) } };
  const render = () => { hooks.cursor = 0; return useInboxNavigation(inbox); };
  const pending = render().openConversation('conversation-1');
  expect(render().screen).toBe('list');
  finish();
  await pending;
  expect(render().screen).toBe('thread');
  expect(inbox.conversations.refresh).toHaveBeenCalledOnce();

  render().goBack();
  const cancelled = render().openConversation('conversation-2');
  render().goBack();
  finish();
  await cancelled;
  expect(render().screen).toBe('list');

  const started = render().openConversation('conversation-3');
  render().startConversation();
  finish();
  await started;
  expect(render().screen).toBe('new');
});
