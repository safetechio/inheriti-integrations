import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ReadyPlan } from '../src/modules/quick-plan/ui/ReadyPlan.jsx';

const messages = {
  audience: 'Audience', privateAudience: 'Private', teamAudience: 'Team',
  ready: 'Ready', protected: 'Protected', assetTypes: {}, saveAnother: 'Save another', backToHome: 'Home',
};
const state = { teams: [{ id: 'team-1', name: 'New team' }], creation: { planId: 'plan-1', teamId: 'team-1' } };

it('shows the selected audience on the ready screen even when a private plan has a stale team ID', () => {
  globalThis.React = React;
  const render = (readySummary) => renderToStaticMarkup(createElement(ReadyPlan, {
    messages, state, readySummary, onNew() {}, onOpenApp() {}, onHome() {},
  }));

  expect(render({ title: 'Private plan', audience: 'private', teamId: 'team-1' })).toContain('Audience: Private');
  expect(render({ title: 'Team plan', audience: 'team', teamId: 'team-1' })).toContain('Audience: New team');
  expect(render(null)).toContain('Audience: New team');
});
