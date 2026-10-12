/**
 * Telemetry is deliberately metadata-only. Values, names, paths and source
 * identifiers must never cross this boundary.
 */
export type ImportTelemetryEvent = {
  name: 'batch_started' | 'plan_completed' | 'plan_failed' | 'batch_completed';
  at: number;
  count?: number;
  status?: 'complete' | 'failed' | 'cancelled' | 'created-unconfigured';
  durationMs?: number;
  correlationId: string;
};

export interface ImportTelemetrySink {
  record(event: ImportTelemetryEvent): void;
}

export function createNoopTelemetrySink(): ImportTelemetrySink {
  return { record: () => undefined };
}

export function createCorrelationId(): string {
  return crypto.randomUUID();
}
