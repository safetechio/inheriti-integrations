import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { trayMessages } from '../src/messages.js';
import { PlanEditProgress } from '../src/modules/quick-plan/ui/PlanEditProgress.jsx';
import { PlanEditPanel } from '../src/modules/quick-plan/ui/PlanEditPanel.jsx';

it('shows Business access steps in the order reported by the SDK', () => {
  const markup = renderToStaticMarkup(createElement(PlanEditProgress, {
    messages: trayMessages,
    edit: {
      status: 'loading', phase: 'releasing_custodian_share',
      phaseHistory: ['acquiring_key', 'pending_auth', 'revealing', 'collecting_validators', 'collecting_shares', 'distributing_custodian_share', 'releasing_custodian_share'],
    },
    busy: true,
  }));
  const steps = ['Release the Organisation Key', 'Authentication', 'Collecting validator shares',
    'Collecting encrypted data shares', 'Collecting custodian share', 'Reconstructing and decrypting shares', 'Revealing the data'];
  for (const step of steps) expect(markup).toContain(step);
  for (let index = 1; index < steps.length; index += 1) {
    expect(markup.indexOf(steps[index])).toBeGreaterThan(markup.indexOf(steps[index - 1]));
  }
  expect(markup).toContain('Approve the custodian share release in SafeKey Mobile.');
  expect(markup).not.toContain('Open protected plan');
});

it('shows share collection after authentication without assuming every older plan has a custodian', () => {
  const markup = renderToStaticMarkup(createElement(PlanEditProgress, {
    messages: trayMessages,
    edit: { status: 'loading', phase: 'revealing', phaseHistory: ['acquiring_key', 'pending_auth', 'revealing'] },
    busy: true,
  }));
  expect(markup).toContain('Collecting validator shares');
  expect(markup).toContain('Collecting encrypted data shares');
  expect(markup).not.toContain('Collecting custodian share');
});

it('finishes the key step before showing edit session startup', () => {
  const markup = renderToStaticMarkup(createElement(PlanEditProgress, {
    messages: trayMessages,
    edit: { status: 'loading', phase: 'opening_edit', phaseHistory: ['loading_context', 'acquiring_key', 'opening_edit'] },
    busy: true,
  }));
  expect(markup).toContain('Organisation Key received.');
  expect(markup).toContain('Open edit session');
  expect(markup.indexOf('Release the Organisation Key')).toBeLessThan(markup.indexOf('Open edit session'));
});

it('shows the access failure and retry in the failed step', () => {
  globalThis.React = React;
  const markup = renderToStaticMarkup(createElement(PlanEditPanel, {
    messages: trayMessages,
    state: { edit: { status: 'error', canDiscard: true, plans: [{ id: 'plan-1', name: 'Plan' }], assets: [], phase: 'reconstructing', phaseHistory: ['configuring_custodian_share', 'collecting_shares', 'reconstructing'], message: 'Could not open the protected plan. Retry this step.' } },
    flow: { planId: 'plan-1', action: 'replace', assetId: '', query: '', form: { assetType: 'DOCUMENT' }, busy: false, canceling: false, error: trayMessages.editDiscardFailed,
      setPlanId() {}, setQuery() {}, chooseAction() {}, chooseAsset() {}, retryAccess() {}, cancel() {}, discard() {}, close() {} },
    onOpenApp() {},
  }));
  expect(markup).toContain('Could not open the protected plan. Retry this step.');
  expect(markup).toContain('Configuring custodian share');
  expect(markup).not.toContain('Collecting custodian share');
  expect(markup).toContain('Retry this step</button>');
  expect(markup).toContain('Discard edit');
  expect(markup).toContain(trayMessages.editDiscardFailed);
  expect(markup).not.toContain('edit-mode');
  expect(markup).not.toContain('edit-search');
  expect(markup).not.toContain('tray-footer');
});

it('offers the SafeKey Desktop Tool download when the device is full', () => {
  const markup = renderToStaticMarkup(createElement(PlanEditProgress, {
    messages: trayMessages,
    edit: { status: 'error', canDiscard: true, phase: 'connecting_safekey_pro', phaseHistory: ['configuring_custodian_share', 'connecting_safekey_pro'], message: trayMessages.safeKeyProNoSpace },
    busy: false, onRetry() {},
  }));
  expect(markup).toContain(trayMessages.safeKeyProNoSpace);
  expect(markup).toContain('Download SafeKey Desktop Tool</button>');
  expect(markup).toContain('Retry this step</button>');
});

it('offers retry for a plan-list failure without an edit checkpoint', () => {
  globalThis.React = React;
  const markup = renderToStaticMarkup(createElement(PlanEditPanel, {
    messages: trayMessages,
    state: { edit: { status: 'error', canDiscard: false, plans: [], assets: [], phaseHistory: [], message: trayMessages.editListFailed } },
    flow: { planId: '', action: '', assetId: '', query: '', form: {}, busy: false, canceling: false, error: '', open() {}, cancel() {}, close() {} },
    onOpenApp() {},
  }));
  expect(markup).toContain(trayMessages.editListFailed);
  expect(markup).toContain(trayMessages.retryLoadingPlans);
  expect(markup).not.toContain(trayMessages.discardEdit);
  expect(markup).not.toContain(trayMessages.loadingPlans);
  expect(markup).not.toContain('edit-plan-trigger');
});

it('offers sign-in when plan listing requires a fresh session', () => {
  globalThis.React = React;
  const markup = renderToStaticMarkup(createElement(PlanEditPanel, {
    messages: trayMessages,
    state: { edit: { status: 'error', canDiscard: false, needsSignIn: true, plans: [], assets: [], phaseHistory: [], message: trayMessages.sessionExpired } },
    flow: { planId: '', action: '', assetId: '', query: '', form: {}, busy: false, canceling: false, error: '', open() {}, cancel() {}, close() {} },
    onOpenApp() {}, onSignIn() {},
  }));
  expect(markup).toContain(trayMessages.sessionExpired);
  expect(markup).toContain('>Sign in</button>');
  expect(markup).not.toContain(trayMessages.retryLoadingPlans);
  expect(markup).not.toContain(trayMessages.discardEdit);
});

it.each(Object.values(trayMessages.editAccessFailures))('shows terminal approval title $title in the failed step', (failure) => {
  const markup = renderToStaticMarkup(createElement(PlanEditProgress, {
    messages: trayMessages,
    edit: { status: 'error', canDiscard: true, phase: failure.phase, phaseHistory: ['acquiring_key', 'pending_auth', failure.phase], message: failure.message },
    busy: false, onRetry() {},
  }));
  expect(markup).toContain(failure.title);
  expect(markup).toContain(failure.message);
  expect(markup).toContain('data-state="failed"');
  expect(markup).toContain('aria-hidden="true"><svg');
  expect(markup).not.toContain('aria-current="step"');
  expect(markup).toContain('Request access again</button>');
});

it('shows each named moderator decision and threshold count without exposing identifiers', () => {
  const markup = renderToStaticMarkup(createElement(PlanEditProgress, {
    messages: trayMessages, busy: true,
    edit: { status: 'loading', phase: 'pending_moderation', phaseHistory: ['pending_auth', 'pending_moderation'], approvals: {
      approvedModerators: 1, requiredApprovals: 2,
      moderators: [
        { id: '1', displayName: 'Ada', status: 'APPROVED' }, { id: '2', displayName: 'Grace', status: 'PENDING' },
        { id: '3', displayName: 'Linus', status: 'DENIED' }, { id: '4', displayName: 'Alex', status: 'CANCELED' },
        { id: 'private-id', displayName: 'private-id', status: 'IDLE' },
      ],
    } },
  }));
  for (const text of ['Ada', 'Grace', 'Linus', 'Alex', 'Approved', 'Pending', 'Denied', 'Cancelled', 'Waiting', 'Moderator', '1 of 2 required approvals received']) expect(markup).toContain(text);
  expect(markup).not.toContain('private-id');
  expect(markup).toContain('role="list"');
});

it('labels only canceled moderators as expired when moderation timed out', () => {
  const markup = renderToStaticMarkup(createElement(PlanEditProgress, {
    messages: trayMessages, busy: false,
    edit: { status: 'error', phase: 'pending_moderation', phaseHistory: ['pending_auth', 'pending_moderation'], message: trayMessages.editAccessFailures.edit_moderation_expired.message, approvals: {
      approvedModerators: 1, requiredApprovals: 2,
      moderators: [{ id: '1', displayName: 'Ada', status: 'APPROVED' }, { id: '2', displayName: 'Grace', status: 'CANCELED' }],
    } },
  }));
  expect(markup).toContain('Approved');
  expect(markup).toContain('data-status="EXPIRED"');
  expect(markup).toContain('Expired');
  expect(markup).not.toContain('data-status="CANCELED"');
});
