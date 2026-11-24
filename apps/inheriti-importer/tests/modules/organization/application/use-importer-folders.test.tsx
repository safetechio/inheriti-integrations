// @vitest-environment happy-dom

import { type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSelectedOrganizationSnapshot,
  setActiveOrganizationAccount,
} from '@modules/organization/infrastructure/selected-organization-api';
import { ApiStatusError } from '@modules/_shared/domain/api-status-error';
import type { PlanFolder } from '@modules/organization/domain/plan-folder';

const capabilityState = vi.hoisted(() => ({ canManagePlanFolders: true }));

vi.mock('@shared/infrastructure/importer-api/runtime', () => ({
  useRuntime: () => ({ transport }),
}));

vi.mock('@modules/organization/infrastructure/organization-policy-api', () => ({
  useSelectedOrganizationMemberCapabilities: () => capabilityState,
}));

import { useImporterFolders } from '@modules/organization/application/use-importer-folders';

type HttpRequest = {
  method: string;
  path: string;
  query?: unknown;
  body?: unknown;
};

const transport = {
  request: vi.fn(),
};

const folder: PlanFolder = {
  id: 'folder-1',
  name: 'Finance',
  parentId: null,
  scope: 'SHARED',
  revision: 4,
};
const team = { id: 'team-1', name: 'Engineering' };

function setup(response: unknown = { items: [folder] }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  transport.request.mockImplementation(async (request: HttpRequest) => ({
    status: 200,
    body: {
      result: request.path.endsWith('/member-plan-creation-teams') ? { items: [team] } : response,
    },
  }));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

function requestsFor(method: string) {
  return transport.request.mock.calls
    .map(([request]) => request as HttpRequest)
    .filter((request) => request.method === method);
}

beforeEach(() => {
  localStorage.clear();
  setActiveOrganizationAccount('account-a');
  localStorage.setItem('selectedOrganizationId:account-a', 'org-1');
  capabilityState.canManagePlanFolders = true;
  transport.request.mockReset();
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'generated-folder-id') });
});

afterEach(() => {
  setActiveOrganizationAccount(null);
  vi.unstubAllGlobals();
});

describe('useImporterFolders', () => {
  it('uses account, organization, and scope in the query key and GET catalog contract', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useImporterFolders(), { wrapper });

    await waitFor(() => expect(result.current.folders).toEqual([folder]));
    expect(result.current.teams).toEqual([team]);
    expect(requestsFor('GET')).toContainEqual({
      method: 'GET',
      path: '/integrations/v1/organizations/org-1/plan-folders',
      query: { scope: 'SHARED' },
    });

    expect(result.current.scope).toBe('SHARED');
    expect(result.current).not.toHaveProperty('onScopeChange');
  });

  it.each(['single', 'bulk'] as const)('refreshes the catalog and explains a %s delete conflict', async (kind) => {
    const assignments = [{ folderId: folder.id, planId: 'remote-plan', revision: 1 }];
    const { client, wrapper } = setup({ items: [folder], assignments });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    await waitFor(() => expect(result.current.assignments).toEqual(assignments));

    transport.request.mockRejectedValueOnce(new ApiStatusError('plan_folder_not_empty', 400));
    const remove = kind === 'single' ? () => result.current.onDeleteFolder!(folder) : () => result.current.onDeleteFolders!([folder]);
    await expect(remove()).rejects.toThrow('A folder still contains plans or subfolders.');
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('reports team loading and failure, then retries the teams query', async () => {
    const { wrapper } = setup();
    let fail!: (error: Error) => void;
    transport.request.mockImplementation(async (request: HttpRequest) => (
      request.path.endsWith('/member-plan-creation-teams')
        ? new Promise((_resolve, reject) => { fail = reject; })
        : { status: 200, body: { result: { items: [folder] } } }
    ));
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    expect(result.current.teamsLoading).toBe(true);
    expect(result.current.teamsError).toBeUndefined();
    act(() => fail(new Error('Network error')));
    await waitFor(() => expect(result.current.teamsError).toBe('Teams could not be loaded.'));
    expect(result.current.teamsLoading).toBe(false);

    transport.request.mockResolvedValueOnce({ status: 200, body: { result: { items: [team] } } });
    act(() => result.current.onRetryTeams());
    await waitFor(() => expect(result.current.teams).toEqual([team]));
    expect(result.current.teamsError).toBeUndefined();
    expect(result.current.teamsLoading).toBe(false);
  });

  it('reports a deferred catalog refresh while keeping the loaded folders', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    expect(result.current.hasLoaded).toBe(false);
    await waitFor(() => expect(result.current.folders).toEqual([folder]));

    let finish!: () => void;
    transport.request.mockImplementationOnce(() => new Promise((resolve) => {
      finish = () => resolve({ status: 200, body: { result: { items: [] } } });
    }));
    act(() => result.current.onRetry());
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(result.current.folders).toEqual([folder]);
    act(() => finish());
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(result.current.folders).toEqual([]);
    expect(result.current.hasLoaded).toBe(true);
  });

  it('creates root and nested folders with UUID, shared scope, and no policy', async () => {
    const { wrapper } = setup({ items: [] });
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(() => result.current.onCreateFolder?.({ name: 'Finance', parentId: null, scope: 'SHARED' }));
    await act(() => result.current.onCreateFolder?.({ name: 'Cards', parentId: 'folder-1', scope: 'PERSONAL' }));

    expect(requestsFor('POST')).toEqual([
      {
        method: 'POST',
        path: '/integrations/v1/organizations/org-1/plan-folders',
        body: { name: 'Finance', parentId: null, scope: 'SHARED', id: 'generated-folder-id', policy: null },
      },
      {
        method: 'POST',
        path: '/integrations/v1/organizations/org-1/plan-folders',
        body: { name: 'Cards', parentId: 'folder-1', scope: 'SHARED', id: 'generated-folder-id', policy: null },
      },
    ]);
  });

  it('forwards explicit allow and deny team policy when creating a folder', async () => {
    const { wrapper } = setup({ items: [] });
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const policy = { teams: { allow: ['team-1'], deny: ['team-2'] } };

    await act(() => result.current.onCreateFolder?.({ name: 'Restricted', parentId: null, scope: 'SHARED', policy }));

    expect(requestsFor('POST')[0]).toMatchObject({
      path: '/integrations/v1/organizations/org-1/plan-folders',
      body: { name: 'Restricted', parentId: null, scope: 'SHARED', id: 'generated-folder-id', policy },
    });
  });

  it('renames by folder UUID with the current revision', async () => {
    const { wrapper } = setup({ items: [folder] });
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    await waitFor(() => expect(result.current.folders).toEqual([folder]));

    await act(() => result.current.onRenameFolder?.(folder, 'Finance team'));

    expect(requestsFor('PATCH')).toEqual([
      {
        method: 'PATCH',
        path: '/integrations/v1/organizations/org-1/plan-folders/folder-1',
        body: { name: 'Finance team', expectedRevision: 4 },
      },
    ]);
  });

  it('does not expose mutations without canManagePlanFolders', async () => {
    capabilityState.canManagePlanFolders = false;
    const { wrapper } = setup();
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.onCreateFolder).toBeUndefined();
    expect(result.current.onRenameFolder).toBeUndefined();
    expect(result.current.onPreviewFolderChange).toBeUndefined();
    expect(result.current.onChangeFolderPolicy).toBeUndefined();
    expect(result.current.onMoveFolder).toBeUndefined();
    expect(result.current.onDeleteFolder).toBeUndefined();
    expect(result.current.onDeleteFolders).toBeUndefined();
  });

  it('previews without invalidation and sends canonical revision fenced folder mutations', async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    await waitFor(() => expect(result.current.folders).toEqual([folder]));
    const policy = { teams: { allow: ['team-1'], deny: [] } };
    const preview = { affectedPlanIds: [], addedTeamIds: [], removedTeamIds: [], addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [] };
    transport.request.mockImplementation(async (request: HttpRequest) => ({ status: 200, body: { result: request.path.endsWith('/change-preview') ? preview : { items: [folder] } } }));

    await expect(result.current.onPreviewFolderChange?.(folder, { policy })).resolves.toEqual(preview);
    expect(invalidate).not.toHaveBeenCalled();
    await act(() => result.current.onChangeFolderPolicy?.(folder, policy));
    await act(() => result.current.onMoveFolder?.(folder, null));
    await act(() => result.current.onDeleteFolder?.(folder));
    await act(() => result.current.onDeleteFolders?.([folder]));

    expect(requestsFor('POST')).toContainEqual({ method: 'POST', path: '/integrations/v1/organizations/org-1/plan-folders/folder-1/change-preview', body: { policy } });
    expect(requestsFor('PUT')).toContainEqual({ method: 'PUT', path: '/integrations/v1/organizations/org-1/plan-folders/folder-1/policy', body: { policy, expectedRevision: 4 } });
    expect(requestsFor('POST')).toContainEqual({ method: 'POST', path: '/integrations/v1/organizations/org-1/plan-folders/folder-1/move', body: { parentId: null, expectedRevision: 4 } });
    expect(requestsFor('DELETE')).toContainEqual({ method: 'DELETE', path: '/integrations/v1/organizations/org-1/plan-folders/folder-1', query: { expectedRevision: 4 } });
    expect(requestsFor('POST')).toContainEqual({ method: 'POST', path: '/integrations/v1/organizations/org-1/plan-folders/bulk-delete', body: { operationId: 'generated-folder-id', folders: [{ id: 'folder-1', expectedRevision: 4 }] } });
    expect(invalidate).toHaveBeenCalledTimes(4);
  });

  it('rejects stale previews and failed mutation without invalidating', async () => {
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    await waitFor(() => expect(result.current.folders).toEqual([folder]));
    const preview = result.current.onPreviewFolderChange;
    transport.request.mockRejectedValue(new Error('stale revision'));
    await expect(result.current.onMoveFolder?.(folder, null)).rejects.toThrow('stale revision');
    expect(invalidate).not.toHaveBeenCalled();
    setActiveOrganizationAccount('account-b');
    await expect(preview?.(folder, { parentId: null })).rejects.toThrow('active account or organisation changed');
    expect(requestsFor('POST')).toHaveLength(1);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('fences stale account and organization closures before POST or PATCH', async () => {
    const { wrapper } = setup({ items: [folder] });
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    await waitFor(() => expect(result.current.folders).toEqual([folder]));
    const { onCreateFolder, onRenameFolder } = result.current;

    setActiveOrganizationAccount('account-b');
    localStorage.setItem('selectedOrganizationId:account-b', 'org-2');
    await expect(onCreateFolder?.({ name: 'Blocked', parentId: null, scope: 'SHARED' })).rejects.toThrow(
      'active account or organisation changed',
    );
    await expect(onRenameFolder?.(folder, 'Blocked')).rejects.toThrow(
      'active account or organisation changed',
    );
    expect(requestsFor('POST')).toHaveLength(0);
    expect(requestsFor('PATCH')).toHaveLength(0);
    expect(getSelectedOrganizationSnapshot()).toBe('org-2');
  });

  it('surfaces load errors, refetches, and never invents folders after failed mutations', async () => {
    const { wrapper } = setup();
    let catalogFailed = true;
    transport.request.mockImplementation(async (request: HttpRequest) => {
      if (request.method === 'GET' && request.path.endsWith('/plan-folders') && catalogFailed) {
        catalogFailed = false;
        throw new Error('catalog failed');
      }
      return { status: 200, body: { result: request.path.endsWith('/member-plan-creation-teams') ? { items: [team] } : { items: [folder] } } };
    });
    const { result } = renderHook(() => useImporterFolders(), { wrapper });
    await waitFor(() => expect(result.current.error).toBe('Folders could not be loaded. Check your access and retry.'));
    expect(result.current.folders).toEqual([]);

    transport.request.mockResolvedValue({ status: 200, body: { result: { items: [folder] } } });
    act(() => result.current.onRetry());
    await waitFor(() => expect(result.current.folders).toEqual([folder]));

    transport.request.mockImplementation(async (request: HttpRequest) => {
      if (request.method === 'POST') throw new Error('create failed');
      return { status: 200, body: { result: { items: [folder] } } };
    });
    await expect(result.current.onCreateFolder?.({ name: 'No fake row', parentId: null, scope: 'SHARED' })).rejects.toThrow(
      'create failed',
    );
    expect(result.current.folders).toEqual([folder]);
  });
});
