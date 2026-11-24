import { useEffect, useRef, useState } from 'react';
import type { Folder, FolderWorkspaceProps } from '../../../types';
import type { FolderChangePreview, FolderTeamsPolicy } from '@modules/organization/domain/plan-folder';

type Entry = { folderId: string; preview: FolderChangePreview };
type Changes = { policy?: FolderTeamsPolicy | null; usePlanPermissions?: boolean; parentId?: string | null };

export function useFolderChangePreview({ folders, workspace, changes, enabled = true }: {
  folders: Folder[];
  workspace: Pick<FolderWorkspaceProps, 'onPreviewFolderChange'>;
  changes: Changes;
  enabled?: boolean;
}) {
  const key = JSON.stringify([folders.map(({ id, revision }) => [id, revision]), changes]);
  const latest = useRef({ folders, changes, preview: workspace.onPreviewFolderChange });
  latest.current = { folders, changes, preview: workspace.onPreviewFolderChange };
  const canPreview = enabled && folders.length > 0 && Boolean(workspace.onPreviewFolderChange);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; pending: boolean; previews: Entry[]; error?: string }>({ key: '', pending: false, previews: [] });

  useEffect(() => {
    if (!canPreview) return;
    let cancelled = false;
    const snapshot = latest.current;
    setResult({ key, pending: true, previews: [] });
    void (async () => {
      const previews: Entry[] = [];
      try {
        for (const folder of snapshot.folders) {
          if (cancelled) return;
          const preview = await snapshot.preview!(folder, snapshot.changes);
          if (cancelled) return;
          previews.push({ folderId: folder.id, preview });
        }
        setResult({ key, pending: false, previews });
      } catch (cause) {
        if (!cancelled) setResult({ key, pending: false, previews: [], error: cause instanceof Error ? cause.message : 'Could not check this change. Try again.' });
      }
    })();
    return () => { cancelled = true; };
  }, [key, canPreview, attempt]);

  return {
    previews: canPreview && result.key === key ? result.previews : [],
    pending: canPreview && (result.key !== key || result.pending),
    error: canPreview && result.key === key ? result.error : undefined,
    retry: () => setAttempt((value) => value + 1),
  };
}
