import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { validateAssetEditorValues, type PlanAssetType } from '../domain/asset-metadata';

export interface AssetFormProps {
  asset?: {
    id?: string;
    type: string;
    meta?: Record<string, unknown>;
    secret?: Record<string, unknown>;
  };
  assetType: PlanAssetType;
  planType?: 'BACKUP' | 'BUSINESS_CONTINUITY';
  onSubmit: (value: AssetEditorValue) => void;
  onCancel: () => void;
}

export interface AssetEditorValue {
  id?: string;
  type: string;
  meta: Record<string, unknown>;
  secret: Record<string, unknown>;
}

export interface UsageLimits {
  maxChars: number;
  maxFiles: number;
  maxFileSize: number;
}

export interface UsageMetrics {
  charsLength: number;
  filesCount: number;
  filesSize: number;
}

export interface AssetEditorModalProps {
  open: boolean;
  type: string;
  asset?: AssetFormProps['asset'];
  planType?: AssetFormProps['planType'];
  limits?: Partial<UsageLimits>;
  initialUsage?: UsageMetrics;
  onSave: (value: AssetEditorValue) => void;
  onDismiss: () => void;
}

export interface AssetEditorFilePickResult {
  data: Blob;
  fileName: string;
  mimeType: string;
  size: number;
}

interface AssetEditorConfig {
  t: (key: string, options?: Record<string, unknown>) => string;
  selectFile: (accept?: string) => Promise<AssetEditorFilePickResult | null>;
  defaultPlanType?: 'BACKUP' | 'BUSINESS_CONTINUITY';
}

const AssetEditorContext = createContext<AssetEditorConfig | null>(null);

export function AssetEditorProvider({
  children,
  ...config
}: AssetEditorConfig & { children: ReactNode }) {
  return <AssetEditorContext.Provider value={config}>{children}</AssetEditorContext.Provider>;
}

export function useAssetEditorConfig(): AssetEditorConfig {
  const config = useContext(AssetEditorContext);
  if (!config) throw new Error('useAssetEditorConfig must be used within an <AssetEditorProvider>');
  return config;
}

function usage(value: unknown): UsageMetrics {
  const result: UsageMetrics = { charsLength: 0, filesCount: 0, filesSize: 0 };
  const walk = (item: unknown): void => {
    if (typeof Blob !== 'undefined' && item instanceof Blob) {
      result.filesCount += 1;
      result.filesSize += item.size;
      return;
    }
    if (typeof item === 'string' || typeof item === 'number') {
      result.charsLength += String(item).length;
      return;
    }
    if (Array.isArray(item)) {
      item.forEach(walk);
      return;
    }
    if (item instanceof Date) {
      result.charsLength += item.toLocaleDateString('en-GB').length;
      return;
    }
    if (
      typeof item === 'object' &&
      item !== null &&
      'fileSize' in item &&
      typeof (item as { fileSize: unknown }).fileSize === 'number'
    ) {
      result.filesCount += 1;
      result.filesSize += (item as { fileSize: number }).fileSize;
      return;
    }
    if (typeof item === 'object' && item !== null) Object.values(item).forEach(walk);
  };
  walk(value);
  return result;
}

function setNestedValue(
  values: { meta: Record<string, unknown>; secret: Record<string, unknown> },
  source: string,
  value: unknown,
) {
  const [scope, ...parts] = source.split('.');
  if (scope !== 'meta' && scope !== 'secret') return values;
  const next = { meta: { ...values.meta }, secret: { ...values.secret } };
  let cursor = next[scope];
  const last = parts.pop();
  if (!last) return next;
  for (const part of parts) {
    const child = cursor[part];
    cursor[part] = { ...(typeof child === 'object' && child !== null ? child : {}) };
    cursor = cursor[part] as Record<string, unknown>;
  }
  cursor[last] = value;
  return next;
}

export function useAssetEditorState({
  asset,
  type,
  initialUsage = { charsLength: 0, filesCount: 0, filesSize: 0 },
  limits,
  onSave,
}: {
  asset?: AssetFormProps['asset'];
  type: string;
  initialUsage?: UsageMetrics;
  limits?: Partial<UsageLimits>;
  onSave: (value: AssetEditorValue) => void;
}) {
  const initialValues = useMemo(
    () => ({ meta: { ...(asset?.meta ?? {}) }, secret: { ...(asset?.secret ?? {}) } }),
    [asset],
  );
  const [values, setValues] = useState(initialValues);
  useEffect(() => setValues(initialValues), [initialValues]);
  const metrics = useMemo(() => {
    const current = usage(values);
    const initial = usage(initialValues);
    return {
      charsLength: initialUsage.charsLength + current.charsLength - initial.charsLength,
      filesCount: initialUsage.filesCount + current.filesCount - initial.filesCount,
      filesSize: initialUsage.filesSize + current.filesSize - initial.filesSize,
    };
  }, [initialUsage, initialValues, values]);
  const resolvedLimits = {
    maxChars: limits?.maxChars ?? 500,
    maxFiles: limits?.maxFiles ?? 10,
    maxFileSize: limits?.maxFileSize ?? 50 * 1024 * 1024,
  };
  const errors = useMemo(() => {
    const next = validateAssetEditorValues(type, values);
    if (typeof values.meta.name !== 'string' || values.meta.name.trim() === '')
      next['meta.name'] = 'Asset name is required';
    return next;
  }, [type, values]);
  const overallUsage = Math.max(
    (metrics.charsLength * 100) / resolvedLimits.maxChars,
    (metrics.filesCount * 100) / resolvedLimits.maxFiles,
    (metrics.filesSize * 100) / resolvedLimits.maxFileSize,
  );
  const isValid =
    Object.keys(errors).length === 0 &&
    metrics.charsLength <= resolvedLimits.maxChars &&
    metrics.filesCount <= resolvedLimits.maxFiles &&
    metrics.filesSize <= resolvedLimits.maxFileSize;
  const setValue = useCallback(
    (source: string, value: unknown) =>
      setValues((current) => setNestedValue(current, source, value)),
    [],
  );
  const save = useCallback(() => {
    if (!isValid) return;
    onSave({ id: asset?.id, type, meta: values.meta, secret: values.secret });
  }, [asset?.id, isValid, onSave, type, values]);
  return { values, errors, usage: { metrics, overallUsage }, isValid, setValue, save };
}
