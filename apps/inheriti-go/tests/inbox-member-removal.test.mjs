import { expect, it, vi } from 'vitest';
import React from 'react';

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal(),
  useState: () => ['', () => {}],
}));

import { InboxConversationMembers } from '../src/modules/inbox/ui/components/InboxConversationMembers.jsx';

function findRemoveButton(node) {
  if (Array.isArray(node)) return node.map(findRemoveButton).find(Boolean);
  if (!node || typeof node !== 'object') return undefined;
  if (node.type === 'button' && node.props['aria-label'] === 'Remove Alice') return node;
  return findRemoveButton(node.props?.children);
}

it('asks before removing a member and makes no API call when canceled', () => {
  globalThis.React = React;
  const onChange = vi.fn();
  const conversation = { creatorMemberId: 'creator', participantMemberIds: ['creator', 'alice', 'bob'] };
  const element = InboxConversationMembers({
    conversation, ownMemberId: 'creator', participants: { items: [], query: '', search() {} },
    names: { alice: 'Alice' }, busy: false, onChange,
  });
  const button = findRemoveButton(element);
  expect(button).toBeDefined();
  const confirm = vi.fn().mockReturnValue(false);
  vi.stubGlobal('window', { confirm });
  button.props.onClick();
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Remove Alice'));
  expect(confirm.mock.calls[0][0]).toContain('unread messages and pending access will be permanently lost');
  expect(onChange).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  button.props.onClick();
  expect(onChange).toHaveBeenCalledExactlyOnceWith(conversation, 'REMOVE', 'alice');
  vi.unstubAllGlobals();
});
