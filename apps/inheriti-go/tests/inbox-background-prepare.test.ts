import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => {
  let slots: unknown[] = [];
  let effects: Array<{ deps: unknown[]; cleanup: (() => void) | undefined }> = [];
  let cursor = 0;
  let pending: Array<() => void> = [];
  const same = (left: unknown[], right: unknown[]) => left.length === right.length && left.every((value, index) => value === right[index]);
  return {
    reset() { effects.forEach((effect) => effect?.cleanup?.()); slots = []; effects = []; cursor = 0; pending = []; },
    begin() { cursor = 0; },
    commit() { const jobs = pending; pending = []; jobs.forEach((job) => job()); },
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: unknown) => { slots[index] = value; }];
    },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback<T>(callback: T, deps: unknown[]): T {
      const index = cursor++;
      const previous = slots[index] as { deps: unknown[]; callback: T } | undefined;
      if (!previous || !same(previous.deps, deps)) slots[index] = { deps, callback };
      return (slots[index] as { callback: T }).callback;
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++;
      const previous = effects[index];
      if (!previous || !same(previous.deps, deps)) pending.push(() => {
        previous?.cleanup?.();
        effects[index] = { deps, cleanup: effect() };
      });
    },
  };
});

vi.mock('react', () => ({ useState: hooks.useState, useRef: hooks.useRef, useCallback: hooks.useCallback, useEffect: hooks.useEffect }));

// @ts-expect-error The React hook is JavaScript and has no declaration file.
import { useInboxState } from '../src/modules/inbox/ui/useInboxState.js';
// @ts-expect-error The React hook is JavaScript and has no declaration file.
import { useInboxAccess } from '../src/modules/inbox/ui/useInboxAccess.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function render(organizationId?: string) {
  hooks.begin();
  const identity = useInboxState(organizationId);
  hooks.commit();
  return identity;
}

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('background Secure Chat preparation', () => {
  let state: ReturnType<typeof deferred<{ status: string }>>;
  let prepare: ReturnType<typeof deferred<{ status: string }>>;
  let listeners: Array<(state: { status: string }) => void>;
  let prepareCalls: number;

  beforeEach(() => {
    hooks.reset();
    state = deferred();
    prepare = deferred();
    listeners = [];
    prepareCalls = 0;
    (globalThis as any).window = { inheritiTray: {
      inboxState: () => state.promise,
      inboxPrepare: () => { prepareCalls++; return prepare.promise; },
      inboxReplaceDevice: vi.fn(),
      onInboxStateChanged: (listener: (state: { status: string }) => void) => {
        listeners.push(listener);
        return () => { listeners = listeners.filter((entry) => entry !== listener); };
      },
    } };
  });

  it('prepares on the main screen once, even when Chat opens', async () => {
    render('org-a');
    state.resolve({ status: 'missing' });
    await tick();
    expect(prepareCalls).toBe(1);
    expect(render('org-a').state?.status).toBe('missing');
    prepare.resolve({ status: 'ready' });
    await tick();
    expect(render('org-a').state?.status).toBe('ready');
    expect(prepareCalls).toBe(1);
  });

  it('ignores a stale initial response after a newer ready event', async () => {
    render('org-a');
    listeners[0]?.({ status: 'ready' });
    state.resolve({ status: 'missing' });
    await tick();
    expect(render('org-a').state?.status).toBe('ready');
    expect(prepareCalls).toBe(0);
  });

  it('fences previous account responses', async () => {
    render('org-a');
    state.resolve({ status: 'missing' });
    await tick();
    render(undefined);
    state = deferred();
    expect(render('org-a').state).toBeNull();
    prepare.resolve({ status: 'ready' });
    await tick();
    expect(render('org-a').state).toBeNull();
    render('org-b');
    expect(render('org-b').state).toBeNull();
  });

  it('ignores an old organization status after switching', async () => {
    render('org-a');
    const oldState = state;
    state = deferred();
    render('org-b');
    oldState.resolve({ status: 'missing' });
    await tick();
    expect(prepareCalls).toBe(0);
    state.resolve({ status: 'missing' });
    await tick();
    expect(prepareCalls).toBe(1);
  });

  it('retains failure for explicit retry', async () => {
    render('org-a');
    state.resolve({ status: 'missing' });
    await tick();
    prepare.reject(new Error('offline'));
    await tick();
    const failed = render('org-a');
    expect(failed.error).toMatch(/Could not prepare/);
    expect(prepareCalls).toBe(1);
    void failed.prepare();
    expect(prepareCalls).toBe(2);
    expect(render('org-a').error).toBe('');
  });
});

describe('Secure Chat organisation-key gate', () => {
  beforeEach(() => { hooks.reset(); });

  it('checks access only when Chat mounts and retains it across reopening', async () => {
    const access = vi.fn().mockResolvedValue(undefined);
    const cancel = vi.fn().mockResolvedValue(undefined);
    (globalThis as any).window = { inheritiTray: { inboxAccess: access, inboxCancelAccess: cancel } };
    expect(access).not.toHaveBeenCalled();
    hooks.begin(); useInboxAccess('org-a'); hooks.commit();
    await tick();
    hooks.begin(); expect(useInboxAccess('org-a').status).toBe('ready'); hooks.commit();
    expect(access).toHaveBeenCalledTimes(1);
    hooks.reset();
    expect(cancel).toHaveBeenCalledTimes(1);
    hooks.begin(); useInboxAccess('org-a'); hooks.commit();
    expect(access).toHaveBeenCalledTimes(2);
  });

  it('waits for device identity before requesting the organisation key', async () => {
    const access = vi.fn().mockResolvedValue(undefined);
    (globalThis as any).window = { inheritiTray: { inboxAccess: access, inboxCancelAccess: vi.fn() } };
    hooks.begin(); useInboxAccess(undefined); hooks.commit();
    expect(access).not.toHaveBeenCalled();
    hooks.begin(); useInboxAccess('org-a'); hooks.commit();
    expect(access).toHaveBeenCalledTimes(1);
  });

  it('withholds access until success and allows retry after failure', async () => {
    const pending = deferred<void>();
    const access = vi.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(undefined);
    (globalThis as any).window = { inheritiTray: { inboxAccess: access, inboxCancelAccess: vi.fn() } };
    hooks.begin(); useInboxAccess('org-a'); hooks.commit();
    hooks.begin(); expect(useInboxAccess('org-a').status).toBe('checking'); hooks.commit();
    pending.reject(new Error('denied'));
    await tick();
    hooks.begin(); const failed = useInboxAccess('org-a'); hooks.commit();
    expect(failed.status).toBe('error');
    await failed.retry();
    hooks.begin(); expect(useInboxAccess('org-a').status).toBe('ready'); hooks.commit();
  });

  it('ignores a late access result after leaving Chat', async () => {
    const pending = deferred<void>();
    const cancel = vi.fn();
    (globalThis as any).window = { inheritiTray: { inboxAccess: () => pending.promise, inboxCancelAccess: cancel } };
    hooks.begin(); useInboxAccess('org-a'); hooks.commit();
    hooks.reset();
    pending.resolve();
    await tick();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
