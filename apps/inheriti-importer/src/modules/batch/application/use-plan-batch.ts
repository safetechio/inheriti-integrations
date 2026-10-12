import { useCallback, useMemo, useRef, useState } from 'react';

export type PlanBatchStatus =
  | 'PENDING'
  | 'VALIDATING'
  | 'CREATING'
  | 'CREATED'
  | 'CONFIGURING'
  | 'COMPLETE'
  | 'FAILED_CREATE'
  | 'FAILED_CONFIGURE'
  | 'CANCELLED';

interface PlanBatchItem<T> {
  readonly planId: string;
  readonly input: T;
  status: PlanBatchStatus;
  error?: unknown;
}

interface PlanBatchCallbacks<T> {
  validate?: (item: PlanBatchItem<T>) => Promise<void> | void;
  create: (item: PlanBatchItem<T>) => Promise<void>;
  reconcileCreate?: (item: PlanBatchItem<T>) => Promise<boolean>;
  configure: (item: PlanBatchItem<T>) => Promise<void>;
  onItemChange?: () => void;
}

const terminal = new Set<PlanBatchStatus>([
  'COMPLETE',
  'FAILED_CREATE',
  'FAILED_CONFIGURE',
  'CANCELLED',
]);

function result<T>(items: readonly PlanBatchItem<T>[]) {
  return {
    complete: items.filter((item) => item.status === 'COMPLETE'),
    createdUnconfigured: items.filter(
      (item) => item.status === 'CREATED' || item.status === 'FAILED_CONFIGURE',
    ),
    failed: items.filter((item) => item.status === 'FAILED_CREATE'),
    cancelled: items.filter((item) => item.status === 'CANCELLED'),
  };
}

async function pool<T>(
  items: PlanBatchItem<T>[],
  concurrency: number,
  signal: AbortSignal,
  worker: (item: PlanBatchItem<T>) => Promise<void>,
) {
  const queue = [...items];
  const lane = async () => {
    for (;;) {
      if (signal.aborted) return;
      const item = queue.shift();
      if (!item) return;
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, lane));
}

async function executeBatch<T>(
  items: PlanBatchItem<T>[],
  callbacks: PlanBatchCallbacks<T>,
  signal: AbortSignal,
) {
  const set = (item: PlanBatchItem<T>, status: PlanBatchStatus, error?: unknown) => {
    item.status = status;
    item.error = error;
    callbacks.onItemChange?.();
  };
  const cancelPending = () => {
    for (const item of items) {
      if (!terminal.has(item.status) && item.status !== 'CREATED') set(item, 'CANCELLED');
    }
  };
  if (signal.aborted) {
    cancelPending();
    return result(items);
  }
  await pool(
    items.filter((item) => item.status === 'PENDING' || item.status === 'FAILED_CREATE'),
    3,
    signal,
    async (item) => {
      if (signal.aborted) return set(item, 'CANCELLED');
      const retry = item.status === 'FAILED_CREATE';
      try {
        set(item, 'VALIDATING');
        await callbacks.validate?.(item);
        if (retry && callbacks.reconcileCreate && (await callbacks.reconcileCreate(item))) {
          set(item, 'CREATED');
          return;
        }
        set(item, 'CREATING');
        await callbacks.create(item);
        set(item, 'CREATED');
      } catch (error) {
        set(item, 'FAILED_CREATE', error);
      }
    },
  );
  if (signal.aborted) {
    cancelPending();
    return result(items);
  }
  await pool(
    items.filter((item) => item.status === 'CREATED' || item.status === 'FAILED_CONFIGURE'),
    1,
    signal,
    async (item) => {
      if (signal.aborted) return;
      try {
        set(item, 'CONFIGURING');
        await callbacks.configure(item);
        set(item, 'COMPLETE');
      } catch (error) {
        set(item, 'FAILED_CONFIGURE', error);
      }
    },
  );
  if (signal.aborted) cancelPending();
  return result(items);
}

export function usePlanBatch<T>(callbacks: Omit<PlanBatchCallbacks<T>, 'onItemChange'>) {
  const [items, setItems] = useState<PlanBatchItem<T>[]>([]);
  const [running, setRunning] = useState(false);
  const itemsRef = useRef<PlanBatchItem<T>[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const commit = useCallback(() => setItems(itemsRef.current.map((item) => ({ ...item }))), []);
  const resolvedCallbacks = useMemo(
    () => ({ ...callbacks, onItemChange: commit }),
    [callbacks, commit],
  );
  const execute = useCallback(
    async (planIds?: ReadonlySet<string>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      try {
        await executeBatch(
          planIds ? itemsRef.current.filter((item) => planIds.has(item.planId)) : itemsRef.current,
          resolvedCallbacks,
          controller.signal,
        );
        return result(itemsRef.current);
      } finally {
        setRunning(false);
        commit();
      }
    },
    [commit, resolvedCallbacks],
  );
  const run = useCallback(
    (entries: readonly { planId: string; input: T }[]) => {
      itemsRef.current = entries.map((entry) => ({
        planId: entry.planId,
        input: entry.input,
        status: 'PENDING',
      }));
      commit();
      return execute();
    },
    [commit, execute],
  );
  const retry = useCallback(
    async (planId: string, statuses: PlanBatchStatus[]) => {
      const item = itemsRef.current.find((candidate) => candidate.planId === planId);
      if (item && statuses.includes(item.status)) await execute(new Set([planId]));
    },
    [execute],
  );
  return {
    items,
    result: useMemo(() => result(items), [items]),
    running,
    run,
    retryCreate: (planId: string) => retry(planId, ['FAILED_CREATE']),
    retryConfigure: (planId: string) => retry(planId, ['FAILED_CONFIGURE', 'CREATED']),
    cancel: () => abortRef.current?.abort(),
  };
}
