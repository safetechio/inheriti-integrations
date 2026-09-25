import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { planAvatarSvg } from '@safetech/inheriti-elements-brand';
import { trayMessages } from '../src/messages.js';
import { PlanSummary } from '../src/modules/quick-plan/ui/components/PlanSummary.jsx';

it('renders the Business avatar from the protected plan ID', () => {
  const planId = 'plan-identity';
  const markup = renderToStaticMarkup(createElement(PlanSummary, {
    planId, title: 'New plan', audience: 'All Members', protectedPlan: true, messages: trayMessages,
  }));
  expect(markup).toContain(encodeURIComponent(planAvatarSvg(planId)));
  expect(markup).toContain('data-placeholder="false"');
  const review = renderToStaticMarkup(createElement(PlanSummary, {
    title: 'Draft plan', assetName: 'File', assetType: 'Image', audience: 'All Members', messages: trayMessages,
  }));
  expect(review).toContain('data-placeholder="true"');
  expect(review).toContain(encodeURIComponent(planAvatarSvg('empty')));
});
