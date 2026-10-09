import { expect, it, vi } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fetchMembers, mergeMemberAvatars, shouldRefreshMemberPhotos, toggleSelectedMember } from '../src/modules/inbox/ui/hooks/useInboxParticipants.js';
import { InboxMemberPicker } from '../src/modules/inbox/ui/components/InboxMemberPicker.jsx';
import { InboxPresenceDot } from '../src/modules/inbox/ui/components/InboxPresenceDot.jsx';

globalThis.React = React;

it('shows why a member cannot be selected yet', () => {
  const markup = renderToStaticMarkup(createElement(InboxMemberPicker, {
    title: '', setTitle() {}, query: '', setQuery() {}, onSearch() {},
    participants: [{ memberId: 'bea', name: 'Bea', ready: false }],
    ownMemberId: 'ada', memberIds: [], onToggle() {}, onClear() {}, onCreate() {}, names: {},
  }));
  expect(markup).toContain('Not on Inheriti® Go yet');
  expect(markup).toContain('after they open Inheriti® Go');
  expect(markup).toMatch(/type="checkbox"[^>]*disabled=""/);
});

it('offers one retry instead of an empty state when members fail to load', () => {
  const markup = renderToStaticMarkup(createElement(InboxMemberPicker, {
    title: '', setTitle() {}, query: '', setQuery() {}, onSearch() {},
    participants: [], ownMemberId: 'ada', memberIds: [], onToggle() {}, onClear() {}, onCreate() {},
    loadError: 'Could not load members.', onRetry() {}, names: {},
  }));
  expect(markup).toContain('Members unavailable.');
  expect(markup).toContain('Retry');
  expect(markup).not.toContain('No members');
});

it('shows compact presence dots with accessible labels only for known states', () => {
  const render = (status) => renderToStaticMarkup(createElement(InboxPresenceDot, { status }));
  expect(render('Online')).toContain('aria-label="Online"');
  expect(render('Online')).toContain('is-online');
  expect(render('Offline')).toContain('aria-label="Offline"');
  expect(render('Offline')).not.toContain('is-online');
  expect(render('Unknown')).toBe('');
});

it('overlays a known presence dot on the member avatar', () => {
  const markup = renderToStaticMarkup(createElement(InboxMemberPicker, {
    title: '', setTitle() {}, query: '', setQuery() {}, onSearch() {},
    participants: [{ memberId: 'bea', name: 'Bea', ready: true }],
    ownMemberId: 'ada', memberIds: [], onToggle() {}, onClear() {}, onCreate() {}, names: {},
    presenceStatus: () => 'Online',
  }));
  expect(markup).toMatch(/class="inbox-avatar-presence"[^>]*>.*aria-label="Online"/);
});

it('loads every member page beyond the old 25-member limit', async () => {
  const members = Array.from({ length: 125 }, (_, i) => ({ memberId: `${i}`, name: `Member ${i}`, ready: i % 2 === 0 }));
  const inboxMembers = vi.fn(async (_q, offset) => ({ items: members.slice(offset, offset + 100), nextOffset: offset + 100 < members.length ? offset + 100 : null }));
  globalThis.window = { inheritiTray: { inboxMembers } };
  expect((await fetchMembers('ana')).items).toEqual(members);
  expect(inboxMembers.mock.calls).toEqual([['ana', 0], ['ana', 100]]);
});

it('rejects a repeated page offset', async () => {
  globalThis.window = { inheritiTray: { inboxMembers: async () => ({ items: [], nextOffset: 0 }) } };
  await expect(fetchMembers('')).rejects.toThrow('Invalid member page');
});

it('allows a selected member to be removed after they stop being ready', () => {
  const ready = [{ memberId: 'ana', ready: true }];
  const selected = toggleSelectedMember([], ready, 'ana');
  expect(selected).toEqual(['ana']);
  const unready = [{ memberId: 'ana', ready: false }];
  expect(toggleSelectedMember(selected, unready, 'ana')).toEqual([]);
  expect(toggleSelectedMember([], unready, 'ana')).toEqual([]);
});

it('renews signed member photos before their one-hour expiry', () => {
  const loadedAt = 1_000;
  expect(shouldRefreshMemberPhotos(loadedAt, loadedAt + 44 * 60_000)).toBe(false);
  expect(shouldRefreshMemberPhotos(loadedAt, loadedAt + 45 * 60_000)).toBe(true);
});

it('renews cached photos for every member after a filtered search', () => {
  const cached = { ada: 'old-ada', bea: 'old-bea' };
  const searched = mergeMemberAvatars(cached, [{ memberId: 'ada', profilePicture: { url: 'new-ada' } }]);
  expect(searched).toEqual({ ada: 'new-ada', bea: 'old-bea' });
  expect(mergeMemberAvatars(searched, [
    { memberId: 'ada', profilePicture: { url: 'fresh-ada' } },
    { memberId: 'bea', profilePicture: { url: 'fresh-bea' } },
  ])).toEqual({ ada: 'fresh-ada', bea: 'fresh-bea' });
});
