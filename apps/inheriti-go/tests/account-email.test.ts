import { expect, it, vi } from 'vitest';
import { TrayAccountSwitcher } from '../src/modules/launcher/main/tray-account-switcher.js';
import { TrayAuthRuntime } from '../src/modules/launcher/main/tray-auth-runtime.js';

it('shows fetched emails only for ready saved accounts', async () => {
  const auth = {
    accountSummaries: vi.fn().mockResolvedValue({ activeSubject: 'one', accounts: [
      { subject: 'one', name: 'One', status: 'ready' },
      { subject: 'two', name: 'Two', status: 'ready' },
      { subject: 'three', name: 'Three', status: 'sign-in-again' },
    ] }),
    accountIdentity: vi.fn().mockImplementation(async (subject: string) => {
      if (subject === 'one') return { name: 'One Person', email: 'one@example.test' };
      throw new Error('profile_unavailable');
    }),
  };
  const switcher = new TrayAccountSwitcher(auth as never, { organizations: [] } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, undefined, () => false);

  await switcher.refresh(true);

  expect(switcher.snapshot).toEqual({ activeSubject: 'one', accounts: [
    { subject: 'one', name: 'One Person', status: 'ready', email: 'one@example.test', organizations: [] },
    { subject: 'two', name: 'Two', status: 'ready', organizations: [] },
    { subject: 'three', name: 'Three', status: 'sign-in-again', organizations: [] },
  ] });
  expect(auth.accountIdentity.mock.calls.map(([subject]) => subject)).toEqual(['one', 'two']);
});

it('looks up a profile email with the saved access token without refreshing', async () => {
  const profile = { accessToken: 'saved-token', expiresAt: Date.now() + 60_000, generation: 4 };
  const store = { accountSummaries: vi.fn().mockResolvedValue({ accounts: [{ subject: 'one', status: 'ready' }] }),
    profileForIdentity: vi.fn().mockReturnValue(profile), saveProfileIdentity: vi.fn() };
  const auth = Object.assign(Object.create(TrayAuthRuntime.prototype), {
    store, apiUrl: 'https://business.test/integrations/', environment: 'TEST',
    activeCore: { auth: { getAccessToken: vi.fn() } },
  }) as TrayAuthRuntime;
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true,
    json: async () => ({ result: { firstName: 'One', lastName: 'Person', email: 'one@example.test' } }) } as Response);
  try {
    expect(await auth.accountIdentity('one')).toEqual({ name: 'One Person', email: 'one@example.test' });
    expect(fetchMock).toHaveBeenCalledWith(new URL('https://business.test/integrations/v1/importer/profile'),
      expect.objectContaining({ headers: { authorization: 'Bearer saved-token', 'x-elements-environment': 'TEST' } }));
    expect(store.saveProfileIdentity).toHaveBeenCalledWith('one', 4, { name: 'One Person', email: 'one@example.test' });
    expect((auth as unknown as { activeCore: { auth: { getAccessToken: ReturnType<typeof vi.fn> } } }).activeCore.auth.getAccessToken).not.toHaveBeenCalled();
  } finally { fetchMock.mockRestore(); }
});

it('ignores a saved-account refresh that finishes after sign-out', async () => {
  let finishIdentity!: (identity: { name: string; email: string }) => void;
  const pendingIdentity = new Promise<{ name: string; email: string }>((resolve) => { finishIdentity = resolve; });
  const auth = { accountSummaries: vi.fn()
    .mockResolvedValueOnce({ activeSubject: 'one', accounts: [{ subject: 'one', name: 'One', status: 'ready' }] })
    .mockResolvedValueOnce({ activeSubject: undefined, accounts: [] }),
  accountIdentity: vi.fn().mockReturnValue(pendingIdentity) };
  const switcher = new TrayAccountSwitcher(auth as never, { organizations: [] } as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, undefined, () => false);
  const oldRefresh = switcher.refresh(true);
  await Promise.resolve();
  await switcher.refresh(false);
  finishIdentity({ name: 'One Person', email: 'one@example.test' });
  await oldRefresh;
  expect(switcher.snapshot).toEqual({ accounts: [], activeSubject: undefined });
});
