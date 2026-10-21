import { DataAssetDefinitionService } from '@safetech/inheriti-core-sdk/core';

export type PlanAssetFieldInputKind =
  'text' | 'textarea' | 'email' | 'switch' | 'select' | 'date' | 'card-number' | 'word-list';

export interface PlanAssetFieldDefinition {
  id: string;
  source: string;
  inputKind: PlanAssetFieldInputKind;
  customValueSource?: string;
  optionSource?: 'blockchain' | 'wallet';
}

const definitionService = new DataAssetDefinitionService();
export type PlanAssetType = ReturnType<
  DataAssetDefinitionService['getCoreDefinitions']
>[number]['id'];

const aliases: Partial<Record<string, PlanAssetType>> = { PDF: 'DOCUMENT' as PlanAssetType };
const mediaTypes = new Set(['DOCUMENT', 'IMAGE', 'VIDEO']);
const fieldKinds: Partial<Record<string, PlanAssetFieldInputKind>> = {
  text: 'textarea',
  email: 'email',
  words: 'word-list',
  blockchain: 'select',
  wallet: 'select',
  cardNumber: 'card-number',
  expiryDate: 'date',
  additionalNotesCheck: 'switch',
  notes: 'textarea',
};
const fieldIds: Partial<Record<string, string>> = {
  appOrWebsite: 'app-or-website',
  deviceOrApp: 'device-or-app',
  apiKey: 'api-key',
  publicAddress: 'public-address',
  privateKey: 'private-key',
  cardHolderName: 'card-holder-name',
  clientId: 'client-id',
  cardNumber: 'card-number',
  expiryDate: 'expiry-date',
  pinCode: 'pin-code',
  customBlockchain: 'blockchain-custom',
  customWallet: 'wallet-custom',
  additionalNotesCheck: 'additional-notes-check',
};

export function resolvePlanAssetUiType(type?: string): PlanAssetType | undefined {
  if (!type) return undefined;
  return (aliases[type] ?? type) as PlanAssetType;
}

export function getCorePlanAssetTypes(): PlanAssetType[] {
  return definitionService
    .getCoreDefinitions()
    .map((definition) => definition.id) as PlanAssetType[];
}

export function getPlanAssetIconName(type?: string): string | undefined {
  const resolved = resolvePlanAssetUiType(type);
  return definitionService.getCoreDefinitions().find((definition) => definition.id === resolved)
    ?.iconName;
}

function field(source: string): PlanAssetFieldDefinition {
  const name = source.split('.').at(-1) ?? source;
  return {
    id:
      fieldIds[name] ??
      name
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replaceAll('.', '-')
        .toLowerCase(),
    source,
    inputKind: fieldKinds[name] ?? 'text',
    optionSource: name === 'blockchain' || name === 'wallet' ? name : undefined,
    customValueSource:
      name === 'blockchain'
        ? 'secret.customBlockchain'
        : name === 'wallet'
          ? 'secret.customWallet'
          : undefined,
  };
}

export function getPlanAssetFormFields(type?: string): PlanAssetFieldDefinition[] {
  const resolved = resolvePlanAssetUiType(type);
  const definition = definitionService.getCoreDefinitions().find((item) => item.id === resolved);
  if (!type || !definition) return [];
  const sources = [
    'meta.name',
    ...definition.fields.map((name) => `secret.${name}`),
    'meta.additionalNotesCheck',
    'meta.notes',
  ];
  return sources.map(field);
}

export function getPlanAssetFieldTestIds(type: string, fieldId: string) {
  return { testID: `plan-asset-form.${type}.${fieldId}` };
}

export function getAssetUiExtension(type?: string) {
  const resolved = resolvePlanAssetUiType(type);
  if (!resolved) return undefined;
  return {
    type: resolved,
    formFields: getPlanAssetFormFields(resolved),
    isMedia: mediaTypes.has(resolved),
  };
}

export interface AssetValidationValues {
  meta: Record<string, unknown>;
  secret: Record<string, unknown>;
}

const maxLengths: Record<string, number> = {
  'API-KEY.secret.app': 100,
  'API-KEY.secret.apiKey': 500,
  'USER-PSWD.secret.appOrWebsite': 100,
  'USER-PSWD.secret.email': 254,
  'USER-PSWD.secret.username': 64,
  'RECOVERY-CODE.secret.appOrWebsite': 100,
  'PIN-CODE.secret.deviceOrApp': 100,
  'PIN-CODE.secret.code': 10,
  'PRIVATE-KEY.secret.publicAddress': 128,
  'PRIVATE-KEY.secret.privateKey': 256,
  'PAYMENT-CREDIT-CARD.secret.bank': 64,
  'PAYMENT-CREDIT-CARD.secret.accountNumber': 40,
  'PAYMENT-CREDIT-CARD.secret.cardHolderName': 60,
  'PAYMENT-CREDIT-CARD.secret.clientId': 50,
  'PAYMENT-CREDIT-CARD.secret.pinCode': 10,
  'PAYMENT-CREDIT-CARD.secret.code': 4,
  'PAYMENT-DEBIT-CARD.secret.bank': 64,
  'PAYMENT-DEBIT-CARD.secret.accountNumber': 40,
  'PAYMENT-DEBIT-CARD.secret.cardHolderName': 60,
  'PAYMENT-DEBIT-CARD.secret.clientId': 50,
  'PAYMENT-DEBIT-CARD.secret.pinCode': 10,
  'PAYMENT-DEBIT-CARD.secret.code': 4,
};

export function isValidUserPasswordEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function valueAt(values: AssetValidationValues, source: string): unknown {
  const [scope, ...parts] = source.split('.');
  if (scope !== 'meta' && scope !== 'secret') return undefined;
  return parts.reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[part];
  }, values[scope]);
}

function present(value: unknown): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : value != null;
}

function validCard(value: string): boolean {
  const digits = value.replace(/[ -]/g, '');
  if (!/^\d{12,34}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function validateAssetEditorValues(
  type: string,
  values: AssetValidationValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, max] of Object.entries(maxLengths)) {
    if (!key.startsWith(`${type}.`)) continue;
    const source = key.slice(type.length + 1);
    const value = valueAt(values, source);
    if (typeof value === 'string' && value.length > max)
      errors[source] = `Please enter a value of max ${max} chars`;
  }
  const email = valueAt(values, 'secret.email');
  if (
    type === 'USER-PSWD' &&
    present(email) &&
    !errors['secret.email'] &&
    (typeof email !== 'string' || !isValidUserPasswordEmail(email))
  )
    errors['secret.email'] = 'Invalid email';
  const card = valueAt(values, 'secret.cardNumber');
  if (
    (type === 'PAYMENT-CREDIT-CARD' || type === 'PAYMENT-DEBIT-CARD') &&
    present(card) &&
    (typeof card !== 'string' || !validCard(card))
  )
    errors['secret.cardNumber'] = 'Invalid card';
  if (type === 'PLAIN-TEXT' && !present(valueAt(values, 'secret.text')))
    errors['secret.text'] = 'Please fill in this field';
  if (type === 'SEED-PHRASE') {
    const words = valueAt(values, 'secret.words');
    if (
      !Array.isArray(words) ||
      words.length === 0 ||
      words.some((word) => typeof word !== 'string' || word.trim() === '')
    )
      errors['secret.words'] = 'Please fill in all the words';
    else if (words.some((word) => word.length > 32))
      errors['secret.words'] = 'Please check all the words are valid';
  }
  if (mediaTypes.has(type) && !present(valueAt(values, 'secret.data')))
    errors['secret.data'] = 'Please select a file';
  return errors;
}
