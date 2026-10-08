import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { InboxConversationList } from '../src/modules/inbox/ui/components/InboxConversationList.jsx';
import { InboxMemberPicker } from '../src/modules/inbox/ui/components/InboxMemberPicker.jsx';
import { InboxMessageList } from '../src/modules/inbox/ui/components/InboxMessageList.jsx';

it('shows accessible skeletons while Inbox collections load', () => {
  globalThis.React = React;
  const views = [
    [InboxConversationList, { conversations: [], names: {}, busy: 'loading' }, 'Loading conversations…'],
    [InboxMemberPicker, { query: '', participants: [], memberIds: [], names: {}, searchBusy: 'searching' }, 'Searching members…'],
    [InboxMessageList, { messages: [], names: {}, draft: '', busy: 'loading' }, 'Loading messages…'],
  ];
  for (const [Component, props, label] of views) {
    const markup = renderToStaticMarkup(createElement(Component, props));
    expect(markup).toContain('class="inbox-skeleton');
    expect(markup).toContain('role="status"');
    expect(markup).toContain(label);
    expect(markup).not.toContain('No conversations yet');
    expect(markup).not.toContain('No protected messages yet');
  }
});

it('shows only safe latest-message metadata in conversation rows', () => {
  globalThis.React = React;
  const createdAt = new Date().toISOString();
  const markup = renderToStaticMarkup(createElement(InboxConversationList, {
    conversations: [{ id: 'conversation', participantMemberIds: ['me', 'ana'], unreadCount: 2,
      latestMessage: { contentKind: 'FILE', senderMemberId: 'me', createdAt } }],
    names: { ana: 'Ana Torres' }, ownMemberId: 'me',
  }));
  expect(markup).toContain('Ana Torres');
  expect(markup).toContain('You: Protected file');
  expect(markup).toContain('2 unread');
  expect(markup).toContain('<time>');
  expect(markup).not.toContain('End-to-end encrypted');
});

it('shows the shared conversation title and requires it when starting a conversation', () => {
  globalThis.React = React;
  const list = renderToStaticMarkup(createElement(InboxConversationList, {
    conversations: [{ id: 'conversation', title: 'Project handover', participantMemberIds: ['me', 'ana'], unreadCount: 0 }],
    names: { ana: 'Ana Torres' }, ownMemberId: 'me',
  }));
  const picker = renderToStaticMarkup(createElement(InboxMemberPicker, {
    title: '', query: '', participants: [], memberIds: ['ana'], names: { ana: 'Ana Torres' },
  }));
  expect(list).toContain('Project handover');
  expect(picker).toContain('id="inbox-conversation-title"');
  expect(picker).toContain('required=""');
  expect(picker).toContain('Start conversation</button>');
});
