// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useFolderChangePreview } from '@modules/importer-preview/PlanGroupingSurface/components/OrganizationFolderTree/hooks/use-folder-change-preview';
import type { FolderChangePreview } from '@modules/organization/domain/plan-folder';

afterEach(cleanup);

const folder = { id: 'folder', name: 'Finance', parentId: null, scope: 'SHARED' as const, revision: 1 };
const preview = (id: string): FolderChangePreview => ({ affectedPlanIds: [id], addedTeamIds: [], removedTeamIds: [], addedDeniedTeamIds: [], removedDeniedTeamIds: [], blockers: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

it('ignores a stale preview after the destination changes', async () => {
  const old = deferred<FolderChangePreview>();
  const latest = deferred<FolderChangePreview>();
  const request = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
  const { result, rerender } = renderHook(({ destination }) => useFolderChangePreview({ folders: [folder], workspace: { onPreviewFolderChange: request }, changes: { parentId: destination } }), { initialProps: { destination: 'old' } });
  rerender({ destination: 'new' });
  expect(result.current.pending).toBe(true);
  expect(result.current.previews).toEqual([]);
  await act(async () => latest.resolve(preview('new')));
  expect(result.current.previews[0]?.preview.affectedPlanIds).toEqual(['new']);
  await act(async () => old.resolve(preview('old')));
  expect(result.current.previews[0]?.preview.affectedPlanIds).toEqual(['new']);
});

it('previews a group without flooding requests', async () => {
  const first = deferred<FolderChangePreview>();
  const request = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(preview('second'));
  const { result } = renderHook(() => useFolderChangePreview({ folders: [folder, { ...folder, id: 'second' }], workspace: { onPreviewFolderChange: request }, changes: { parentId: 'target' } }));
  expect(request).toHaveBeenCalledTimes(1);
  await act(async () => first.resolve(preview('first')));
  await waitFor(() => expect(result.current.pending).toBe(false));
  expect(request).toHaveBeenCalledTimes(2);
  expect(result.current.previews.map((item) => item.folderId)).toEqual(['folder', 'second']);
});

it('retries a failed automatic preview without discarding the destination', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValue(preview('retried'));
  const { result } = renderHook(() => useFolderChangePreview({ folders: [folder], workspace: { onPreviewFolderChange: request }, changes: { parentId: 'target' } }));
  await waitFor(() => expect(result.current.error).toBe('Temporary failure'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.previews).toHaveLength(1));
  expect(request.mock.calls[1][1]).toEqual({ parentId: 'target' });
});


it('stops issuing group requests after the modal unmounts', async () => {
  const first = deferred<FolderChangePreview>();
  const request = vi.fn().mockReturnValue(first.promise);
  const { unmount } = renderHook(() => useFolderChangePreview({ folders: [folder, { ...folder, id: 'second' }], workspace: { onPreviewFolderChange: request }, changes: { parentId: 'target' } }));
  unmount();
  await act(async () => first.resolve(preview('first')));
  expect(request).toHaveBeenCalledTimes(1);
});
