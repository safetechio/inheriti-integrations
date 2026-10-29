import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Home } from '../src/modules/launcher/ui/components/Home.jsx';

globalThis.React = React;
vi.stubGlobal('window', { inheritiTray: { version: async () => '0.0.15' } });

it('hides plan actions when plan creation is disabled', () => {
  const markup = renderToStaticMarkup(createElement(Home, {
    messages: { organization: 'Organisation', chooseOrganization: 'Choose', openApp: 'Open app', signOut: 'Sign out' },
    organizations: [], selectedId: undefined, showPlanActions: false,
  }));
  expect(markup).not.toContain('id="save-plan"');
  expect(markup).not.toContain('id="add-asset"');
  expect(markup).toContain('id="open-inbox"');
});

it('keeps saved accounts in the profile menu and organisations in their own selector', () => {
  const markup = renderToStaticMarkup(createElement(Home, {
    messages: { organization: 'Organisation', chooseOrganization: 'Choose', openApp: 'Open app', signOut: 'Sign out' },
    organizations: [{ id: 'org-a', name: 'Shared Company' }], selectedId: 'org-a', activeSubject: 'a', accountName: 'Alice',
    accounts: [
      { subject: 'a', name: 'Alice', status: 'ready', organizations: [{ id: 'org-a', name: 'Shared Company' }] },
      { subject: 'b', name: 'Bob', status: 'ready', organizations: [{ id: 'org-b', name: 'Shared Company' }] },
    ],
    showPlanActions: false,
  }));
  expect(markup).toContain('Saved accounts');
  expect(markup).toContain('Alice');
  expect(markup).toContain('Bob');
  expect(markup.match(/Shared Company/g)).toHaveLength(1);
  expect(markup).toContain('aria-label="Open account menu"');
  expect(markup).toContain('class="tray-account-option"');
  expect(markup).toContain('Log out of all accounts');
  expect(markup).toContain('id="add-account"');
  expect(markup).not.toContain('refreshToken');
});
