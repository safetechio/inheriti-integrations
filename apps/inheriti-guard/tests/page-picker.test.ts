import { afterEach, describe, expect, it } from 'vitest';
import { cancelPageFieldPicker, pickPageField } from '../src/background/page-picker.js';

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalInput = globalThis.HTMLInputElement;

class FakeInput {
  autocomplete = 'username';
  type = 'text';
  name = 'login';
  id = '';
  placeholder = '';
  disabled = false;
  readOnly = false;
  hidden = false;
  labels: HTMLLabelElement[] = [];
  style = { outline: 'initial' };
  getAttribute() { return null; }
  getBoundingClientRect() { return { width: 100, height: 20 }; }
}

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.document = originalDocument;
  globalThis.HTMLInputElement = originalInput;
  delete (globalThis as Record<string, unknown>).__inheritiPagePickerV1__;
  delete (globalThis as Record<string, unknown>).__inheritiPageTargetsV1__;
});

describe('page picker cancellation', () => {
  it('delegates cancellation to the document-scoped picker and clears through its cleanup', () => {
    let canceled = false;
    Object.assign(globalThis, { __inheritiPagePickerV1__: { cancel: () => { canceled = true; } } });
    expect(cancelPageFieldPicker()).toBe(true);
    expect(canceled).toBe(true);
    delete (globalThis as Record<string, unknown>).__inheritiPagePickerV1__;
    expect(cancelPageFieldPicker()).toBe(false);
  });

  it('highlights compatible fields, selects the exact clicked target, and cleans up', async () => {
    const input = new FakeInput();
    const listeners = new Map<string, EventListener>();
    globalThis.HTMLInputElement = FakeInput as unknown as typeof HTMLInputElement;
    globalThis.window = {
      location: { origin: 'https://login.example.test', href: 'https://login.example.test/form' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    globalThis.document = {
      querySelectorAll: () => [input],
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => listeners.set(type, listener as EventListener),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as Document;

    const selected = pickPageField();
    expect(input.style.outline).toBe('2px solid #7857ff');
    listeners.get('click')!({
      composedPath: () => [input], preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
    } as unknown as Event);

    await expect(selected).resolves.toMatchObject({ semantic: 'username', origin: 'https://login.example.test' });
    expect(input.style.outline).toBe('initial');
    expect(listeners.size).toBe(0);
  });

  it('restores highlighting when Escape cancels selection', async () => {
    const input = new FakeInput();
    const listeners = new Map<string, EventListener>();
    globalThis.HTMLInputElement = FakeInput as unknown as typeof HTMLInputElement;
    globalThis.window = {
      location: { origin: 'https://login.example.test', href: 'https://login.example.test/form' },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    } as unknown as Window & typeof globalThis;
    globalThis.document = {
      querySelectorAll: () => [input],
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => listeners.set(type, listener as EventListener),
      removeEventListener: (type: string) => listeners.delete(type),
    } as unknown as Document;
    const selected = pickPageField();
    listeners.get('keydown')!({ key: 'Escape', preventDefault() {}, stopPropagation() {} } as unknown as Event);
    await expect(selected).resolves.toBeNull();
    expect(input.style.outline).toBe('initial');
  });
});
