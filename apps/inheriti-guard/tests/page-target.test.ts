import { afterEach, describe, expect, it, vi } from 'vitest';
import { revalidatePageTarget, writePageTarget } from '../src/background/page-target.js';

const originalWindow = globalThis.window;
const originalInput = globalThis.HTMLInputElement;
const originalEvent = globalThis.Event;

class FakeInput {
  static lastSet: string | undefined;
  isConnected = true;
  disabled = false;
  readOnly = false;
  hidden = false;
  dispatchEvent = vi.fn();
  getBoundingClientRect() { return { width: 120, height: 24 }; }
  set value(next: string) { FakeInput.lastSet = next; }
}

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.HTMLInputElement = originalInput;
  globalThis.Event = originalEvent;
  delete (globalThis as Record<string, unknown>).__inheritiPageTargetsV1__;
  FakeInput.lastSet = undefined;
});

describe('opaque page targets', () => {
  it('revalidates page identity and writes without returning page content', () => {
    const input = new FakeInput();
    globalThis.HTMLInputElement = FakeInput as unknown as typeof HTMLInputElement;
    globalThis.Event = class { constructor(public type: string, public init?: unknown) {} } as unknown as typeof Event;
    globalThis.window = {
      location: { origin: 'https://login.example.test', href: 'https://login.example.test/form' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    Object.assign(globalThis, {
      __inheritiPageTargetsV1__: { navigationId: 'nav-1', href: 'https://login.example.test/form', targets: new Map([['opaque-1', input]]) },
    });

    expect(revalidatePageTarget('opaque-1', 'https://login.example.test', 'nav-1')).toBe('ready');
    expect(writePageTarget('opaque-1', 'https://login.example.test', 'nav-1', 'test-payload')).toBe('filled');
    expect(FakeInput.lastSet).toBe('test-payload');
    expect(input.dispatchEvent).toHaveBeenCalledTimes(2);
  });

  it('rejects navigation drift before resolving or writing the target', () => {
    const input = new FakeInput();
    globalThis.window = {
      location: { origin: 'https://login.example.test', href: 'https://login.example.test/form' },
      getComputedStyle: vi.fn(),
    } as unknown as Window & typeof globalThis;
    Object.assign(globalThis, {
      __inheritiPageTargetsV1__: { navigationId: 'nav-new', href: 'https://login.example.test/form', targets: new Map([['opaque-1', input]]) },
    });
    expect(revalidatePageTarget('opaque-1', 'https://login.example.test', 'nav-old')).toBe('form-changed');
    expect(writePageTarget('opaque-1', 'https://login.example.test', 'nav-old', 'never-written')).toBe('form-changed');
    expect(FakeInput.lastSet).toBeUndefined();
  });

  it('distinguishes an address change from a replaced input without exposing either value', () => {
    const input = new FakeInput();
    globalThis.window = {
      location: { origin: 'https://login.example.test', href: 'https://login.example.test/new' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    Object.assign(globalThis, {
      __inheritiPageTargetsV1__: { navigationId: 'nav-1', href: 'https://login.example.test/form', targets: new Map([['opaque-1', input]]) },
    });
    expect(revalidatePageTarget('opaque-1', 'https://login.example.test', 'nav-1')).toBe('page-address-changed');
    expect(writePageTarget('opaque-1', 'https://login.example.test', 'nav-1', 'never-written')).toBe('page-address-changed');
    expect(FakeInput.lastSet).toBeUndefined();
  });
});
