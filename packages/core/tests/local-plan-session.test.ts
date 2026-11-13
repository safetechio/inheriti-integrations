// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localPlanSessionScript } from '../src/local-plan-session.js';

const eventListeners: Array<[string, EventListenerOrEventListenerObject, AddEventListenerOptions | boolean | undefined]> = [];
let addSpy: ReturnType<typeof vi.spyOn> | undefined;

const mount = (expiresAt: number) => {
  document.body.innerHTML = `<main data-session-expires-at="${expiresAt}">
    <aside data-session-notice hidden><p data-session-message role="status"></p><button type="button" data-continue-session>Continue session</button><p data-session-error role="alert"></p></aside>
    <form class="work-form" action="/session"><input name="csrf" value="csrf"><textarea name="secret">keep me</textarea><button type="submit">Create plan</button></form>
    <form class="cancel-form" action="/session"><input name="csrf" value="csrf"><input type="hidden" name="action" value="cancel"><button type="submit">Cancel session</button></form>
  </main>`;
  const add = document.addEventListener.bind(document);
  addSpy = vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    eventListeners.push([type, listener, options]);
    add(type, listener, options);
  });
  new Function(localPlanSessionScript)();
};
afterEach(() => {
  vi.clearAllTimers();
  for (const [type, listener, options] of eventListeners.splice(0)) document.removeEventListener(type, listener, options);
  addSpy?.mockRestore();
  addSpy = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('local plan session activity and recovery', () => {
  it('renews only after the activity throttle, and does not renew on every keystroke', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ expiresAt: Date.now() + 1_800_000 }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    mount(Date.now() + 1_800_000);
    const input = document.querySelector('textarea')!;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(fetchMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_001);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.runOnlyPendingTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('warns before expiry and then locks editable controls while keeping cancel and fields', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    mount(Date.now() + 119_000);
    vi.advanceTimersByTime(1_000);
    const main = document.querySelector('main')!;
    expect(main.querySelector<HTMLElement>('[data-session-notice]')?.hidden).toBe(false);
    expect(main.querySelector('[data-session-message]')?.textContent).toContain('Session pauses');

    vi.setSystemTime(new Date('2026-11-13T12:02:01Z'));
    vi.advanceTimersByTime(1_000);
    expect((main.querySelector('textarea') as HTMLTextAreaElement).value).toBe('keep me');
    expect((main.querySelector('.work-form button') as HTMLButtonElement).disabled).toBe(true);
    expect((main.querySelector('.cancel-form button') as HTMLButtonElement).disabled).toBe(false);
    expect((main.querySelector('[data-continue-session]') as HTMLButtonElement).disabled).toBe(false);
    expect(main.querySelector('[data-session-message]')?.textContent).toContain('Session paused');
  });

  it('resumes explicitly with the CSRF keep-alive and restores controls', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const renewed = Date.now() + 1_800_000;
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(JSON.stringify({ expiresAt: renewed }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    mount(Date.now() - 1);
    vi.advanceTimersByTime(1_000);
    const main = document.querySelector('main')!;
    const continueButton = main.querySelector<HTMLButtonElement>('[data-continue-session]')!;
    expect(main.querySelector<HTMLButtonElement>('.work-form button')!.disabled).toBe(true);
    continueButton.click();
    await vi.runOnlyPendingTimersAsync();
    expect(fetchMock).toHaveBeenCalledWith('/session', expect.objectContaining({ method: 'POST' }));
    const body = (fetchMock.mock.calls[0]![1] as RequestInit).body as URLSearchParams;
    expect(body.get('action')).toBe('keep-alive');
    expect(body.get('csrf')).toBe('csrf');
    expect(main.dataset.sessionExpiresAt).toBe(String(renewed));
    expect(main.querySelector<HTMLButtonElement>('.work-form button')!.disabled).toBe(false);
    expect(continueButton.disabled).toBe(false);
  });

  it('does not auto-resume after expiry and keeps fields when continuation fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    const fetchMock = vi.fn(() => Promise.reject(new Error('offline')));
    vi.stubGlobal('fetch', fetchMock);
    mount(Date.now() - 1);
    vi.advanceTimersByTime(1_000);
    const main = document.querySelector('main')!;
    main.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(fetchMock).not.toHaveBeenCalled();
    main.querySelector<HTMLButtonElement>('[data-continue-session]')!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(main.querySelector('[data-session-error]')?.textContent).toContain('Could not continue');
    expect(main.querySelector('textarea')?.textContent ?? (main.querySelector('textarea') as HTMLTextAreaElement).value).toBe('keep me');
    expect(main.querySelector('.cancel-form button')).not.toHaveProperty('disabled', true);
  });

  it('keeps an active Suggest fields dialog usable while its request is busy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    mount(Date.now() + 1_800_000);
    const main = document.querySelector('main')!;
    const dialog = document.createElement('dialog');
    dialog.open = true;
    dialog.innerHTML = '<button type="button" data-suggest-asset aria-busy="true">Suggest fields</button>';
    main.append(dialog);
    main.dataset.sessionExpiresAt = String(Date.now() - 1);

    vi.advanceTimersByTime(1_000);
    expect(main.querySelector<HTMLButtonElement>('.work-form button')!.disabled).toBe(false);
    expect(dialog.open).toBe(true);
    expect(main.querySelector<HTMLElement>('[data-session-notice]')?.hidden).toBe(true);

    dialog.querySelector('button')!.removeAttribute('aria-busy');
    main.dataset.sessionExpiresAt = String(Date.now() + 1_800_000);
    (window as typeof window & { updateLocalPlanSession: () => void }).updateLocalPlanSession();
    expect(main.querySelector<HTMLElement>('[data-session-notice]')?.hidden).toBe(true);
    expect(dialog.open).toBe(true);
  });
});
