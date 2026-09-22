import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const main = readFileSync(new URL('../src/side-panel/main.ts', import.meta.url), 'utf8');
const html = readFileSync(new URL('../src/side-panel/index.html', import.meta.url), 'utf8');

describe('side-panel access workspace', () => {
  it('keeps metadata viewing and access separate', () => {
    expect(main).toContain("actionButton('Access'");
    expect(main).toContain("actionButton('View assets'");
    expect(main).toContain("type: 'load-access-workspace'");
    expect(main).toContain("type: 'load-plan-assets'");
    expect(main).toContain('response.suggestions');
    expect(html).toContain('Only plans with username, email, or password fields available for autofill.');
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
    expect(main).toContain('All side-panel features remain available');
    expect(main).toContain('The side panel remains fully functional');
    expect(main).toContain('chrome.permissions.request');
    expect(main).toContain('`${enabledOrigin}/*`');
  });

  it('limits Plan Access while signed out without hiding Browser Protection', () => {
    expect(html).toContain('id="app-main" data-authenticated="false"');
    expect(html).toContain('id="signed-out-view"');
    expect(html).toContain('Connect your account before viewing plans, inspecting fields, or enabling site autofill.');
    expect(main).toContain('appMain.dataset.authenticated = String(signedIn)');
    expect(main).toContain('planAccessPanel.dataset.authenticated = String(signedIn)');
    expect(html).toContain('id="browser-protection-panel"');
    expect(main).toContain("state.kind === 'SIGNING_IN' ? 'Signing in…' : 'Sign in'");
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
});
