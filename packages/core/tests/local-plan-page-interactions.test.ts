// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderLocalPlanPage, renderLocalPlanCreationProgressPage } from '../src/local-plan-page.js';

const options = {
  path: '/session', csrf: 'test', scriptNonce: 'test', draft: null,
  reviewAsset: { type: 'PLAIN-TEXT', title: 'Example', name: 'Account', fields: ['text'] },
  clarification: null, busy: false, selectedTeamId: '', fieldValues: {},
};
const listeners: [string, EventListenerOrEventListenerObject][] = [];
function mount(html = renderLocalPlanPage(options)) {
  document.documentElement.innerHTML = html;
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, opts) => {
    listeners.push([type, listener]);
    add(type, listener, opts);
  });
  new Function(document.querySelector('script')!.textContent!)();
}

afterEach(() => {
  (window as any).resetPlanCreationVisual?.();
  for (const [type, listener] of listeners.splice(0)) document.removeEventListener(type, listener);
  document.body.replaceChildren();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('secure plan form recovery', () => {
  it.each(['server', 'network'])('restores entered values and a working retry after a %s failure', async (failure) => {
    vi.useFakeTimers();
    mount();
    const form = document.querySelector<HTMLFormElement>('form:has([name=manualAssetCount])')!;
    const input = form.querySelector<HTMLTextAreaElement>('textarea[name="field:text"]')!;
    input.value = 'synthetic-value';
    const button = form.querySelector<HTMLButtonElement>('button[type=submit]:not([form])')!;
    let fail!: () => void;
    const progress = renderLocalPlanCreationProgressPage('awaiting-key');
    const fetchMock = vi.fn((url: string) => url.endsWith('/progress')
      ? Promise.resolve(new Response(progress))
      : new Promise<Response>((resolve, reject) => {
        fail = () => failure === 'network' ? reject(new Error('offline'))
          : resolve(new Response(renderLocalPlanPage(options, 'Review and retry.', true), { status: 500 }));
      }));
    vi.stubGlobal('fetch', fetchMock);
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
    expect(button.getAttribute('aria-busy')).toBe('true');
    await vi.advanceTimersByTimeAsync(500);
    expect(form.isConnected).toBe(false);
    fail();
    await vi.advanceTimersByTimeAsync(0);
    expect(form.isConnected).toBe(true);
    expect(input.value).toBe('synthetic-value');
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-busy')).toBe(false);
    expect(button.textContent).toBe('Retry create plan');
    button.click();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/session')).toHaveLength(2);
    fail();
    await vi.advanceTimersByTimeAsync(0);
  });

  it('submits the selected draft type with the existing fill-fields control', async () => {
    vi.useFakeTimers();
    mount(renderLocalPlanPage({ ...options, draft: {
      title: 'Example', asset: { type: 'PLAIN-TEXT', name: 'Account', fields: {} },
      questions: [], unassignedSources: [],
    } }));
    const form = document.querySelector<HTMLFormElement>('#asset-type-form')!;
    const submit = vi.spyOn(form, 'requestSubmit').mockImplementation(() => {});
    const select = document.querySelector<HTMLSelectElement>('#assetType')!;
    // happy-dom ignores an external form association on selects.
    vi.spyOn(select, 'form', 'get').mockReturnValue(form);
    select.value = 'PRIVATE-KEY';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(submit).toHaveBeenCalledWith(document.querySelector('button[form="asset-type-form"]'));
  });

  it('updates only the chosen asset and preserves edits and added assets', async () => {
    vi.useFakeTimers();
    const draft = { title: 'Example', asset: { type: 'PLAIN-TEXT', name: 'Account', fields: {
      text: { sourceId: 'source', start: 0, end: 3 },
    } }, questions: [], unassignedSources: [] };
    mount(renderLocalPlanPage({ ...options, draft, fieldValues: { text: 'old' } }));
    const title = document.querySelector<HTMLInputElement>('[name=title]')!;
    title.value = 'Edited title';
    const replacement = document.querySelector<HTMLTextAreaElement>('textarea[name="field:text"]')!;
    replacement.value = 'edited-value';
    document.querySelector<HTMLButtonElement>('[data-add-review-asset]')!.click();
    const added = document.querySelector('[data-added-asset]')!;
    added.querySelector<HTMLInputElement>('input[name^="name:"]')!.value = 'Additional asset';
    const updated = renderLocalPlanPage({ ...options, draft: null, reviewAsset: {
      type: 'PRIVATE-KEY', title: 'Example', name: 'Account', fields: ['privateKey'],
    } });
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response(updated)));
    vi.stubGlobal('fetch', fetchMock);
    const select = document.querySelector<HTMLSelectElement>('#assetType')!;
    select.value = 'PRIVATE-KEY';
    const form = document.querySelector<HTMLFormElement>('#asset-type-form')!;
    const button = document.querySelector<HTMLButtonElement>('button[form="asset-type-form"]')!;
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter: button }));
    expect(replacement.disabled).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(title.isConnected).toBe(true);
    expect(title.value).toBe('Edited title');
    expect(added.isConnected).toBe(true);
    expect(added.querySelector<HTMLInputElement>('input[name^="name:"]')!.value).toBe('Additional asset');
    expect(document.querySelector('textarea[name="field:privateKey"]')).not.toBeNull();
    expect(document.querySelector('.asset-card-title small')?.textContent).toBe('Private key');
    expect((fetchMock.mock.calls[0]![1] as RequestInit).body!.toString()).toContain('field%3Atext=edited-value');
  });
});
