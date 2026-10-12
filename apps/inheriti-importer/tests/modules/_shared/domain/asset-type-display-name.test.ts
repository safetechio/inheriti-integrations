import { describe, expect, it } from 'vitest';
import { getAssetTypeDisplayName } from '@modules/_shared/domain/asset-type-display-name';

describe('getAssetTypeDisplayName', () => {
  it.each([
    ['PLAIN-TEXT', 'Plain Text'],
    ['USER-PSWD', 'Username and Password'],
    ['RECOVERY-CODE', 'Recovery Code'],
    ['PIN-CODE', 'PIN Code'],
    ['API-KEY', 'API Key'],
    ['PRIVATE-KEY', 'Private Key'],
    ['SEED-PHRASE', 'Seed Phrase'],
    ['PAYMENT-CREDIT-CARD', 'Credit Card'],
    ['PAYMENT-DEBIT-CARD', 'Debit Card'],
    ['DOCUMENT', 'Document'],
    ['IMAGE', 'Image'],
    ['VIDEO', 'Video'],
    ['PDF', 'Document'],
  ])('formats %s as %s', (type, expected) => {
    expect(getAssetTypeDisplayName(type)).toBe(expected);
  });

  it('humanizes an unknown canonical type without leaking its code formatting', () => {
    expect(getAssetTypeDisplayName('SSH-CREDENTIAL')).toBe('SSH Credential');
  });
});
