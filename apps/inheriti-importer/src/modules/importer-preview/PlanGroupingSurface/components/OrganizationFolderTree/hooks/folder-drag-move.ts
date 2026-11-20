import type { Folder } from '../../../types';

export function moveRoots(folders: Folder[], ids: string[]): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const selected = new Set(ids);
  return ids.flatMap((id) => {
    const folder = byId.get(id);
    if (!folder) return [];
    let parentId = folder.parentId;
    const seen = new Set([id]);
    while (parentId && !seen.has(parentId)) {
      if (selected.has(parentId)) return [];
      seen.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    return [folder];
  });
}

export function validFolderDestination(folders: Folder[], roots: Folder[], destinationId: string | null, scope: Folder['scope']): boolean {
  if (!roots.length || roots.some((folder) => folder.scope !== scope)) return false;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  if (destinationId && byId.get(destinationId)?.scope !== scope) return false;
  if (roots.every((folder) => folder.parentId === destinationId)) return false;
  const moving = new Set(roots.map((folder) => folder.id));
  let id = destinationId;
  const seen = new Set<string>();
  while (id) {
    if (moving.has(id) || seen.has(id)) return false;
    seen.add(id);
    id = byId.get(id)?.parentId ?? null;
  }
  return true;
}
