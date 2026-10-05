import { quickPlanAssetCatalog } from './quick-plan.js';
import { fieldMaxLength } from './asset-metadata.js';

export interface InboxTextAssetSuggestion {
  title: string;
  assetType: string;
  assetName: string;
  fields: Record<string, string>;
}

const fieldsByLabel: Readonly<Record<string, string>> = {
  password: 'password', passphrase: 'password', username: 'username', email: 'email',
  website: 'appOrWebsite', apporwebsite: 'appOrWebsite', service: 'appOrWebsite',
  app: 'app', apikey: 'apiKey', recoverycode: 'recoveryCode', pin: 'pinCode',
  device: 'deviceOrApp', deviceorapp: 'deviceOrApp',
};

const categories: readonly { type: string; required: string; field: string; name: string }[] = [
  { type: 'API-KEY', required: 'apiKey', field: 'apiKey', name: 'API key' },
  { type: 'USER-PSWD', required: 'password', field: 'password', name: 'Account credentials' },
  { type: 'RECOVERY-CODE', required: 'recoveryCode', field: 'code', name: 'Recovery code' },
  { type: 'PIN-CODE', required: 'pinCode', field: 'code', name: 'PIN code' },
];

/** Suggests editable plan fields from local revealed text without storing it. */
export function suggestInboxTextAsset(text: string): InboxTextAssetSuggestion {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Invalid Inbox text');
  const fallback = (): InboxTextAssetSuggestion => ({ title: 'Saved message', assetType: 'PLAIN-TEXT',
    assetName: 'Saved message', fields: { text } });
  const values = new Map<string, string>();
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const match = /^\s*([\p{L}][\p{L}\p{N} _-]{0,39})\s*[:=]\s*(.+?)\s*$/u.exec(line);
    if (!match) return fallback();
    const label = match[1]!.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/giu, '').toLowerCase();
    const field = fieldsByLabel[label];
    if (!field || values.has(field)) return fallback();
    values.set(field, match[2]!);
  }
  const matched = categories.filter(({ required }) => values.has(required));
  if (matched.length !== 1) return fallback();
  const selected = matched[0]!;
  const definition = quickPlanAssetCatalog.find(({ id }) => id === selected.type);
  if (!definition || !definition.fields.includes(selected.field)) return fallback();
  const fields: Record<string, string> = {};
  for (const [field, value] of values) {
    const target = field === selected.required ? selected.field : field;
    if (!definition.fields.includes(target) || target in fields ||
      (fieldMaxLength(target, definition.id) ?? Infinity) < value.length ||
      (target === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value))) return fallback();
    fields[target] = value;
  }
  return { title: selected.name, assetType: selected.type, assetName: selected.name, fields };
}
