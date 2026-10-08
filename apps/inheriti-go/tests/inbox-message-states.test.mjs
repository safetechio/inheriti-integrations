import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { InboxMessageList } from '../src/modules/inbox/ui/components/InboxMessageList.jsx';
import { clearPendingSend, finishAcknowledgement, protectedSegmentsForSend } from '../src/modules/inbox/ui/hooks/useInboxMessages.js';

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
  expect(sending).toContain('Sealing on this computer');
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

it('keeps retry available while a pending file plan blocks another one-time open', () => {
  const markup = render({ busy: 'plan-pending', messages: [
    { id: 'file-1', senderMemberId: 'other', status: 'AVAILABLE', recipientStatus: 'LEASED',
      contentKind: 'FILE', createdAt: '2026-10-02T17:14:00.000Z', expiresAt: '2026-10-09T17:14:00.000Z' },
    { id: 'file-2', senderMemberId: 'other', status: 'AVAILABLE', recipientStatus: 'UNREAD',
      contentKind: 'FILE', createdAt: '2026-10-02T17:15:00.000Z', expiresAt: '2026-10-09T17:15:00.000Z' },
  ], revealed: { messageId: 'file-1', acknowledgement: 'PENDING', planPending: true } });
  expect(markup).toContain('File ready for Quick Plan. Confirm the read to continue.');
  expect(markup).toMatch(/<button[^>]*>Retry acknowledgement<\/button>/);
  expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Open file once<\/button>/);
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

it('shows repeatable normal text alongside protected messages without offering a one-time reveal', () => {
  const markup = render({ normalMessages: [{ parentId: 'parent-1', sequence: 2, senderMemberId: 'other',
    senderDeviceId: 'device-2', participantRevision: 1, createdAt: '2026-10-02T17:15:00.000Z',
    text: '<private text>' }], messages: [{ id: 'message-1', senderMemberId: 'me', status: 'AVAILABLE',
    contentKind: 'TEXT', createdAt: '2026-10-02T17:14:00.000Z',
    expiresAt: '2026-10-09T17:14:00.000Z' }], mode: 'NORMAL' });
  expect(markup.indexOf('Message sealed for recipients.')).toBeLessThan(markup.indexOf('&lt;private text&gt;'));
  expect(markup).toContain('inbox-parent-pill">Normal</span><small>Message');
  expect(markup).not.toContain('<private text>');
  expect(markup).not.toContain('View once');
});

it('shows the one-time reveal steps while opening without displaying plaintext', () => {
  const opening = render({ messages: [{ id: 'message', senderMemberId: 'other', status: 'AVAILABLE',
    recipientStatus: 'UNREAD', contentKind: 'TEXT', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString() }], openingMessageId: 'message', busy: 'opening' });
  expect(opening).toContain('Checking this computer');
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


it('masks marked text in the normal preview and keeps keyboard controls available', () => {
  const markup = render({ mode: 'NORMAL', draft: 'Hello secret', marks: [[6, 12]] });
  const preview = markup.slice(markup.indexOf('class="inbox-composer-preview"'));
  expect(preview).toContain('inbox-preview-secret');
  expect(preview).not.toContain('Hello secret');
  expect(markup).toContain('Right-click selected text to make it secret or unmark it');
  expect(markup).toContain('aria-label="Resize composer"');
  expect(markup).toContain('aria-expanded="true"');
});

it('renders ordered parent segments without protected plaintext before reveal', () => {
  const parent = { parentId: 'parent-1', sequence: 3, mode: 'MIXED', status: 'AVAILABLE',
    senderMemberId: 'other', createdAt: '2026-10-02T17:16:00.000Z',
    segments: [{ text: 'Hello ' }, { unitId: 'unit-1', position: 1, status: 'UNREAD' }, { text: ' today' }] };
  const markup = render({ parentMessages: [parent], unitReveals: { units: new Map(), now: Date.now(), reveal() {}, revealAll() {}, retry() {}, hide() {} } });
  expect(markup).toContain('Hello ');
  expect(markup).toContain('aria-label="Reveal protected part 2"');
  expect(markup).toContain('Tap the blurred text to reveal.');
  expect(markup).toContain(' today');
  expect(markup).not.toContain('secret value');
});

it('keeps consumed and expired parent units sealed while a revealed unit has a timer', () => {
  const parent = { parentId: 'parent-2', sequence: 4, mode: 'MIXED', status: 'AVAILABLE',
    senderMemberId: 'me', createdAt: '2026-10-02T17:17:00.000Z',
    segments: [{ unitId: 'unit-read', position: 0, status: 'CONSUMED' },
      { unitId: 'unit-expired', position: 1, status: 'EXPIRED' },
      { unitId: 'unit-open', position: 2, status: 'UNREAD' }] };
  const markup = render({ parentMessages: [parent], unitReveals: { units: new Map([
    ['unit-open', { text: 'revealed only here', hideAt: Date.now() + 10000, acknowledgement: 'ACKNOWLEDGED' }],
  ]), now: Date.now(), reveal() {}, revealAll() {}, retry() {}, hide() {} } });
  expect(markup).toContain('Read');
  expect(markup).toContain('Expired');
  expect(markup).toContain('revealed only here');
  expect(markup).toContain('Hides in');
  expect(markup).not.toContain('Reveal once');
});

it('offers plan handoff only while protected text and its transient suggestion are visible', () => {
  const message = { id: 'legacy-1', senderMemberId: 'other', status: 'AVAILABLE', recipientStatus: 'UNREAD',
    contentKind: 'TEXT', createdAt: '2026-10-02T17:18:00.000Z', expiresAt: '2026-10-09T17:18:00.000Z' };
  const suggestion = { title: 'Saved message', assetType: 'PLAIN-TEXT', fields: { text: 'secret' } };
  const sealed = render({ messages: [message], onCreatePlanFromSecret() {} });
  expect(sealed).not.toContain('Create plan from secret');
  const revealed = render({ messages: [message], onCreatePlanFromSecret() {},
    revealed: { messageId: 'legacy-1', text: 'secret', suggestion, hideAt: Date.now() + 10000, acknowledgement: 'ACKNOWLEDGED' } });
  expect(revealed).toContain('Create plan from secret');
  const hidden = render({ messages: [message], onCreatePlanFromSecret() {},
    revealed: { messageId: 'legacy-1', acknowledgement: 'PENDING' } });
  expect(hidden).not.toContain('Create plan from secret');
});

it('keeps failed-send guidance beside an editable marked draft', () => {
  const markup = render({ mode: 'NORMAL', draft: 'Hello secret', marks: [[6, 12]],
    sendError: 'Could not send the message. Your text is still here.' });
  expect(markup).toContain('class="inbox-preview-secret"');
  expect(markup).toContain('Your text is still here.');
  expect(markup).toContain('role="alert"');
  expect(markup).toContain('>Hello secret</textarea>');
});

it('reuses protected expiry and parent ID on retry, then resets both when the draft changes', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
    const pending = { parentId: 'parent-1', expiresAt: '' };
    const segments = [{ text: 'Hello ' }, { protectedText: 'secret' }];
    const first = protectedSegmentsForSend(segments, pending);
    const expiry = pending.expiresAt;
    expect(first[1]).toEqual({ protectedText: 'secret', expiresAt: expiry });
    vi.setSystemTime(new Date('2026-10-05T12:10:00.000Z'));
    expect(protectedSegmentsForSend(segments, pending)).toEqual(first);
    expect(pending.parentId).toBe('parent-1');

    clearPendingSend(pending);
    expect(pending).toEqual({ parentId: '', expiresAt: '' });
    expect(protectedSegmentsForSend(segments, pending)[1].expiresAt).not.toBe(expiry);
  } finally {
    vi.useRealTimers();
  }
});
