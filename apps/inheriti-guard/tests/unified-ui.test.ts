import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync(new URL('../src/side-panel/index.html', import.meta.url), 'utf8');
const panelMain = ['main.ts', 'main/guard.ts']
  .map((file) => readFileSync(new URL(`../src/side-panel/${file}`, import.meta.url), 'utf8')).join('\n');
const blockedMain = readFileSync(new URL('../src/blocked/main.ts', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8')) as Record<string, unknown>;

describe('unified Inheriti® Guard UI', () => {
  it('presents one product with three accessible top-level areas', () => {
    expect(panel).toContain('aria-label="Inheriti® Guard"');
    for (const [tab, view] of [['plan-access-tab', 'plan-access-panel'], ['browser-protection-tab', 'browser-protection-panel'], ['activity-tab', 'activity-panel']]) {
      expect(panel).toContain(`id="${tab}" role="tab"`);
      expect(panel).toContain(`aria-controls="${view}"`);
      expect(panel).toContain(`id="${view}" class="product-panel`);
    }
    expect(panelMain).toContain('moveTabFocus(productTabs');
  });

  it('keeps Browser Protection usable outside Plan Access authentication', () => {
    expect(panel).toMatch(/<section id="plan-access-panel"[^>]+data-authenticated="pending"/u);
    expect(panel).toMatch(/<section id="browser-protection-panel"/u);
    expect(panelMain).toContain("type: 'guard:get-state'");
    for (const type of ['guard:set-protection', 'guard:set-sensitive-api', 'guard:set-clipboard', 'guard:set-idle-lock', 'guard:set-idle-minutes', 'guard:set-download-trap']) expect(panelMain).toContain(`type: '${type}'`);
  });

  it('confirms Secure Logoff and renders activity without HTML interpretation', () => {
    expect(panelMain).toContain('if (!await confirmLogoff()) return');
    expect(panel).toContain('id="account-confirm-dialog"');
    expect(panelMain).toContain("type: 'guard:secure-logoff'");
    expect(panelMain).toContain("type: 'activity:list'");
    expect(panelMain).toContain('safeActivityLocation(entry.origin, entry.pathname)');
    expect(panelMain).not.toContain('innerHTML');
  });

  it('keeps the non-sensitive update notice out of Chrome storage', () => {
    expect(panelMain).toContain("localStorage.getItem(MIGRATION_NOTICE_KEY)");
    expect(panelMain).toContain("localStorage.setItem(MIGRATION_NOTICE_KEY, 'true')");
    expect(panelMain).not.toContain('chrome.storage.local');
  });

  it('uses shared branding on every extension-owned surface', () => {
    expect(panelMain).toContain("from '@safetech/inheriti-elements-brand'");
    expect(blockedMain).toContain("from '@safetech/inheriti-elements-brand'");
    expect(blockedMain).toContain("blocked.origin}${blocked.pathname}");
    expect(panel).not.toContain('M14.2718');
    expect(panelMain).toContain("path.setAttribute('d', inheritiGuardShield.path)");
  });

  it('uses the shared app font for panel, controls, blocked page, and overlay', () => {
    const panelCss = readFileSync(new URL('../src/side-panel/styles.css', import.meta.url), 'utf8');
    const blockedCss = readFileSync(new URL('../src/blocked/styles.css', import.meta.url), 'utf8');
    const overlay = readFileSync(new URL('../src/content/overlay.ts', import.meta.url), 'utf8');
    expect(readFileSync(new URL('../src/side-panel/font-app.ttf', import.meta.url)))
      .toEqual(readFileSync(new URL('../../../packages/core/assets/font-app.ttf', import.meta.url)));
    expect(panelCss).toContain('button, input, select, textarea { font: inherit; }');
    expect(panelCss).toMatch(/body \{[^}]*font: inherit;/u);
    expect(blockedCss).toContain('font: inherit;');
    expect(overlay).toContain('font:14px/1.5 AppFont');
    expect(overlay).not.toContain('Lexend');
  });

  it('has no editable runtime or standalone configuration page', () => {
    expect(manifest).not.toHaveProperty('options_ui');
  });

  it('renders each successful Activity response once', () => {
    expect(panelMain.match(/renderActivity\(response\.activity\)/gu)).toHaveLength(1);
  });
});
