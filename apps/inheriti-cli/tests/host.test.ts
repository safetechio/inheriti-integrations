import { describe, expect, it } from 'vitest';
import { cliHost } from '../src/index.js';

describe('CLI host boundary', () => {
  it('defaults to TEST under the frozen contract', () => {
    expect(cliHost.defaultEnvironment).toBe('TEST');
    expect(cliHost.contractVersion).toBe('elements.integration.v1');
  });
});
