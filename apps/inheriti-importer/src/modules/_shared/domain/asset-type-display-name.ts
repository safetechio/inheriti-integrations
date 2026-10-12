const ASSET_TYPE_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'PLAIN-TEXT': 'Plain Text',
  'USER-PSWD': 'Username and Password',
  'RECOVERY-CODE': 'Recovery Code',
  'PIN-CODE': 'PIN Code',
  'API-KEY': 'API Key',
  'PRIVATE-KEY': 'Private Key',
  'SEED-PHRASE': 'Seed Phrase',
  'PAYMENT-CREDIT-CARD': 'Credit Card',
  'PAYMENT-DEBIT-CARD': 'Debit Card',
  DOCUMENT: 'Document',
  IMAGE: 'Image',
  VIDEO: 'Video',
  PDF: 'Document',
};

const DISPLAY_ACRONYMS = new Set(['api', 'id', 'pin', 'ssh', 'url']);

export function getAssetTypeDisplayName(type: string): string {
  const knownName = ASSET_TYPE_DISPLAY_NAMES[type];
  if (knownName) return knownName;

  return type
    .trim()
    .toLowerCase()
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) =>
      DISPLAY_ACRONYMS.has(word)
        ? word.toUpperCase()
        : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(' ');
}
