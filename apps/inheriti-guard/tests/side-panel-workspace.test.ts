import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accountDisplayName } from '../src/side-panel/main/accounts.js';

const main = ['main.ts', 'main/accounts.ts', 'main/dom.ts', 'main/overlay.ts', 'main/plans.ts', 'main/workspace.ts']
  .map((file) => readFileSync(new URL(`../src/side-panel/${file}`, import.meta.url), 'utf8')).join('\n');
const html = readFileSync(new URL('../src/side-panel/index.html', import.meta.url), 'utf8');

describe('side-panel access workspace', () => {
  it('keeps plan rows for metadata viewing without an Access button', () => {
    expect(main).not.toContain("actionButton('Access'");
    expect(main).toContain("actionButton('View assets'");
    expect(main).toContain("type: 'load-plan-assets'");
    expect(main).toContain("type: 'start-page-first-picker'");
    expect(html).toContain('Only plans with username, email, or password fields available for autofill.');
  });

  it('keeps key removal in plan controls with an explicit loaded state', () => {
    expect(html.indexOf('id="forget-master-key"')).toBeGreaterThan(html.indexOf('id="plan-tools"'));
    expect(main).toContain("keyOwner === 'Organization' ? 'organisation' : 'application'");
    expect(main).toContain('`Clear ${owner} key`');
    expect(main).toContain("forgetKey.hidden = !loaded || planAccessPanel.dataset.authenticated !== 'true'");
    expect(main).not.toContain('key not in memory');
    expect(main).toContain('forgetKey.disabled = !loaded');
  });

  it('uses the frozen mapping and batch messages', () => {
    for (const type of ['load-page-first-candidates', 'select-page-first-candidate', 'set-access-mapping', 'remove-access-mapping', 'start-page-field-picker', 'reveal-and-autofill']) {
      expect(main).toContain(`type: '${type}'`);
    }
    expect(main).toContain('validateAccessBatch(batch).valid');
    expect(main).not.toContain("type: 'fill-field'");
  });

  it('lets every discovered page field open a protected asset chooser', () => {
    expect(html).toContain('id="pick-page-field"');
    expect(html).toContain('Select a field on the page');
    expect(main).toContain("type: 'start-page-first-picker'");
    expect(main).toContain('showPageFirstChooser(target, response.candidates)');
    expect(html).toContain('id="page-field-list"');
    expect(main).toContain("compactButton('Choose asset')");
    expect(main).toContain("compactButton('Use this asset')");
    expect(main).toContain("compactButton('Change plan')");
    expect(main).toContain('Replace all current mappings');
    expect(main).toContain('candidate.planName');
    expect(main).toContain('field.matchesOrigin');
  });

  it('offers editable mappings, observed progress, and field results in a native dialog', () => {
    expect(html).toMatch(/<dialog[^>]+id="access-dialog"/u);
    for (const id of ['mapping-workspace', 'reveal-progress', 'field-results']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('Reveal and autofill');
    expect(main).toContain("compactButton('Accept suggestion')");
    expect(main).toContain('suggestion.confidence');
    expect(main).toContain('suggestionReason(suggestion.reason)');
    expect(main).not.toContain('function suggestions(');
    expect(main).toContain("'Select field on page'");
    expect(main).toContain("compactButton('Remove'");
  });

  it('renders metadata as text and requires cancel while revealing', () => {
    expect(main).not.toContain('innerHTML');
    expect(main).toContain('node.textContent = text');
    expect(main).toContain("accessDialog.addEventListener('cancel'");
    expect(main).toContain('event.preventDefault()');
    expect(main).toContain("type: 'cancel-reveal'");
    expect(main).toContain("type: 'discard-access-workspace'");
    expect(main).toContain("type: 'cancel-page-field-picker'");
  });

  it('keeps exact-origin overlay access optional and the full panel as fallback', () => {
    expect(html).toContain('Enable autofill on this site');
    expect(html).toContain('id="authorized-origin-list"');
    expect(html).toContain('Revoke all site access');
    for (const type of ['get-overlay-permissions', 'enable-overlay-current-origin', 'disable-overlay-origin', 'disable-all-overlays']) {
      expect(main).toContain(`'${type}'`);
    }
    expect(main).not.toContain('Side panel only');
    expect(main).toContain('Enable site access to show autofill controls');
    expect(main).toContain('chrome.permissions.request');
    expect(main).toContain('`${enabledOrigin}/*`');
  });

  it('limits Plan Access while signed out without hiding Browser Protection', () => {
    expect(html).toContain('id="app-main" data-authenticated="pending"');
    expect(html).toContain('id="signed-out-view"');
    expect(html).toContain('Connect your account before viewing plans, inspecting fields, or enabling site autofill.');
    expect(main).toContain('appMain.dataset.authenticated = String(signedIn)');
    expect(main).toContain('planAccessPanel.dataset.authenticated = String(signedIn)');
    expect(html).toContain('id="browser-protection-panel"');
    expect(main).toContain("chooseSavedAccount ? 'Add another account' : 'Sign in'");
    expect(html).toContain('id="saved-account-list"');
    expect(main).toContain("chooseSavedAccount ? 'Choose an account' : 'Sign in to continue'");
    expect(main).toContain("request.type === 'switch-account' ? undefined : confirmation");
  });

  it('groups site controls and fields apart from plans', () => {
    for (const [tab, panel] of [['site-tab', 'site-panel'], ['plans-tab', 'plans-panel']]) {
      expect(html).toContain(`id="${tab}" role="tab"`);
      expect(html).toContain(`aria-controls="${panel}"`);
      expect(html).toContain(`id="${panel}" role="tabpanel"`);
    }
    expect(html).toContain('id="autofill-panel"');
    expect(html).toContain('id="fields-panel"');
    expect(main).toContain("['ArrowLeft', 'ArrowRight', 'Home', 'End']");
  });

  it('keeps account destinations grouped, confirmed, and free of credential markup', () => {
    expect(html).toContain('id="account-list"');
    expect(html).toContain('id="add-account"');
    expect(html).not.toContain('account-add-note');
    expect(main).not.toContain('This clears your SafeID browser sign-in');
    expect(html).toContain('id="sign-out-all"');
    expect(html).toContain('id="access-account"');
    expect(html).toContain('id="organization-summary-label"');
    expect(html).toContain('aria-label="Choose organisation"');
    expect(main).toContain("required<HTMLElement>('organization-summary')");
    expect(main).toContain('organizationSummary.focus()');
    expect(html).toContain('d="m6 9 6 6 6-6"');
    expect(main).toContain("type: 'switch-account'");
    expect(main).toContain("type: 'select-organization'");
    expect(html).toMatch(/<dialog[^>]+id="account-confirm-dialog"/u);
    expect(html).toContain('method="dialog"');
    expect(main).toContain("await confirmAccountAction(request.type === 'remove-account' ? 'Unlink account?' : confirmation");
    expect(html).toContain('id="account-confirm-person"');
    expect(main).toContain("request.type === 'remove-account' ? 'Unlink account'");
    expect(main).toContain("el('strong', 'account-label', name)");
    expect(main).toContain("el('span', 'account-meta', account.role.trim())");
    expect(main).toContain('`Switch to ${name}?`');
    expect(main).toContain('`Unlink ${name}?`');
    expect(main).not.toContain('innerHTML');
  });

  it('shows individual account removal on hover or keyboard focus', () => {
    const styles = readFileSync(new URL('../src/side-panel/styles.css', import.meta.url), 'utf8');
    expect(html).not.toContain('id="manage-accounts"');
    expect(styles).toContain('.account-row:hover .account-actions, .account-row:focus-within .account-actions { opacity: 1; }');
    expect(styles).toContain('@media (hover: none) { .account-actions { opacity: 1; } }');
    expect(main).toContain("compactButton('×')");
    expect(main).toContain('remove.title = `Unlink ${name} from this browser`');
    expect(html).toContain('id="sign-out-all"');
  });

  it('masks protected content during Add Account and avoids promising an expired account was selected', () => {
    expect(main).toContain("addAccount.addEventListener('click', () => {");
    expect(main).toContain("accountMenu!.open = false;\n  addAccount.disabled = true;\n  authStatus.textContent = 'Adding account'");
    expect(main).not.toContain("accountList.querySelectorAll<HTMLButtonElement>('.account-switch')");
    expect(main).toContain("planAccessPanel.dataset.authenticated = 'pending';\n    required('session-skeleton').hidden = false");
    expect(main).toContain("() => requestState('sign-in', true)");
    expect(main).toContain('.filter((account) => !account.needsSignIn)');
    expect(main).not.toContain("el('span', 'account-meta', 'Sign in again')");
    expect(main).not.toContain('account.expiresAt <= Date.now()');
    expect(main).not.toContain("if (needsSignIn) { void requestState('sign-in')");
  });

  it('never presents a saved subject or UUID as an account name', () => {
    const subject = '74782d04-3480-47ea-a133-3ccc1421a36d';
    expect(accountDisplayName({ id: subject, label: subject, subject, issuer: '', environment: '', expiresAt: 0, active: false })).toBe('Saved account');
    expect(accountDisplayName({ id: subject, label: subject, subject, email: 'alice@example.test', issuer: '', environment: '', expiresAt: 0, active: false })).toBe('Saved account');
    expect(accountDisplayName({ id: subject, label: subject, email: subject, subject, issuer: '', environment: '', expiresAt: 0, active: false })).toBe('Saved account');
    expect(accountDisplayName({ id: subject, label: 'Alice', subject, issuer: '', environment: '', expiresAt: 0, active: true })).toBe('Alice');
  });

  it('masks and reconfirms when another panel changes the active profile', () => {
    for (const key of ['inheriti.activeOperatorProfile', 'inheriti.operatorSessionGeneration']) {
      expect(main).toContain(key);
    }
    expect(main).not.toContain("'inheriti.operatorProfiles'");
    expect(main).toContain("renderPanel({ kind: 'LOADING' });\n    planAccessPanel.dataset.authenticated = 'pending';\n    required('session-skeleton').hidden = false;\n    authStatus.textContent = 'Updating account';\n    accessHeaderStatus.textContent = 'Plan Access: updating account';\n    planAccessPanel.setAttribute('aria-busy', 'true');\n    void reconfirmAccountContext();");
    expect(main).toContain("confirmedPanelState(() => send({ type: 'load-plans' })");
    expect(main).toContain('expectedGeneration: panelGeneration');
    expect(main).toContain('startedRevision !== contextRevision');
  });
});
