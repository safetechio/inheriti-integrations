import { expect, it } from 'vitest';

it('places a pasted seed phrase into separate slots without truncation', async () => {
  const seedWordsPath = '../src/modules/_shared/ui/components/Form/seed-words.js';
  const { placePastedWords } = await import(seedWordsPath);
  expect(placePastedWords(['', '', ''], 0, 'alpha beta gamma')).toEqual(['alpha', 'beta', 'gamma']);
  expect(() => placePastedWords([''], 0, 'overlongword')).toThrow('invalid_seed_words');
});

it('preserves leading, trailing, and whitespace-only text secrets', async () => {
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { buildAsset } = await import(assetInputPath);
  const definition = { id: 'PLAIN-TEXT', category: 'GENERAL-DATA', fields: ['text'] };
  const input = { assetName: ' Note ', fields: { text: '  keep this text  ' } };
  await expect(buildAsset(input, definition)).resolves.toEqual({
    type: 'PLAIN-TEXT', meta: { name: 'Note' }, secret: { text: '  keep this text  ' },
  });
  input.fields.text = '   ';
  await expect(buildAsset(input, definition)).resolves.toMatchObject({ secret: { text: '   ' } });
});

it('rejects oversized media before reading it', async () => {
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { buildAsset } = await import(assetInputPath);
  const file = { size: 10 * 1024 * 1024 + 1, name: 'large.pdf', type: 'application/pdf' };
  await expect(buildAsset({ assetName: 'Document', file }, { id: 'DOCUMENT', category: 'MEDIA-FILES', fields: ['data'] }))
    .rejects.toThrow('file_too_large');
});

it('keeps existing media and metadata when only its name changes', async () => {
  const formPath = '../src/modules/quick-plan/ui/hooks/usePlanEditForm.js';
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { formFromAsset } = await import(formPath);
  const { buildAsset } = await import(assetInputPath);
  const data = new Blob(['existing bytes'], { type: 'application/pdf' });
  const original = { type: 'DOCUMENT', meta: { name: 'Original', notes: 'Keep', code: 'stable-code', matchOrigins: ['https://example.com'], isMedia: true, mimeType: 'application/pdf', fileName: 'paper.pdf' }, secret: { data, mimeType: 'application/pdf', fileName: 'paper.pdf' } };
  const form = formFromAsset(original);
  expect(form.file).toEqual({ name: 'paper.pdf', existing: true });
  form.assetName = 'Renamed';
  await expect(buildAsset(form, { id: 'DOCUMENT', category: 'MEDIA-FILES', fields: ['data'] })).resolves.toEqual({
    type: 'DOCUMENT',
    meta: { name: 'Renamed', notes: 'Keep', code: 'stable-code', matchOrigins: ['https://example.com'], isMedia: true, mimeType: 'application/pdf', fileName: 'paper.pdf' },
    secret: { data, mimeType: 'application/pdf', fileName: 'paper.pdf' },
  });
  form.file = null;
  await expect(buildAsset(form, { id: 'DOCUMENT', category: 'MEDIA-FILES', fields: ['data'] })).rejects.toThrow('file_required');
});

it('keeps notes in metadata and crypto choices in the secret', async () => {
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { buildAsset } = await import(assetInputPath);
  const definition = { id: 'PRIVATE-KEY', category: 'CRYPTO', fields: ['privateKey', 'blockchain', 'customBlockchain', 'wallet', 'customWallet'] };
  const input = { assetName: 'Key', fields: { privateKey: 'secret', blockchain: 'Other', customBlockchain: 'My chain', wallet: 'MetaMask', notes: 'Store offline' } };
  await expect(buildAsset(input, definition)).resolves.toEqual({
    type: 'PRIVATE-KEY', meta: { name: 'Key', notes: 'Store offline' },
    secret: { privateKey: 'secret', blockchain: 'Other', customBlockchain: 'My chain', wallet: 'MetaMask' },
  });
});

it('loads custom crypto choices as Other and saves them unchanged', async () => {
  const formPath = '../src/modules/quick-plan/ui/hooks/usePlanEditForm.js';
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { formFromAsset } = await import(formPath);
  const { buildAsset } = await import(assetInputPath);
  const definition = { id: 'PRIVATE-KEY', category: 'CRYPTO', fields: ['privateKey', 'blockchain', 'customBlockchain', 'wallet', 'customWallet'] };
  const original = { type: 'PRIVATE-KEY', meta: { name: 'Key' }, secret: { privateKey: 'secret', blockchain: 'Other', customBlockchain: 'My chain', wallet: 'Other', customWallet: 'My wallet' } };
  const form = formFromAsset(original);
  expect(form.fields).toMatchObject({ blockchain: 'Other', customBlockchain: 'My chain', wallet: 'Other', customWallet: 'My wallet' });
  await expect(buildAsset(form, definition)).resolves.toEqual(original);
});

it('preserves valid seed word slots and rejects empty ones', async () => {
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { buildAsset } = await import(assetInputPath);
  const definition = { id: 'SEED-PHRASE', category: 'CRYPTO', fields: ['words', 'blockchain', 'wallet'] };
  await expect(buildAsset({ assetName: 'Recovery', fields: { words: ['alpha', ' beta '], blockchain: 'Ethereum', wallet: 'MetaMask' } }, definition))
    .resolves.toMatchObject({ secret: { words: ['alpha', 'beta'], blockchain: 'Ethereum', wallet: 'MetaMask' } });
  await expect(buildAsset({ assetName: 'Recovery', fields: { words: ['alpha', ''], blockchain: 'Ethereum', wallet: 'MetaMask' } }, definition))
    .rejects.toThrow('invalid_seed_words');
});

it('enforces Business required fields and optional secret minimum at the save boundary', async () => {
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { buildAsset } = await import(assetInputPath);
  const account = { id: 'USER-PSWD', category: 'GENERAL-DATA', fields: ['appOrWebsite', 'email', 'username', 'password'] };
  await expect(buildAsset({ assetName: 'Account', fields: {} }, account)).rejects.toThrow('asset_secret_required');
  await expect(buildAsset({ assetName: ' ', fields: { username: 'user' } }, account)).rejects.toThrow('asset_name_required');
  await expect(buildAsset({ assetName: 'Account', fields: { email: 'bad@' } }, account)).rejects.toThrow('invalid_email');
  await expect(buildAsset({ assetName: 'Account', fields: { username: 'user' } }, account)).resolves.toMatchObject({ secret: { username: 'user' } });
  await expect(buildAsset({ assetName: 'Account', fields: { username: 'user', includeNotes: true, notes: ' ' } }, account)).rejects.toThrow('asset_notes_required');
});

it('requires crypto choices and custom Other values and validates optional card numbers', async () => {
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { buildAsset } = await import(assetInputPath);
  const key = { id: 'PRIVATE-KEY', category: 'CRYPTO', fields: ['privateKey', 'blockchain', 'customBlockchain', 'wallet', 'customWallet'] };
  await expect(buildAsset({ assetName: 'Key', fields: { privateKey: 'secret' } }, key)).rejects.toThrow('blockchain_required');
  await expect(buildAsset({ assetName: 'Key', fields: { privateKey: 'secret', blockchain: 'Other', customBlockchain: ' ', wallet: 'MetaMask' } }, key)).rejects.toThrow('custom_blockchain_required');
  await expect(buildAsset({ assetName: 'Key', fields: { privateKey: 'secret', blockchain: 'Other', customBlockchain: ' My chain ', wallet: 'MetaMask' } }, key)).resolves.toMatchObject({ secret: { blockchain: 'Other', customBlockchain: 'My chain' } });
  const card = { id: 'PAYMENT-DEBIT-CARD', category: 'PAYMENT', fields: ['cardNumber', 'bank'] };
  await expect(buildAsset({ assetName: 'Card', fields: { cardNumber: '4111 1111 1111 1112' } }, card)).rejects.toThrow('invalid_card');
  await expect(buildAsset({ assetName: 'Card', fields: { cardNumber: '4111 1111 1111 1111' } }, card)).resolves.toMatchObject({ secret: { cardNumber: '4111 1111 1111 1111' } });
});

it('round-trips all catalog asset shapes through the edit form', async () => {
  const formPath = '../src/modules/quick-plan/ui/hooks/usePlanEditForm.js';
  const assetInputPath = '../src/modules/quick-plan/ui/asset-input.js';
  const { formFromAsset } = await import(formPath);
  const { buildAsset } = await import(assetInputPath);
  const cases: Array<[string, string, Record<string, string | string[]>]> = [
    ['PLAIN-TEXT', 'GENERAL-DATA', { text: '  private text  ' }],
    ['USER-PSWD', 'ONLINE-ACCOUNT', { appOrWebsite: 'site', email: 'a@b.com', username: 'user', password: 'pass' }],
    ['RECOVERY-CODE', 'ONLINE-ACCOUNT', { appOrWebsite: 'site', code: 'abc' }],
    ['PIN-CODE', 'ONLINE-ACCOUNT', { deviceOrApp: 'phone', code: '1234' }],
    ['API-KEY', 'DEV-KEYS-SECRETS', { app: 'service', apiKey: 'key' }],
    ['PRIVATE-KEY', 'CRYPTO-WALLETS', { publicAddress: 'address', privateKey: 'key', blockchain: 'Other', customBlockchain: 'Custom chain', wallet: 'Other', customWallet: 'Custom wallet' }],
    ['SEED-PHRASE', 'CRYPTO-WALLETS', { words: ['alpha', 'beta'], blockchain: 'Ethereum', wallet: 'MetaMask' }],
    ['PAYMENT-CREDIT-CARD', 'PAYMENT-CARD', { bank: 'Bank', accountNumber: '123', cardHolderName: 'Name', clientId: 'id', cardNumber: '4111 1111 1111 1111', expiryDate: '2030-01-01', pinCode: '1234', code: '123' }],
    ['PAYMENT-DEBIT-CARD', 'PAYMENT-CARD', { bank: 'Bank', accountNumber: '123', cardHolderName: 'Name', clientId: 'id', cardNumber: '4111 1111 1111 1111', expiryDate: '2030-01-01', pinCode: '1234', code: '123' }],
  ];
  for (const [type, category, secret] of cases) {
    const original = { type, meta: { name: 'Original', notes: 'Notes', code: 'stable', matchOrigins: ['https://example.com'] }, secret };
    const form = formFromAsset(original);
    expect(form.fields).toMatchObject(secret);
    const definition = { id: type, category, fields: Object.keys(secret) };
    expect(await buildAsset(form, definition)).toEqual(original);
  }
  const data = new Blob(['file bytes'], { type: 'application/pdf' });
  for (const type of ['DOCUMENT', 'IMAGE', 'VIDEO', 'PDF']) {
    const original = { type, meta: { name: 'File', notes: 'Notes', isMedia: true, mimeType: 'application/pdf', fileName: 'file.pdf' }, secret: { data, mimeType: 'application/pdf', fileName: 'file.pdf', fileSize: data.size } };
    const form = formFromAsset(original);
    expect(form.assetType).toBe(type === 'PDF' ? 'DOCUMENT' : type);
    expect(await buildAsset(form, { id: form.assetType, category: 'MEDIA-FILES', fields: ['data', 'mimeType'] })).toEqual(original);
  }
});
