/** Presentation and input rules shared by the local plan creators. Asset types and icons come from the Core SDK catalog. */
export const localPlanAssetLimit = 16;
export const assetNames: Readonly<Record<string, string>> = {
  'PLAIN-TEXT': 'Plain text', 'USER-PSWD': 'Account and password', 'RECOVERY-CODE': 'Recovery code',
  'PIN-CODE': 'PIN code', 'API-KEY': 'API key', 'PRIVATE-KEY': 'Private key', 'SEED-PHRASE': 'Seed phrase',
  'PAYMENT-CREDIT-CARD': 'Credit card', 'PAYMENT-DEBIT-CARD': 'Debit card', DOCUMENT: 'Document',
  IMAGE: 'Image', VIDEO: 'Video',
};
export const fieldLabels: Readonly<Record<string, string>> = {
  appOrWebsite: 'App or website', email: 'Email address', apiKey: 'API key', deviceOrApp: 'Device or app',
  publicAddress: 'Public address', privateKey: 'Private key', accountNumber: 'Account number',
  cardHolderName: 'Cardholder name', clientId: 'Client ID', cardNumber: 'Card number', expiryDate: 'Expiry date',
  pinCode: 'PIN code', mimeType: 'File type',
};
export const fieldMaxLengths: Readonly<Record<string, number>> = {
  appOrWebsite: 100, email: 254, username: 64, deviceOrApp: 100,
  app: 100, apiKey: 500, publicAddress: 128, privateKey: 256,
  bank: 64, accountNumber: 40, cardHolderName: 60, clientId: 50, pinCode: 10,
};
export const assetName = (id: string) => assetNames[id] ?? id.toLowerCase().replace(/-/g, ' ');
export const fieldName = (name: string) => fieldLabels[name] ?? name.replace(/([a-z])([A-Z])/gu, '$1 $2').replace(/^./u, (value) => value.toUpperCase());
export function fieldMaxLength(field: string, assetType: string): number | undefined {
  if (field === 'code' && assetType === 'PIN-CODE') return 10;
  if (field === 'code' && assetType.startsWith('PAYMENT-')) return 4;
  return fieldMaxLengths[field];
}

// Use glyphs available in the bundled icon font for the Core SDK's asset icon names.
export const assetIconCodePoints: Readonly<Record<string, number>> = {
  text: 61788, 'id-card': 62146, 'trash-undo': 62186, 'lock-hashtag': 61475,
  'laptop-code': 62972, key: 61572, seedling: 62680, 'credit-card': 61597,
  file: 61787, image: 61502, video: 61501,
};
