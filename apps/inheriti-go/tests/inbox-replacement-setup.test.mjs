import { expect, it } from 'vitest';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InboxSetup } from '../src/modules/inbox/ui/components/InboxSetup.jsx';

it('shows forward-only history loss and the explicit replacement action', () => {
  globalThis.React = React;
  const markup = renderToStaticMarkup(createElement(InboxSetup, {
    onClose() {}, onRetry() {}, onReplace() {}, organizationSelected: true,
    state: { status: 'replacement_required', message: 'Replace this device.' },
  }));
  expect(markup).toContain('Past Secure Chat history cannot be recovered');
  expect(markup).toContain('Reset Secure Chat on this computer');
  expect(markup).not.toContain('Try setup again');
});
