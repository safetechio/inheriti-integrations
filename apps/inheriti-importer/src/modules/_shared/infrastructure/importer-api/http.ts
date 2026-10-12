import { useQuery } from '@tanstack/react-query';
import type { ElectronHttpTransport } from '../transport/electron-http-transport';
import { useRuntime } from './runtime';

export async function request<T>(
  transport: ElectronHttpTransport,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  query?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const response = await transport.request<{ result?: T }>({ method, path, body, query });
  return response.body.result as T;
}

export function useApiQuery<T>(
  key: readonly unknown[],
  path: string | null,
  query?: Record<string, string | number | boolean | undefined>,
) {
  const { transport } = useRuntime();
  const result = useQuery({
    queryKey: key,
    enabled: Boolean(path),
    queryFn: () => request<T>(transport, 'GET', path as string, undefined, query),
  });
  return {
    data: result.data,
    loading: result.isLoading,
    isRefetching: result.isRefetching,
    error: result.error,
  };
}

export function unwrapList<T>(value: T[] | { items?: T[] } | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value?.items ?? [];
}

export function toRecord<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export function whereQuery(where: Array<{ field: string; operator: string; value: unknown }>) {
  return { 'filter[where]': JSON.stringify(where) };
}
