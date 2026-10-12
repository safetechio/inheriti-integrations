import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { parseVaultFile } from '@modules/import/infrastructure/parsers';
import { VaultUnlockError, type OpenedVaultFile } from '@modules/import/domain/vault';
import {
  entriesFromParse,
  initialVaultState,
  vaultReducer,
  type VaultState,
} from '@modules/import/infrastructure/stores/vault-store';

type ImportSecrets = { password?: string; keyFile?: ArrayBuffer };

/**
 * Owns file-level import state. Every file is parsed independently so a bad
 * source cannot hide successful imports later in the same selection.
 */
export function useImportLifecycle() {
  const [state, dispatch] = useReducer(vaultReducer, initialVaultState);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const activeOperations = useRef(new Set<symbol>());
  const removedSourceIds = useRef(new Set<string>());

  useEffect(
    () => () => {
      generation.current += 1;
      activeOperations.current.clear();
    },
    [],
  );

  const startOperation = useCallback(() => {
    const operation = Symbol('import-operation');
    activeOperations.current.add(operation);
    setBusy(true);
    return operation;
  }, []);

  const finishOperation = useCallback((operation: symbol) => {
    activeOperations.current.delete(operation);
    setBusy(activeOperations.current.size > 0);
  }, []);

  const parseOne = useCallback(
    async (
      file: OpenedVaultFile,
      sourceId: string,
      expectedGeneration: number,
      secrets?: ImportSecrets,
    ) => {
      if (generation.current !== expectedGeneration || removedSourceIds.current.has(sourceId))
        return null;
      dispatch({
        type: 'source-status',
        sourceId,
        status: 'retrying',
      });
      try {
        const result = await parseVaultFile(file.data, file.name, secrets);
        if (generation.current !== expectedGeneration || removedSourceIds.current.has(sourceId))
          return null;
        dispatch({
          type: 'import',
          vault: {
            id: sourceId,
            name: result.name,
            kind: result.kind,
            fileName: file.name,
            importedAt: new Date().toISOString(),
            warnings: [...result.warnings],
          },
          entries: entriesFromParse(result, sourceId),
          warnings: [...result.warnings],
        });
        return {
          sourceId,
          status: result.warnings.length ? ('warning' as const) : ('imported' as const),
        };
      } catch (caught) {
        if (generation.current !== expectedGeneration || removedSourceIds.current.has(sourceId))
          return null;
        if (caught instanceof VaultUnlockError) {
          dispatch({
            type: 'source-status',
            sourceId,
            status: 'unlock-required',
            detail: caught.message,
          });
          return { sourceId, status: 'unlock-required' as const };
        }
        const detail = caught instanceof Error ? caught.message : 'Could not import this file.';
        dispatch({ type: 'source-status', sourceId, status: 'failed', detail });
        return { sourceId, status: 'failed' as const };
      }
    },
    [],
  );

  const importFiles = useCallback(
    async (files: OpenedVaultFile[], secrets?: ImportSecrets) => {
      const operation = startOperation();
      const expectedGeneration = generation.current;
      const pending = files.map((file) => {
        const sourceId = crypto.randomUUID();
        dispatch({
          type: 'source-start',
          source: { id: sourceId, file, status: 'retrying', warnings: [] },
        });
        return parseOne(file, sourceId, expectedGeneration, secrets);
      });
      try {
        return await Promise.all(pending);
      } finally {
        finishOperation(operation);
      }
    },
    [finishOperation, parseOne, startOperation],
  );

  const retrySource = useCallback(
    async (sourceId: string) => {
      const source = state.sources.find((item) => item.id === sourceId);
      if (!source) return null;
      const operation = startOperation();
      try {
        return await parseOne(source.file, source.id, generation.current);
      } finally {
        finishOperation(operation);
      }
    },
    [finishOperation, parseOne, startOperation, state.sources],
  );

  const unlockSource = useCallback(
    async (sourceId: string, password: string, keyFile?: ArrayBuffer) => {
      const source = state.sources.find((item) => item.id === sourceId);
      if (!source) return null;
      const operation = startOperation();
      try {
        return await parseOne(source.file, source.id, generation.current, { password, keyFile });
      } finally {
        finishOperation(operation);
      }
    },
    [finishOperation, parseOne, startOperation, state.sources],
  );

  const purge = useCallback(() => {
    generation.current += 1;
    activeOperations.current.clear();
    removedSourceIds.current.clear();
    setBusy(false);
    dispatch({ type: 'purge' });
  }, []);

  const removeSource = useCallback((sourceId: string) => {
    removedSourceIds.current.add(sourceId);
    dispatch({ type: 'remove-source', sourceId });
  }, []);

  return {
    state: state as VaultState,
    busy,
    importFiles,
    retrySource,
    unlockSource,
    removeSource,
    purge,
    dispatch,
  };
}
