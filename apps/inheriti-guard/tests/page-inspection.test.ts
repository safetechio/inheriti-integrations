import { afterEach, describe, expect, it } from 'vitest';
import { discoverPageFields, scopePageFields } from '../src/background/page-inspection.js';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

function input(overrides: Record<string, unknown> = {}) {
  return {
    autocomplete: '', type: 'text', name: '', id: '', placeholder: '', disabled: false, readOnly: false, hidden: false,
    labels: [], getAttribute: () => null, getBoundingClientRect: () => ({ width: 100, height: 20 }), ...overrides,
  } as unknown as HTMLInputElement;
}

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  delete (globalThis as Record<string, unknown>).__inheritiPageTargetsV1__;
});

describe('page field discovery', () => {
  it('returns metadata-only visible editable candidates with stable opaque handles', () => {
    const username = input({ autocomplete: 'username', name: 'login' });
    const password = input({ type: 'password', placeholder: 'Password' });
    const hidden = input({ type: 'email', hidden: true });
    globalThis.window = {
      location: { origin: 'https://login.example.test', href: 'https://login.example.test/form' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    globalThis.document = {
      querySelectorAll: () => [username, password, hidden], getElementById: () => null,
    } as unknown as Document;

    const first = discoverPageFields();
    const second = discoverPageFields();
    expect(first.fields.map((field) => field.semantic)).toEqual(['username', 'password']);
    expect(first.fields.map((field) => field.targetId)).toEqual(second.fields.map((field) => field.targetId));
    expect(first.fields.every((field) => field.origin === 'https://login.example.test')).toBe(true);
    expect(first.navigationId).toBe(second.navigationId);
    expect(JSON.stringify(first)).not.toContain('value');
    expect(scopePageFields(first.fields, 7, 2)[0]).toMatchObject({
      tabId: 7, frameId: 2, origin: 'https://login.example.test', navigationId: first.navigationId,
    });
  });

  it('keeps page identity when no compatible fields are present', () => {
    globalThis.window = {
      location: { origin: 'https://example.test', href: 'https://example.test/business' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    globalThis.document = { querySelectorAll: () => [], getElementById: () => null } as unknown as Document;

    const snapshot = discoverPageFields();
    expect(snapshot.fields).toEqual([]);
    expect(snapshot.origin).toBe('https://example.test');
    expect(snapshot.navigationId).toBeTruthy();
  });

  it('classifies an email input as email despite username autocomplete', () => {
    const email = input({ type: 'email', autocomplete: 'username', name: 'login' });
    globalThis.window = {
      location: { origin: 'https://app.metricool.com', href: 'https://app.metricool.com/login' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    globalThis.document = { querySelectorAll: () => [email], getElementById: () => null } as unknown as Document;
    expect(discoverPageFields().fields.map((field) => field.semantic)).toEqual(['email']);
  });

  it('uses an explicit email hint ahead of generic username autocomplete', () => {
    const email = input({ autocomplete: 'username', placeholder: 'Introduce tu correo electrónico' });
    globalThis.window = {
      location: { origin: 'https://app.metricool.com', href: 'https://app.metricool.com/login' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    globalThis.document = { querySelectorAll: () => [email], getElementById: () => null } as unknown as Document;
    expect(discoverPageFields().fields.map((field) => field.semantic)).toEqual(['email']);
  });

  it('keeps autocomplete semantics on telephone and search login inputs', () => {
    const telephone = input({ type: 'tel', autocomplete: 'username' });
    const search = input({ type: 'search', autocomplete: 'email' });
    globalThis.window = {
      location: { origin: 'https://login.example.test', href: 'https://login.example.test/form' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    globalThis.document = { querySelectorAll: () => [telephone, search], getElementById: () => null } as unknown as Document;
    expect(discoverPageFields().fields.map((field) => field.semantic)).toEqual(['username', 'email']);
  });

  it('does not treat non-login controls named email as login fields', () => {
    const controls = ['checkbox', 'radio', 'submit'].map((type) => input({ type, name: 'email', placeholder: 'Email' }));
    globalThis.window = {
      location: { origin: 'https://login.example.test', href: 'https://login.example.test/form' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    globalThis.document = { querySelectorAll: () => controls, getElementById: () => null } as unknown as Document;
    expect(discoverPageFields().fields).toEqual([]);
  });
});
