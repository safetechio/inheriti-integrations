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
