import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ begin: vi.fn(), clear: vi.fn(), complete: vi.fn(), token: vi.fn(), organizations: vi.fn(), context: vi.fn(), create: vi.fn(), teams: vi.fn(), abandon: vi.fn(), operations: vi.fn() }));

vi.mock('@safetech/inheriti-elements-core/node', () => ({
  BUSINESS_DEPLOYMENTS: { dev: { apiUrl: 'https://example.test/', issuer: 'https://issuer.test/', environment: 'TEST' } },
  BUSINESS_INTERACTIVE_CLIENT_ID: 'interactive',
  createNodeIntegrationCore: () => ({ auth: { beginAuthorizationCode: mock.begin, clear: mock.clear, completeAuthorizationCode: mock.complete, getAccessToken: mock.token }, listOrganizations: mock.organizations }),
  quickPlanAssetCatalog: [{ id: 'PLAIN-TEXT', category: 'GENERAL-DATA', fields: ['text'] }],
  createQuickPlanOperations: mock.operations,
}));

import { TraySession } from '../src/modules/launcher/main/state.js';

const asset = (text: string) => ({ type: 'PLAIN-TEXT' as const, meta: { name: 'Note' }, secret: { text } });

describe('TraySession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.organizations.mockResolvedValue([]);
    mock.teams.mockResolvedValue({ teams: [] });
    mock.operations.mockReturnValue({ createContext: mock.context, create: mock.create, teams: mock.teams, abandon: mock.abandon });
  });

  it('waits for a canceled sign-in before clearing shared credentials', async () => {
    let release!: (value: { authorizationUrl: string }) => void;
    mock.begin.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    mock.clear.mockResolvedValue(undefined);
    const session = new TraySession('dev');
    const signingIn = session.signIn(() => {}, async () => {});
    const signingOut = session.signOut();
    expect(mock.clear).not.toHaveBeenCalled();
    release({ authorizationUrl: 'https://issuer.test/authorize' });
    await signingIn;
    await signingOut;
    expect(mock.complete).not.toHaveBeenCalled();
    expect(mock.clear).toHaveBeenCalledTimes(1);
    expect(session.state().status).toBe('signed-out');
  });

  it('rejects an organization absent from discovery', async () => {
    const session = new TraySession('dev');
    await expect(session.select('unlisted')).rejects.toThrow('organization_access_denied');
    expect(session.state().selectedId).toBeUndefined();
  });

  it('discovers authorized organizations and recovers an expired session as signed out', async () => {
    mock.token.mockResolvedValueOnce('access-token').mockRejectedValueOnce(new Error('expired'));
    mock.organizations.mockResolvedValueOnce([{ id: 'org-1', name: 'One' }]);
    const session = new TraySession('dev');
    await session.restore();
    expect(session.state()).toMatchObject({ status: 'signed-in', selectedId: 'org-1' });
    await session.restore();
    expect(session.state().status).toBe('signed-out');
    expect(session.state().organizations).toEqual([]);
  });

  it('retains the server plan ID for a retry and uses a new one after Ready', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.context.mockResolvedValueOnce({ planId: 'plan-1' }).mockResolvedValueOnce({ planId: 'plan-2' });
    mock.create.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ status: 'READY', planId: 'plan-1' }).mockResolvedValueOnce({ status: 'READY', planId: 'plan-2' });
    const session = new TraySession('dev');
    await session.restore();
    await session.createQuickPlan({ title: 'First', asset: asset('secret') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'error', planId: 'plan-1' });
    await expect(session.createQuickPlan({ title: 'Changed', asset: asset('secret') }, () => {})).rejects.toThrow('Restore the original details');
    await session.createQuickPlan({ title: 'First', asset: asset('secret') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-1' });
    await session.createQuickPlan({ title: 'Second', asset: asset('other') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-2' });
    expect(mock.context).toHaveBeenCalledTimes(2);
    expect(mock.create.mock.calls.map(([input]) => input.context.planId)).toEqual(['plan-1', 'plan-1', 'plan-2']);
    expect(mock.operations).toHaveBeenCalledTimes(1);
  });

  it('abandoning a failed creation lets a corrected entry use a new server plan ID', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.context.mockResolvedValueOnce({ planId: 'plan-1' }).mockResolvedValueOnce({ planId: 'plan-2' });
    mock.create.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ status: 'READY', planId: 'plan-2' });
    const session = new TraySession('dev');
    await session.restore();
    await session.createQuickPlan({ title: 'Original', asset: asset('old') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'error', planId: 'plan-1' });
    session.abandonCreation();
    expect(session.state().creation).toBeUndefined();
    expect(mock.abandon).toHaveBeenCalledWith('plan-1');
    await session.createQuickPlan({ title: 'Corrected', asset: asset('new') }, () => {});
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-2' });
    expect(mock.create.mock.calls.map(([input]) => input.context.planId)).toEqual(['plan-1', 'plan-2']);
  });

  it('does not abandon an in-flight creation', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    let release!: (value: { planId: string }) => void;
    mock.context.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    mock.create.mockResolvedValueOnce({ status: 'READY', planId: 'plan-1' });
    const session = new TraySession('dev');
    await session.restore();
    const pending = session.createQuickPlan({ title: 'First', asset: asset('secret') }, () => {});
    expect(() => session.abandonCreation()).toThrow('creation_in_progress');
    release({ planId: 'plan-1' });
    await pending;
    expect(session.state().creation).toMatchObject({ status: 'ready', planId: 'plan-1' });
  });

  it('loads authorized teams and passes the selected team to the creator', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-1', name: 'One' }]);
    mock.teams.mockResolvedValue({ teams: [{ id: 'team-1', name: 'One team' }] });
    mock.context.mockResolvedValue({ planId: 'plan-1' });
    mock.create.mockResolvedValue({ status: 'READY', planId: 'plan-1' });
    const session = new TraySession('dev');
    await session.restore();
    expect(session.state().teams).toEqual([{ id: 'team-1', name: 'One team' }]);
    await expect(session.createQuickPlan({ title: 'Shared', teamId: 'unknown', asset: asset('secret') }, () => {})).rejects.toThrow('selected team');
    await session.createQuickPlan({ title: 'Shared', teamId: 'team-1', asset: asset('secret') }, () => {});
    expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ teamId: 'team-1', context: { planId: 'plan-1' } }));
  });

  it('keeps the latest organization when team requests finish in reverse order', async () => {
    mock.token.mockResolvedValue('access-token');
    mock.organizations.mockResolvedValue([{ id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]);
    let releaseA!: (value: { teams: { id: string; name: string }[] }) => void;
    let releaseB!: (value: { teams: { id: string; name: string }[] }) => void;
    mock.teams
      .mockReturnValueOnce(new Promise((resolve) => { releaseA = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { releaseB = resolve; }));
    const session = new TraySession('dev');
    await session.restore();
    const selectingA = session.select('org-a');
    const selectingB = session.select('org-b');
    expect(session.state().selectedId).toBeUndefined();
    expect(() => session.createQuickPlan({ title: 'Secret', asset: asset('secret') }, () => {})).toThrow('organization_selection_in_progress');
    releaseB({ teams: [{ id: 'team-b', name: 'B team' }] });
    await selectingB;
    expect(session.state().selectedId).toBeUndefined();
    releaseA({ teams: [{ id: 'team-a', name: 'A team' }] });
    await selectingA;
    expect(session.state()).toMatchObject({ selectedId: 'org-b', teams: [{ id: 'team-b', name: 'B team' }] });
  });
});
