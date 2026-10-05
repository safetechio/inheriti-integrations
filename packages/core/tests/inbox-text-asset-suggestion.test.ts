import { describe, expect, it } from 'vitest';
import { quickPlanAssetCatalog } from '../src/quick-plan.js';
import { suggestInboxTextAsset } from '../src/inbox-text-asset-suggestion.js';

describe('Inbox text asset suggestion', () => {
  it('uses catalog asset types and exact field IDs for clear labels', () => {
    for (const [text, type, fields] of [
      ['Website: example.com\nUsername: alice\nPassword: correct horse', 'USER-PSWD',
        { appOrWebsite: 'example.com', username: 'alice', password: 'correct horse' }],
      ['App: Payments\nAPI key: sk-test-123', 'API-KEY', { app: 'Payments', apiKey: 'sk-test-123' }],
      ['Recovery code: 1234-5678', 'RECOVERY-CODE', { code: '1234-5678' }],
      ['Device: Tablet\nPIN: 1234', 'PIN-CODE', { deviceOrApp: 'Tablet', code: '1234' }],
    ] as const) {
      const suggestion = suggestInboxTextAsset(text);
      expect(suggestion.assetType).toBe(type);
      expect(suggestion.fields).toEqual(fields);
      expect(quickPlanAssetCatalog.find(({ id }) => id === type)?.fields)
        .toEqual(expect.arrayContaining(Object.keys(fields)));
      expect(suggestion.title).not.toContain(Object.values(fields).at(-1));
    }
  });

  it('keeps ambiguous or unrepresented text intact as editable plain text', () => {
    for (const text of ['an unlabeled secret', 'Password: one\nAPI key: two',
      'Seed phrase: alpha beta gamma', 'Password: one\nUnknown: two', 'PIN: 12345678901']) {
      expect(suggestInboxTextAsset(text)).toEqual({ title: 'Saved message', assetType: 'PLAIN-TEXT',
        assetName: 'Saved message', fields: { text } });
    }
    expect(() => suggestInboxTextAsset('  ')).toThrow('Invalid Inbox text');
  });
});
