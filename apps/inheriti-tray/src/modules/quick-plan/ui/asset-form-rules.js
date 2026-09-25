import cardValidator from 'card-validator';

export const blockchains = ['Bitcoin', 'Vechain', 'Ethereum', 'Optimism', 'BNB Chain', 'Polygon', 'Base', 'Solana', 'Tron', 'SUI', 'Arbitrum', 'Cardano', 'Injective', 'Avalanche', 'Axelar', 'Other'];
export const wallets = ['Comet Wallet', 'Venly', 'MetaMask', 'Keplr', 'Phantom Wallet', 'Coinbase Wallet', 'Binance Wallet', 'Trust Wallet', 'Atomic Wallet', 'Ledger', 'Trezor', 'Exodus', 'Enjin Wallet', 'BlockFi Wallet', 'VeWorld Wallet', 'BitPay Wallet', 'Solflare Wallet', 'Other'];

const emailPattern = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;

export const maxLengths = {
  appOrWebsite: 100, email: 254, username: 64, deviceOrApp: 100,
  app: 100, apiKey: 500, publicAddress: 128, privateKey: 256,
  bank: 64, accountNumber: 40, cardHolderName: 60, clientId: 50, pinCode: 10,
};

export function fieldMaxLength(field, assetType) {
  if (field === 'code' && assetType === 'RECOVERY-CODE') return undefined;
  if (field === 'code' && assetType === 'PIN-CODE') return 10;
  if (field === 'code' && assetType.startsWith('PAYMENT-')) return 4;
  return maxLengths[field];
}

export function fieldRequired(field) {
  return field === 'text' || field === 'words' || field === 'blockchain' || field === 'wallet';
}

export function validCard(value) {
  return cardValidator.number(value, { maxLength: 34 }).isValid;
}

export function validateAssetForm(input, definition) {
  if (!definition) throw new Error('asset_type_required');
  if (!input.assetName?.trim()) throw new Error('asset_name_required');
  if (input.fields?.includeNotes && !input.fields.notes?.trim()) throw new Error('asset_notes_required');
  if (definition.category === 'MEDIA-FILES') return;
  const fields = input.fields || {};
  for (const field of definition.fields) {
    const value = fields[field];
    if (fieldRequired(field) && (!value || Array.isArray(value) && value.length === 0)) throw new Error(`${field}_required`);
    const maxLength = fieldMaxLength(field, definition.id);
    if (maxLength && typeof value === 'string' && value.length > maxLength) throw new Error(`${field}_too_long`);
    if (field === 'email' && value && !emailPattern.test(value)) throw new Error('invalid_email');
    if (field === 'cardNumber' && value && !validCard(value)) throw new Error('invalid_card');
  }
  if (definition.id === 'SEED-PHRASE' && (!Array.isArray(fields.words) || fields.words.length > 24 || fields.words.some((word) => typeof word !== 'string' || !word.trim() || word.trim().length > 8))) throw new Error('invalid_seed_words');
  for (const field of ['blockchain', 'wallet']) {
    if (fields[field] === 'Other' && !fields[`custom${field[0].toUpperCase()}${field.slice(1)}`]?.trim()) throw new Error(`custom_${field}_required`);
  }
  const secretFields = definition.fields.filter((field) => field !== 'customBlockchain' && field !== 'customWallet');
  if (!secretFields.some((field) => {
    const value = fields[field];
    return Array.isArray(value) ? value.some((item) => item?.trim()) : typeof value === 'string' && value.length > 0;
  })) throw new Error('asset_secret_required');
}

export function assetFormError(error, messages) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'file_too_large') return messages.fileLimit;
  if (code === 'file_required') return 'Choose a file.';
  if (code === 'invalid_seed_words' || code === 'words_required') return messages.invalidAsset;
  if (code === 'invalid_email') return 'Enter a valid email address.';
  if (code === 'invalid_card') return 'Enter a valid card number.';
  if (code === 'asset_type_required') return 'Choose an asset type.';
  if (code === 'asset_name_required') return 'Enter an asset name.';
  if (code === 'asset_notes_required') return 'Enter notes or turn off Add notes.';
  if (code === 'asset_secret_required') return 'Fill in at least one asset field.';
  if (code.endsWith('_too_long')) return `This field is too long: ${messages.assetFields[code.slice(0, -9)] || code.slice(0, -9)}.`;
  if (code.endsWith('_required')) return `Fill in ${messages.assetFields[code.slice(0, -9)] || code.slice(0, -9)}.`;
  return null;
}
