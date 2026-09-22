import { describe, expect, it } from 'vitest';
import { clipboardDecision, isSensitiveClipboardActive, markSensitiveClipboard } from '../src/background/guard/clipboard-policy.js';
import { guardNavigationRule, guardRuleIds, guardRuleUpdate } from '../src/background/guard/dnr-policy.js';
import { shouldBlockDownload } from '../src/background/guard/download-policy.js';
import { idleDetectionSeconds, shouldTriggerIdleLock } from '../src/background/guard/idle-policy.js';

describe('Guard-owned DNR decisions', () => {
  it('selects only the reserved 20,000-20,099 range for removal', () => {
    expect(guardRuleIds([{ id: 1 }, { id: 2 }, { id: 9 }, { id: 20_000 }, { id: 20_099 }, { id: 20_100 }]))
      .toEqual([1, 2, 20_000, 20_099]);
    expect(guardRuleUpdate(false, [{ id: 1 }, { id: 9 }, { id: 20_000 }], 'chrome-extension://id/blocked.html', 'id'))
      .toEqual({ removeRuleIds: [1, 20_000], addRules: [] });
  });

  it('migrates the production 1.0.5 rule id while preserving unrelated dynamic rules', () => {
    const update = guardRuleUpdate(true, [{ id: 1 }, { id: 733 }, { id: 20_004 }],
      'chrome-extension://id/blocked/index.html', 'id');
    expect(update.removeRuleIds).toEqual([1, 20_004]);
    expect(update.addRules).toEqual([expect.objectContaining({ id: 20_000 })]);
  });

  it('builds the navigation rule in the owned range with trusted exclusions', () => {
    const rule = guardNavigationRule('chrome-extension://id/blocked.html', 'id');
    expect(rule.id).toBe(20_000);
    expect(rule.condition.excludedRequestDomains).toContain('inheriti.com');
  });
});

describe('Guard download decisions', () => {
  it('blocks risky ecosystem downloads and allows normal PDFs', () => {
    expect(shouldBlockDownload({ url: 'https://app.inheriti.com/export.js' })).toBe(true);
    expect(shouldBlockDownload({ url: 'https://app.inheriti.com/plan.pdf' })).toBe(false);
    expect(shouldBlockDownload({ url: 'https://evil.example/file.exe' })).toBe(false);
    expect(shouldBlockDownload({ url: 'blob:https://app.inheriti.com/id' })).toBe(true);
    expect(shouldBlockDownload({ url: 'data:text/html,<secret>', referrer: 'https://app.inheriti.com' })).toBe(true);
    expect(shouldBlockDownload({ url: 'https://app.inheriti.com/file.exe' }, false)).toBe(false);
  });
});

describe('Guard clipboard and idle decisions', () => {
  it('expires persisted clipboard sensitivity exactly at its deadline', () => {
    const state = markSensitiveClipboard(1_000);
    expect(isSensitiveClipboardActive(state, state.expiresAt - 1)).toBe(true);
    expect(isSensitiveClipboardActive(state, state.expiresAt)).toBe(false);
    expect(clipboardDecision({ senderUrl: 'https://evil.example', guardEnabled: true, ecosystemSessionOpen: false, state, now: 2_000 }))
      .toEqual({ allowPaste: false, allowRead: false });
    expect(clipboardDecision({ senderUrl: 'https://app.inheriti.com', guardEnabled: true, ecosystemSessionOpen: true, state, now: 2_000 }))
      .toEqual({ allowPaste: true, allowRead: true });
  });

  it('clamps idle detection and triggers only for an open ecosystem session', () => {
    expect(idleDetectionSeconds(-1)).toBe(7_200);
    expect(idleDetectionSeconds(0.5)).toBe(60);
    expect(shouldTriggerIdleLock({ enabled: true, browserState: 'locked', ecosystemSessionOpen: true })).toBe(true);
    expect(shouldTriggerIdleLock({ enabled: true, browserState: 'idle', ecosystemSessionOpen: false })).toBe(false);
    expect(shouldTriggerIdleLock({ enabled: false, browserState: 'locked', ecosystemSessionOpen: true })).toBe(false);
  });
});
