const ASSET_FIELD_LABELS: Record<string, string> = {
  'meta.notes': 'Notes or guidelines',
  'secret.appOrWebsite': 'App or website',
  'secret.email': 'Email',
  'secret.username': 'Username',
  'secret.password': 'Password',
  'secret.apiKey': 'API key',
  'secret.publicAddress': 'Public address',
  'secret.privateKey': 'Private key',
  'secret.code': 'Code',
  'secret.deviceOrApp': 'Device or app',
  'secret.text': 'Text',
  'secret.blockchain': 'Blockchain',
  'secret.customBlockchain': 'Custom blockchain',
  'secret.wallet': 'Wallet',
  'secret.customWallet': 'Custom wallet',
  'secret.words': 'Seed phrase',
  'secret.bank': 'Bank',
  'secret.accountNumber': 'Account number',
  'secret.cardHolderName': 'Cardholder name',
  'secret.clientId': 'Client ID',
  'secret.cardNumber': 'Card number',
  'secret.expiryDate': 'Expiry date',
  'secret.pinCode': 'PIN code',
  'secret.data': 'File',
  'secret.mimeType': 'File type',
};

export function getAssetFieldDisplayName(source: string): string {
  const known = ASSET_FIELD_LABELS[source];
  if (known) return known;
  const name = source.split('.').pop() ?? source;
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (value) => value.toUpperCase());
}
