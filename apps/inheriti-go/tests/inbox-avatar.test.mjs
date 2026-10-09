import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { InboxAvatar } from '../src/modules/inbox/ui/components/InboxAvatar.jsx';

globalThis.React = React;

it('shows a signed HTTPS photo and falls back to initials without one', () => {
  const photo = 'https://example.invalid/photo';
  const image = renderToStaticMarkup(createElement(InboxAvatar, { name: 'Ada Smith', url: photo }));
  expect(image).toContain('src="https://example.invalid/photo"');
  expect(image).toContain('referrerPolicy="no-referrer"');
  expect(renderToStaticMarkup(createElement(InboxAvatar, { name: 'Ada Smith' }))).toContain('AS</span>');
  expect(renderToStaticMarkup(createElement(InboxAvatar, { name: 'Ada Smith', url: 'http://example.invalid/photo' }))).not.toContain('<img');
});
