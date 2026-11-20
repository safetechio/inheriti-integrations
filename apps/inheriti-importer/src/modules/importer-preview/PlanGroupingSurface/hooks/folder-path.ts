import type { Folder } from '../types';

export function folderPath(folders: Folder[], id: string | null | undefined, scope: Folder['scope']) {
  const path: Folder[] = [];
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    visited.add(id);
    const folder = folders.find((item) => item.id === id && item.scope === scope);
    if (!folder) break;
    path.unshift(folder);
    id = folder.parentId;
  }
  return path;
}

export function folderPathLabel(folders: Folder[], id: string | null, scope: Folder['scope']) {
  return folderPath(folders, id, scope).map((folder) => folder.name).join(' / ') || 'Your organisation';
}
