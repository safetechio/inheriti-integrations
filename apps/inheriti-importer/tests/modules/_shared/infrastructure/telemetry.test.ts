import { describe, expect, it } from 'vitest';
import {
  createCorrelationId,
  createNoopTelemetrySink,
  type ImportTelemetryEvent,
} from '@shared/infrastructure/telemetry';

describe('import telemetry contract', () => {
  it('creates opaque correlation ids', () => {
    expect(createCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts only metadata fields and does not retain events by default', () => {
    const sink = createNoopTelemetrySink();
    const event: ImportTelemetryEvent = {
      name: 'batch_started',
      at: Date.now(),
      count: 2,
      correlationId: createCorrelationId(),
    };
    expect(() => sink.record(event)).not.toThrow();
  });
});
