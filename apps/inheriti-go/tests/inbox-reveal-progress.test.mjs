import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { InboxRevealProgress } from '../src/modules/inbox/ui/components/InboxRevealProgress.jsx';

globalThis.React = React;

it('shows only the active phrase for standalone, single-part, and remaining-part reveals', () => {
  const render = progress => renderToStaticMarkup(createElement(InboxRevealProgress, { progress }));
  expect(render()).toContain('Opening protected message…');
  expect(render({ current: 2, total: 3 })).toContain('Opening secret 2 of 3');
  expect(render({ current: 1, total: 2, remaining: true })).toContain('Opening remaining secret 1 of 2');
  expect(render({ current: 1, total: 2, remaining: true })).not.toContain('<ol>');
});
