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

import { clearInboxConversationCache, useInboxConversations } from '../src/modules/inbox/ui/hooks/useInboxConversations.js';

function render(organizationId = 'org-a', memberId = 'member-a') {
  hooks.cursor = 0;
  const inbox = useInboxConversations(organizationId, memberId);
  if (hooks.first) { hooks.first = false; hooks.effects.forEach(effect => effect()); }
  return inbox;
}

beforeEach(() => {
  clearInboxConversationCache();
  hooks.slots = [];
  hooks.cursor = 0;
  hooks.effects = [];
  hooks.first = true;
  globalThis.window = { inheritiTray: { inboxConversations: vi.fn(async () => ({ items: [{ id: 'one' }] })) } };
});

it('shows a recent conversation list immediately on re-entry and refreshes it in the background', async () => {
  render();
  await vi.waitFor(() => expect(render().items).toEqual([{ id: 'one' }]));
  hooks.slots = []; hooks.effects = []; hooks.first = true;
  let finish;
  window.inheritiTray.inboxConversations.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const reopened = render();
  expect(reopened.items).toEqual([{ id: 'one' }]);
  expect(reopened.busy).toBe('');
  finish({ items: [{ id: 'two' }] });
  await vi.waitFor(() => expect(render().items).toEqual([{ id: 'two' }]));
});

it('does not reuse a list for another member or after cache clear', async () => {
  render();
  await vi.waitFor(() => expect(render().items).toHaveLength(1));
  hooks.slots = []; hooks.effects = []; hooks.first = true;
  expect(render('org-a', 'member-b').items).toEqual([]);
  clearInboxConversationCache();
  hooks.slots = []; hooks.effects = []; hooks.first = true;
  expect(render().items).toEqual([]);
});
