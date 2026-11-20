import { useCallback, useEffect, useState } from 'react';
import type { GroupingAsset, PlanDraft } from '../types';

export function useAssetSelection(unassigned: GroupingAsset[], plans: PlanDraft[]) {
  const [ids, setIds] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string>();
  const [pane, setPane] = useState<string>();
  const [dragIds, setDragIds] = useState<string[]>([]);
  const endDrag = useCallback(() => setDragIds([]), []);
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
  const [visibleUnassignedIds, setVisibleUnassignedIds] = useState<string[]>([]);
  const all = [...unassigned, ...plans.flatMap((plan) => plan.assignedAssets ?? [])];
  const live = new Set(all.map((asset) => asset.id));
  const selectedIds = ids.filter((id) => live.has(id));
  const selectedIdSet = new Set(selectedIds);
  useEffect(() => {
    setIds((current) =>
      current.every((id) => live.has(id)) ? current : current.filter((id) => live.has(id)),
    );
  }, [unassigned, plans]);
  const clear = () => {
    setIds([]);
    setAnchor(undefined);
  };
  const select = (
    id: string,
    rows: GroupingAsset[],
    nextPane: string,
    event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; toggle?: boolean },
  ) => {
    const visible = rows.map((asset) => asset.id);
    setPane(nextPane);
    if (event.shiftKey && pane === nextPane && anchor && visible.includes(anchor)) {
      const start = visible.indexOf(anchor);
      const end = visible.indexOf(id);
      setIds((current) => [
        ...new Set([...current, ...visible.slice(Math.min(start, end), Math.max(start, end) + 1)]),
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
    setDragIds(groupIds ?? (selectedIds.includes(id) ? selectedIds : [id]));
  const focusPane = (nextPane: string) => {
    if (pane !== nextPane) {
      setIds([]);
      setAnchor(undefined);
      setPane(nextPane);
    }
  };
  return {
    selectedIds,
    selectedIdSet,
    pane,
    dragIds,
    visibleUnassignedIds,
    setVisibleUnassignedIds,
    focusPane,
    select,
    selectAll,
    replaceSelection,
    selectGroup,
    clear,
    startDrag,
    endDrag,
    assets: all.filter((asset) => selectedIdSet.has(asset.id)),
  };
}
