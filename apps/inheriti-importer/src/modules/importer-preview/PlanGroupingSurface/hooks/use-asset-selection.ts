import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GroupingAsset, PlanDraft } from '../types';

export function useAssetSelection(unassigned: GroupingAsset[], plans: PlanDraft[]) {
  const [ids, setIds] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string>();
  const [pane, setPane] = useState<string>();
  const [dragIds, setDragIds] = useState<string[]>([]);
  const endDrag = useCallback(() => setDragIds((current) => current.length ? [] : current), []);
  useEffect(() => {
    window.addEventListener('drop', endDrag);
    window.addEventListener('dragend', endDrag);
    window.addEventListener('blur', endDrag);
    return () => {
      window.removeEventListener('drop', endDrag);
      window.removeEventListener('dragend', endDrag);
      window.removeEventListener('blur', endDrag);
    };
  }, [endDrag]);
  const visibleUnassigned = useRef<GroupingAsset[]>([]);
  const assigned = useMemo(() => plans.flatMap((plan) => plan.assignedAssets ?? []), [plans]);
  const all = useMemo(() => [...unassigned, ...assigned], [unassigned, assigned]);
  const allById = useMemo(() => new Map(all.map((asset) => [asset.id, asset])), [all]);
  const selectedIds = useMemo(() => ids.filter((id) => allById.has(id)), [ids, allById]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  useEffect(() => {
    setIds((current) =>
      current.every((id) => allById.has(id)) ? current : current.filter((id) => allById.has(id)),
    );
  }, [allById]);
  const clear = useCallback(() => {
    setIds((current) => current.length ? [] : current);
    setAnchor(undefined);
  }, []);
  const select = (
    id: string,
    rows: GroupingAsset[],
    nextPane: string,
    event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; toggle?: boolean },
  ) => {
    setPane(nextPane);
    const start = event.shiftKey && pane === nextPane && anchor
      ? rows.findIndex((asset) => asset.id === anchor)
      : -1;
    if (start >= 0) {
      const end = rows.findIndex((asset) => asset.id === id);
      setIds((current) => [
        ...new Set([...current, ...rows.slice(Math.min(start, end), Math.max(start, end) + 1).map((asset) => asset.id)]),
      ]);
    } else if (event.ctrlKey || event.metaKey || event.toggle) {
      setIds((current) =>
        pane === nextPane
          ? current.includes(id)
            ? current.filter((item) => item !== id)
            : [...current, id]
          : [id],
      );
      setAnchor(id);
    } else {
      setIds([id]);
      setAnchor(id);
    }
  };
  const selectAll = (rows: GroupingAsset[], nextPane: string) => {
    setPane(nextPane);
    setIds(rows.map((asset) => asset.id));
    setAnchor(rows[0]?.id);
  };
  const replaceSelection = (nextIds: string[], nextPane: string) => {
    setPane(nextPane);
    setIds(nextIds);
    setAnchor(nextIds[0]);
  };
  const selectGroup = (rows: GroupingAsset[], event: { toggle?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const group = rows.map((asset) => asset.id);
    setPane('unassigned');
    setIds((current) => {
      const previous = pane === 'unassigned' ? current : [];
      if (event.toggle || event.ctrlKey || event.metaKey) {
        const previousSet = new Set(previous);
        const groupSet = new Set(group);
        return group.every((id) => previousSet.has(id))
          ? previous.filter((id) => !groupSet.has(id))
          : [...new Set([...previous, ...group])];
      }
      return group;
    });
    setAnchor(group[0]);
  };
  const startDrag = (id: string, groupIds?: string[]) =>
    setDragIds(groupIds ?? (selectedIdSet.has(id) ? selectedIds : [id]));
  const focusPane = (nextPane: string) => {
    if (pane !== nextPane) {
      clear();
      setPane(nextPane);
    }
  };
  const assets = useMemo(
    () => selectedIds.length ? all.filter((asset) => selectedIdSet.has(asset.id)) : [],
    [all, selectedIds, selectedIdSet],
  );
  return {
    selectedIds,
    selectedIdSet,
    pane,
    dragIds,
    visibleUnassigned,
    assigned,
    allById,
    focusPane,
    select,
    selectAll,
    replaceSelection,
    selectGroup,
    clear,
    startDrag,
    endDrag,
    assets,
  };
}
