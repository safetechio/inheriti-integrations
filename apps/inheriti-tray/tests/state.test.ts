import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ begin: vi.fn(), clear: vi.fn(), complete: vi.fn(), token: vi.fn(), organizations: vi.fn() }));

vi.mock('@safetech/inheriti-elements-core/node', () => ({
  BUSINESS_DEPLOYMENTS: { dev: { apiUrl: 'https://example.test/', issuer: 'https://issuer.test/', environment: 'TEST' } },
  BUSINESS_INTERACTIVE_CLIENT_ID: 'interactive',
  createNodeIntegrationCore: () => ({ auth: { beginAuthorizationCode: mock.begin, clear: mock.clear, completeAuthorizationCode: mock.complete, getAccessToken: mock.token }, listOrganizations: mock.organizations }),
}));

import { TraySession } from '../src/state.js';

describe('TraySession', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.organizations.mockResolvedValue([]);
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
});
