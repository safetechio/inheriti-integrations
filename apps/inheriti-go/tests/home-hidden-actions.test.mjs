import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { Home } from '../src/modules/launcher/ui/components/Home.jsx';
import { SignedOut } from '../src/modules/launcher/ui/components/SignedOut.jsx';
import { AccountActionDialog } from '../src/modules/launcher/ui/components/AccountActionDialog.jsx';
import { accountDisplayName } from '../src/modules/launcher/ui/components/account-display-name.js';
import { sessionErrorMessage, trayMessages } from '../src/messages.ts';

globalThis.React = React;
vi.stubGlobal('window', { inheritiTray: { version: async () => '0.0.15' } });

it('reuses the account modal for confirmation and in-place switch progress', () => {
  const props = { title: 'Switch account', confirmLabel: 'Switch account', onConfirm() {}, onCancel() {} };
  const confirm = renderToStaticMarkup(createElement(AccountActionDialog, props));
  const progress = renderToStaticMarkup(createElement(AccountActionDialog, { ...props, busy: true }));
  expect(confirm).toContain('<dialog');
  expect(confirm).toContain('tray-account-dialog-cancel');
  expect(confirm).toContain('Switch account</button>');
  expect(progress).toContain('Checking account…');
  expect(progress).not.toContain('Switch account</button>');
});

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
  expect(markup).not.toContain('id="sign-out"');
  expect(markup).not.toContain('Log out of this account');
  expect(markup).toContain('Log out of all accounts');
  expect(markup).toContain('id="add-account"');
  expect(markup).not.toContain('refreshToken');
});

it('shows one logout action and the email beneath a neutral name for one account', () => {
  const subject = '74782d04-3480-47ea-a133-3ccc1421a36d';
  const email = 'javier.carvallo@safetech.io';
  const markup = renderToStaticMarkup(createElement(Home, {
    messages: { organization: 'Organisation', chooseOrganization: 'Choose', openApp: 'Open app' },
    organizations: [], activeSubject: subject, accountName: subject,
    accounts: [{ subject, name: subject, email, status: 'ready' }], showPlanActions: false,
  }));
  expect(markup).toContain('Hello 👋');
  expect(markup).toContain('id="sign-out"');
  expect(markup).toContain('>Log out</button>');
  expect(markup).not.toContain('id="sign-out-all"');
  expect(markup).not.toContain('Account 1');
  expect(markup).not.toContain(subject);
  expect(markup).toContain('<strong title="Saved account">Saved account</strong>');
  expect(markup).toContain(`<small>${email}</small>`);
});

it('offers remaining accounts and lets the user unlink ones that need sign-in again', () => {
  const props = { messages: { appName: 'Inheriti Go', signIn: 'Sign in', openApp: 'Open app' }, status: 'Signed out',
    accounts: [{ subject: 'expired-subject', name: 'expired-subject', status: 'sign-in-again' }] };
  const expired = renderToStaticMarkup(createElement(SignedOut, props));
  expect(expired).toContain('Choose a saved account');
  expect(expired).not.toContain('expired-subject');
  expect(expired).toContain('id="sign-in"');
  expect(expired).toContain('Add another account');
  expect(expired).toContain('Sign in again');
  expect(expired).toContain('aria-label="Unlink Saved account from this device"');

  const mixed = renderToStaticMarkup(createElement(SignedOut, { ...props, accounts: [...props.accounts,
    { subject: 'ready-subject', name: 'Alice', email: 'alice@example.test', status: 'ready' }] }));
  expect(mixed).toContain('Alice');
  expect(mixed).toContain('alice@example.test');
  expect(mixed).not.toContain('expired-subject');
  expect(mixed).toContain('id="sign-out-all"');
  expect(mixed).toContain('tray-account-avatar');
  expect(mixed).toContain('tray-recovery-logoff');
  expect(mixed).toContain('>Switch</button>');
});

it('explains an expired saved session without exposing the remote method error', () => {
  const error = new Error("Error invoking remote method 'tray:activate-account': OperatorReauthenticationRequired: The operator must authenticate again");
  const status = sessionErrorMessage(error, trayMessages.sessionUnavailable);
  expect(status).toBe(trayMessages.signInAgain);
  expect(sessionErrorMessage(new Error('Unauthorized'), trayMessages.sessionUnavailable)).toBe(trayMessages.signInAgain);
  const markup = renderToStaticMarkup(createElement(SignedOut, {
    messages: trayMessages, status, sessionUnavailable: true, accounts: [],
  }));
  expect(markup).toContain('Sign in again</button>');
  expect(markup).not.toContain('retry-session');
  expect(markup).not.toContain('OperatorReauthenticationRequired');
  expect(sessionErrorMessage(new Error("Error invoking remote method 'tray:state': crashed"), trayMessages.sessionUnavailable))
    .toBe(trayMessages.sessionUnavailable);
});

it('uses a readable account label instead of a subject or UUID', () => {
  const subject = '74782d04-3480-47ea-a133-3ccc1421a36d';
  expect(accountDisplayName({ subject, name: subject })).toBe('Saved account');
  expect(accountDisplayName({ subject, name: 'Alice' })).toBe('Alice');
  expect(accountDisplayName({ subject, name: subject, email: 'alice@example.test' })).toBe('Saved account');
  const markup = renderToStaticMarkup(createElement(Home, {
    messages: { organization: 'Organisation', chooseOrganization: 'Choose', openApp: 'Open app', signOut: 'Sign out' },
    organizations: [], selectedId: undefined, accountName: subject, activeSubject: subject,
    accounts: [{ subject, name: subject, status: 'ready' }], showPlanActions: false,
  }));
  expect(markup).toContain('Saved account');
  expect(markup).not.toContain(subject);
});

it('does not repeat an email used as the account label in saved accounts', () => {
  const subject = '74782d04-3480-47ea-a133-3ccc1421a36d';
  const email = 'alice@example.test';
  const markup = renderToStaticMarkup(createElement(SignedOut, {
    messages: { appName: 'Inheriti Go', signIn: 'Sign in', openApp: 'Open app' },
    accounts: [{ subject, name: subject, email, status: 'ready' }],
  }));
  expect(markup.match(/alice@example\.test/g)).toHaveLength(1);
  expect(markup).not.toContain(subject);
});
