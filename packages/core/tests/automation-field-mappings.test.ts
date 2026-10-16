import { describe, expect, it } from 'vitest';
import { resolveAutomationFieldMappings } from '../src/automation-field-mappings.js';

const assets = [
  { id: 'one', code: 'database', fieldNames: ['username', 'password', 'APIKey'] },
  { id: 'two', code: 'billingApp', fieldNames: ['clientSecret'] },
  { id: 'three', code: 'certificate', isBinary: true, fieldNames: ['data'] },
];

describe('automation field mapping selection', () => {
  it('maps all nonbinary plan fields in plan order with stable environment names', () => {
    expect(resolveAutomationFieldMappings(assets, { mapAll: true })).toEqual([
      { selector: 'database.username', envName: 'DATABASE_USERNAME' },
      { selector: 'database.password', envName: 'DATABASE_PASSWORD' },
      { selector: 'database.APIKey', envName: 'DATABASE_API_KEY' },
      { selector: 'billingApp.clientSecret', envName: 'BILLING_APP_CLIENT_SECRET' },
    ]);
  });

  it('excludes selected fields and applies explicit environment name overrides', () => {
    expect(resolveAutomationFieldMappings(assets, {
      mapAll: true,
      exceptFields: ['database.password'],
      mappings: [{ selector: 'billingApp.clientSecret', envName: 'APP_TOKEN' }],
    })).toEqual([
      { selector: 'database.username', envName: 'DATABASE_USERNAME' },
      { selector: 'database.APIKey', envName: 'DATABASE_API_KEY' },
      { selector: 'billingApp.clientSecret', envName: 'APP_TOKEN' },
    ]);
  });

  it('selects only requested fields in plan order, including manual-only mappings', () => {
    expect(resolveAutomationFieldMappings(assets, {
      onlyFields: ['billingApp.clientSecret', 'database.password'],
    })).toEqual([
      { selector: 'database.password', envName: 'DATABASE_PASSWORD' },
      { selector: 'billingApp.clientSecret', envName: 'BILLING_APP_CLIENT_SECRET' },
    ]);
    expect(resolveAutomationFieldMappings(assets, {
      mappings: [{ selector: 'database.password', envName: 'DB_PASSWORD' }],
    })).toEqual([{ selector: 'database.password', envName: 'DB_PASSWORD' }]);
    expect(resolveAutomationFieldMappings([
      ...assets,
      { id: 'broken', code: 'bad.code', fieldNames: ['value'] },
    ], { onlyFields: ['database.password'] })).toEqual([
      { selector: 'database.password', envName: 'DATABASE_PASSWORD' },
    ]);
  });

  it('prefixes generated names when an asset identifier begins with a digit', () => {
    expect(resolveAutomationFieldMappings([{
      id: '123e4567-e89b-12d3-a456-426614174000', fieldNames: ['apiKey'],
    }], { mapAll: true })).toEqual([{
      selector: '123e4567-e89b-12d3-a456-426614174000.apiKey',
      envName: '_123E4567_E89B_12D3_A456_426614174000_API_KEY',
    }]);
  });

  it('rejects ambiguous modes, unknown or duplicate selectors, and empty output', () => {
    for (const selection of [
      {}, { mapAll: true, onlyFields: ['database.password'] },
      { exceptFields: ['database.password'] },
      { mapAll: true, exceptFields: ['missing.field'] },
      { mapAll: true, exceptFields: ['database.password', 'database.password'] },
      { onlyFields: ['missing.field'] },
      { onlyFields: ['database.password', 'database.password'] },
      { onlyFields: [] },
      { mappings: [{ selector: 'missing.field', envName: 'MISSING' }] },
      { onlyFields: ['database.password'], mappings: [{ selector: 'database.username', envName: 'USER' }] },
      { mapAll: true, mappings: [{ selector: 'database.password', envName: 'PASS' }, { selector: 'database.password', envName: 'PASS2' }] },
    ]) expect(() => resolveAutomationFieldMappings(assets, selection)).toThrow('automation_mapping_selection_invalid');
    expect(() => resolveAutomationFieldMappings([{ id: 'one', code: 'database', fieldNames: ['password', 'password'] }], { mapAll: true })).toThrow();
    expect(() => resolveAutomationFieldMappings([...assets, { id: 'broken', code: 'bad.code', fieldNames: ['value'] }], { mapAll: true })).toThrow();
    expect(() => resolveAutomationFieldMappings(assets, { mapAll: true, exceptFields: ['database.username', 'database.password', 'database.APIKey', 'billingApp.clientSecret'] })).toThrow();
  });

  it('rejects generated collisions, reserved names, binary fields, and malformed names', () => {
    expect(() => resolveAutomationFieldMappings([
      { id: 'one', code: 'appId', fieldNames: ['token'] },
      { id: 'two', code: 'appID', fieldNames: ['token'] },
    ], { mapAll: true })).toThrow();
    expect(() => resolveAutomationFieldMappings([{ id: 'one', code: 'inheritiAutomation', fieldNames: ['provider'] }], { mapAll: true })).toThrow();
    expect(() => resolveAutomationFieldMappings(assets, { onlyFields: ['certificate.data'] })).toThrow();
    expect(() => resolveAutomationFieldMappings(assets, { mappings: [{ selector: 'database.password', envName: 'INHERITI_AUTOMATION_PROVIDER' }] })).toThrow();
    expect(() => resolveAutomationFieldMappings(assets, { mappings: [{ selector: 'database.password', envName: 'BAD-NAME' }] })).toThrow();
    expect(() => resolveAutomationFieldMappings(assets, { mapAll: true, mappings: [{ selector: 'database.password', envName: 'DATABASE_USERNAME' }] })).toThrow();
  });
});
