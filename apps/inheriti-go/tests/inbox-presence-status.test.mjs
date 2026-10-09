import { expect, it } from 'vitest';
import { clearInboxPresence, currentInboxPresence, inboxPresenceStatus, rememberInboxPresence } from '../src/modules/inbox/ui/hooks/useInboxPanel.js';

it('uses local receipt time for presence despite server clock skew', () => {
  const presence = { tenantId: 'organisation-1', connected: true, memberIds: ['member-1'],
    checkedAt: '2000-01-01T00:00:00.000Z', receivedAt: 100 };

  expect(inboxPresenceStatus(presence, 'member-1', 'organisation-1', 200)).toBe('Online');
  expect(inboxPresenceStatus(presence, 'member-2', 'organisation-1', 200)).toBe('Offline');
  expect(inboxPresenceStatus(presence, 'member-1', 'organisation-1', 45_101)).toBe('Unknown');
  expect(inboxPresenceStatus(presence, 'member-1', 'organisation-2', 200)).toBe('Unknown');
  expect(inboxPresenceStatus({ ...presence, connected: false }, 'member-1', 'organisation-1', 200)).toBe('Unknown');
  expect(inboxPresenceStatus({ ...presence, memberIds: undefined }, 'member-1', 'organisation-1', 200)).toBe('Unknown');
});

it('replays only recent presence and clears it across account or organisation changes', () => {
  clearInboxPresence();
  expect(rememberInboxPresence({ kind: 'NEW_MESSAGE' })).toBeNull();
  expect(currentInboxPresence()).toBeNull();
  const current = rememberInboxPresence({ kind: 'PRESENCE', tenantId: 'organisation-1', connected: true, memberIds: ['member-1'] });
  expect(currentInboxPresence()).toBe(current);
  expect(inboxPresenceStatus(currentInboxPresence(), 'member-1', 'organisation-1', performance.now())).toBe('Online');
  expect(inboxPresenceStatus(currentInboxPresence(), 'member-1', 'organisation-1', current.receivedAt + 45_001)).toBe('Unknown');
  rememberInboxPresence({ kind: 'PRESENCE', tenantId: 'organisation-1', connected: false });
  expect(inboxPresenceStatus(currentInboxPresence(), 'member-1', 'organisation-1', performance.now())).toBe('Unknown');
  clearInboxPresence();
  expect(currentInboxPresence()).toBeNull();
});
