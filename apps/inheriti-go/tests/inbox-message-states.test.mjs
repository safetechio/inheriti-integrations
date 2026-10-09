import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { InboxMessageList } from '../src/modules/inbox/ui/components/InboxMessageList.jsx';
import { InboxRevealProgress } from '../src/modules/inbox/ui/components/InboxRevealProgress.jsx';
import { clearPendingSend, finishAcknowledgement, isOrganisationKeyUnavailable, protectedSegmentsForSend } from '../src/modules/inbox/ui/hooks/useInboxMessages.js';

globalThis.React = React;

it('recognises missing Organisation Key errors without treating unrelated failures as key errors', () => {
  expect(isOrganisationKeyUnavailable(new Error('MasterKeyRequired: master_key_required'))).toBe(true);
  expect(isOrganisationKeyUnavailable(new Error('master_key_required'))).toBe(true);
  expect(isOrganisationKeyUnavailable(new Error('INBOX_UNAVAILABLE'))).toBe(false);
  expect(isOrganisationKeyUnavailable(new Error('inbox_file_too_large'))).toBe(false);
});

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

it('shows actual protected send progress and a pending read without plaintext', () => {
  const preparing = render({ pendingMessage: { conversationId: 'conversation', parentId: 'parent',
    protectedSend: true, completed: 0, total: 3, status: 'sending', text: '' } });
  expect(preparing).toContain('Sealing 3 protected parts…');
  expect(preparing).not.toContain('1/3');
  expect(preparing).toContain('<circle cx="10" cy="10" r="7"></circle>');
  expect(preparing).not.toContain('Delivered');
  const sending = render({ busy: 'sending', draft: 'protected draft', pendingMessage: {
    conversationId: 'conversation', parentId: 'parent', protectedSend: true, completed: 1, total: 3, status: 'sending', text: '',
  } });
  expect(sending).toContain('Sealing protected text 2/3');
  expect(sending).toContain('class="inbox-pending-footer" role="status"');
  expect(sending).toMatch(/inbox-pending-footer[\s\S]*Sealing protected text 2\/3[\s\S]*inbox-progress-track/);
  expect(sending.match(/<article class="inbox-thread-message is-own inbox-pending-message"[\s\S]*?<\/article>/)?.[0]).not.toContain('protected draft');
  expect(sending).toContain('You · Sending');

  const failed = render({ draft: 'editable', pendingMessage: { conversationId: 'conversation', parentId: 'parent',
    protectedSend: false, completed: 0, total: 0, status: 'failed', text: 'editable' } });
  expect(failed).toContain('Not sent');
  expect(failed).toContain('Retry');

  const sent = { conversationId: 'conversation', parentId: 'parent', protectedSend: false,
    completed: 0, total: 0, status: 'sent', text: 'accepted text' };
  expect(render({ acceptedMessages: [sent], draft: 'next draft' })).toContain('Syncing…');
  const second = { ...sent, parentId: 'parent-2', text: 'second accepted' };
  const awaiting = render({ acceptedMessages: [sent, second], draft: 'next draft' });
  expect(awaiting.match(/Syncing…/g)).toHaveLength(2);
  const loaded = render({ acceptedMessages: [sent, second], normalMessages: [{ parentId: 'parent', senderMemberId: 'me',
    text: 'accepted text', createdAt: new Date().toISOString() }] });
  expect(loaded.match(/Syncing…/g)).toHaveLength(1);
  expect(loaded.match(/accepted text/g)).toHaveLength(1);

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
      contentKind: 'FILE', createdAt: '2026-10-02T17:14:00.000Z', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    { id: 'file-2', senderMemberId: 'other', status: 'AVAILABLE', recipientStatus: 'UNREAD',
      contentKind: 'FILE', createdAt: '2026-10-02T17:15:00.000Z', expiresAt: new Date(Date.now() + 60_000).toISOString() },
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

it('shows one-time reveal activity without displaying plaintext', () => {
  const opening = render({ messages: [{ id: 'message', senderMemberId: 'other', status: 'AVAILABLE',
    recipientStatus: 'UNREAD', contentKind: 'TEXT', createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString() }], openingMessageId: 'message', busy: 'opening' });
  expect(opening).toContain('Opening protected message…');
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
  expect(markup).toContain('aria-label="Attach a protected file up to 10 MB"');
  expect(markup).toContain('aria-label="Send message"');
  expect(markup).toContain('aria-label="Message mode"');
  expect(markup).toContain('rows="1"');
});

it('renders ordered parent segments without protected plaintext before reveal', () => {
  const parent = { parentId: 'parent-1', sequence: 3, mode: 'MIXED', status: 'AVAILABLE',
    senderMemberId: 'other', createdAt: '2026-10-02T17:16:00.000Z',
    segments: [{ text: 'Hello ' }, { unitId: 'unit-1', position: 1, status: 'UNREAD' }, { text: ' today' }] };
  const markup = render({ parentMessages: [parent], unitReveals: { units: new Map(), now: Date.now(), reveal() {}, revealAll() {}, retry() {}, hide() {} } });
  expect(markup).toContain('Hello ');
  expect(markup).toContain('aria-label="Reveal protected part 1"');
  expect(markup).toContain('Tap the blurred text to reveal.');
  expect(markup).toContain(' today');
  expect(markup).not.toContain('secret value');
});

it('shows one compact progress row inside a mixed message while opening one of several secrets', () => {
  const parent = { parentId: 'parent-3', sequence: 5, mode: 'MIXED', status: 'AVAILABLE',
    senderMemberId: 'other', createdAt: '2026-10-02T17:16:00.000Z', segments: [
      { unitId: 'unit-1', position: 0, status: 'UNREAD' }, { text: ' and ' },
      { unitId: 'unit-2', position: 2, status: 'UNREAD' }, { text: ' then ' },
      { unitId: 'unit-3', position: 4, status: 'UNREAD' },
    ] };
  const markup = render({ parentMessages: [parent], busy: 'opening-unit', unitReveals: {
    units: new Map(), now: Date.now(), openingUnitId: 'unit-2',
    openingProgress: { current: 2, total: 3, remaining: true }, reveal() {}, revealAll() {}, retry() {}, hide() {},
  } });
  expect(markup).toContain('Opening remaining secret 2 of 3');
  expect(markup.match(/class="inbox-unit-progress"/g)).toHaveLength(1);
  expect(markup).not.toContain('inbox-opening-overlay');
  expect(markup).not.toContain('secret value');
});

it('counts protected parts independently of normal text and shows one active reveal', () => {
  const parent = { parentId: 'parent-3', sequence: 5, mode: 'MIXED', status: 'AVAILABLE',
    senderMemberId: 'other', createdAt: '2026-10-02T17:16:00.000Z',
    segments: [{ text: 'A' }, { unitId: 'unit-1', position: 1, status: 'UNREAD' },
      { text: 'B' }, { unitId: 'unit-2', position: 3, status: 'UNREAD' },
      { text: 'C' }, { unitId: 'unit-3', position: 5, status: 'UNREAD' }] };
  const markup = render({ parentMessages: [parent], unitReveals: { units: new Map(), now: Date.now(), reveal() {}, revealAll() {}, retry() {}, hide() {} } });
  expect(markup).toContain('Reveal protected part 1');
  expect(markup).toContain('Reveal protected part 2');
  expect(markup).toContain('Reveal protected part 3');
  expect(markup).not.toContain('Reveal protected part 4');

  const progress = renderToStaticMarkup(createElement(InboxRevealProgress, { progress: { current: 2, total: 3 } }));
  expect(progress).toContain('Opening secret 2 of 3');
  expect(progress).not.toContain('<ol>');
  expect(progress).not.toContain('Checking this computer');
});

it('shows one bar and keeps reveal actions together while another part opens', () => {
  const now = Date.now();
  const parent = { parentId: 'parent-4', sequence: 6, mode: 'MIXED', status: 'AVAILABLE',
    senderMemberId: 'other', createdAt: '2026-10-02T17:16:00.000Z',
    segments: [{ text: 'Before ' }, { unitId: 'unit-1', position: 1, status: 'UNREAD' },
      { text: ' and ' }, { unitId: 'unit-2', position: 3, status: 'UNREAD' },
      { text: ' after ' }, { unitId: 'unit-3', position: 5, status: 'UNREAD' }] };
  const markup = render({ parentMessages: [parent], busy: 'opening-unit', unitReveals: {
    units: new Map([['unit-1', { text: 'visible', hideAt: now + 28000, acknowledgement: 'ACKNOWLEDGED' }]]),
    now, openingUnitId: 'unit-2', openingProgress: { current: 2, total: 3, remaining: true },
    reveal() {}, revealAll() {}, retry() {}, hide() {},
  } });
  expect(markup).toContain('Opening remaining secret 2 of 3');
  expect(markup.match(/class="inbox-progress-track/g)).toHaveLength(1);
  expect(markup).toMatch(/class="inbox-parent-actions"[\s\S]*Hide now[\s\S]*Reveal all/);
  expect(markup).toContain('Before ');
  expect(markup).toContain(' after ');
});

it('uses one countdown for the next of several visible protected parts', () => {
  const now = Date.now();
  const parent = { parentId: 'parent-5', sequence: 7, mode: 'PROTECTED', status: 'AVAILABLE',
    senderMemberId: 'other', createdAt: '2026-10-02T17:16:00.000Z',
    segments: [{ unitId: 'unit-1', position: 0, status: 'UNREAD' }, { unitId: 'unit-2', position: 1, status: 'UNREAD' }] };
  const markup = render({ parentMessages: [parent], unitReveals: {
    units: new Map([['unit-1', { text: 'first', hideAt: now + 20000 }], ['unit-2', { text: 'second', hideAt: now + 10000 }]]),
    now, reveal() {}, revealAll() {}, retry() {}, hide() {},
  } });
  expect(markup.match(/class="inbox-progress-track/g)).toHaveLength(1);
  expect(markup).toContain('Next hides in 10s');
  expect(markup).toContain('Hide all');
  expect(markup).toMatch(/class="inbox-parent-action-row"[^>]*>.*Hide all.*Options/);
  expect(markup).toContain('aria-expanded="false"');
  expect(markup).toContain('class="inbox-parent-options" hidden=""');
  expect(markup).toContain('class="inbox-action-link"');
  expect(markup).toContain('Secret 1 of 2');
  expect(markup).toContain('Previous visible secret');
  expect(markup).toContain('Next visible secret');
  expect(markup).toContain('Hide protected part 1 now');
  expect(markup).not.toContain('Hide protected part 2 now');
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
