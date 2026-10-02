import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { InboxMessageList } from '../src/modules/inbox/ui/components/InboxMessageList.jsx';
import { finishAcknowledgement } from '../src/modules/inbox/ui/hooks/useInboxMessages.js';

globalThis.React = React;

function render(props) {
  return renderToStaticMarkup(createElement(InboxMessageList, {
    conversationId: 'conversation', names: { me: 'Me', other: 'Ana' }, ownMemberId: 'me',
    messages: [], draft: '', ...props,
  }));
}

it('does not offer the sender a one-time reveal and shows real recipient status', () => {
  const markup = render({ messages: [{ id: 'message', senderMemberId: 'me', status: 'AVAILABLE',
    contentKind: 'TEXT', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
    recipientStatuses: [{ memberId: 'other', status: 'CONSUMED' }] }] });
  expect(markup).toContain('Message sealed for recipients.');
  expect(markup).toContain('Ana · revealed');
  expect(markup).not.toContain('View once');
  expect(markup).not.toContain('1 unread');
});

it('shows live transfer progress and a pending read without plaintext', () => {
  const sending = render({ busy: 'sending', draft: 'protected draft' });
  expect(sending).toContain('Checking members');
  expect(sending).toContain('Sealing on this device');
  expect(sending).toContain('Sending protected message');
  expect(sending).not.toContain('You · now');

  const choosing = render({ busy: 'sending-file', transfer: null });
  expect(choosing).not.toContain('inbox-send-status');
  expect(choosing).not.toContain('You · now');

  const transfer = render({ busy: 'sending-file', transfer: { stage: 'UPLOADING', completed: 2, total: 4 } });
  expect(transfer).toContain('Uploading encrypted shares');
  expect(transfer).toContain('2 of 4 shares');
  expect(transfer).toContain('inbox-send-status');
  expect(transfer).toContain('width:50%');
  expect(transfer).not.toContain('You · now');

  const pending = render({ messages: [{ id: 'message', senderMemberId: 'other', status: 'AVAILABLE',
    recipientStatus: 'LEASED', contentKind: 'TEXT', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString() }],
    revealed: { messageId: 'message', acknowledgement: 'PENDING' } });
  expect(pending).toContain('Message hidden. Confirm the read to finish.');
  expect(pending).toContain('Retry acknowledgement');
  expect(pending).not.toContain('Hide now');
});

it('places the newest API message at the bottom of the thread', () => {
  const messages = [
    { id: 'newer', senderMemberId: 'other', status: 'AVAILABLE', recipientStatus: 'UNREAD',
      contentKind: 'TEXT', createdAt: '2026-10-02T17:14:00.000Z', expiresAt: '2026-10-09T17:14:00.000Z' },
    { id: 'older', senderMemberId: 'me', status: 'AVAILABLE', contentKind: 'TEXT',
      createdAt: '2026-10-02T17:13:00.000Z', expiresAt: '2026-10-09T17:13:00.000Z' },
  ];
  const markup = render({ messages });
  expect(markup.indexOf('You ·')).toBeLessThan(markup.indexOf('Ana ·'));
});

it('shows the one-time reveal steps while opening without displaying plaintext', () => {
  const opening = render({ messages: [{ id: 'message', senderMemberId: 'other', status: 'AVAILABLE',
    recipientStatus: 'UNREAD', contentKind: 'TEXT', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString() }], openingMessageId: 'message', busy: 'opening' });
  expect(opening).toContain('Checking this device');
  expect(opening).toContain('Unlocking your message');
  expect(opening).toContain('Confirming the one-time read');
  expect(opening).toContain('inbox-status-opening');
  expect(opening).not.toContain('Sample protected message');
});

it('does not restore hidden text when an acknowledgement retry completes', () => {
  const hidden = { messageId: 'message', acknowledgement: 'PENDING' };
  expect(finishAcknowledgement(hidden, 'message', 'PENDING')).toEqual(hidden);
  expect(finishAcknowledgement(hidden, 'message', 'ACKNOWLEDGED')).toBeNull();
  expect(finishAcknowledgement(hidden, 'another-message', 'PENDING')).toBe(hidden);
});
